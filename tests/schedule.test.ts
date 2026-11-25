import { describe, expect, it } from "vitest";
import { buildSchedules, meetingBlocks, type CourseRequest } from "../src/schedule/solver.js";
import { formatTime, parseTime } from "../src/schedule/time.js";
import { profKey, type ProfessorStats } from "../src/grades/professorStats.js";
import type { Section } from "../src/nebula/client.js";

let n = 99500;
const sec = (course: string, days: string[], start: string, end: string, prof?: string): Section => ({
  course,
  term: "27F",
  section: String(++n).slice(-3),
  classNumber: String(n),
  mode: "Face-to-Face",
  meetings: [{ days, start, end, building: "X", room: "1" }],
  professors: prof ? [{ name: prof, key: profKey(prof.split(" ")[1]!, prof.split(" ")[0]!) }] : [],
});
const stats = (name: string, adjustedGpa: number, wRate = 0.02): ProfessorStats =>
  ({ name, key: profKey(name.split(" ")[1]!, name.split(" ")[0]!), adjustedGpa, wRate, summary: "", terms: [] }) as unknown as ProfessorStats;
const MW = ["Monday", "Wednesday"];
const TR = ["Tuesday", "Thursday"];

describe("time parsing", () => {
  it("reads common formats", () => {
    expect(parseTime("1:00pm")).toBe(13 * 60);
    expect(parseTime("12:30 PM")).toBe(12 * 60 + 30);
    expect(parseTime("12:00am")).toBe(0);
    expect(parseTime("8am")).toBe(8 * 60);
    expect(parseTime("TBA")).toBeUndefined();
    expect(formatTime(13 * 60 + 5)).toBe("1:05pm");
  });

  it("accepts short day names", () => {
    expect(meetingBlocks(sec("A 1000", ["M", "W"], "10:00am", "11:15am")).map((b) => b.day)).toEqual(["Monday", "Wednesday"]);
  });
});

describe("schedule builder", () => {
  it("never returns overlapping classes", () => {
    const r = buildSchedules([
      { course: "A 1000", sections: [sec("A 1000", MW, "10:00am", "11:15am")] },
      { course: "B 1000", sections: [sec("B 1000", MW, "10:30am", "11:45am"), sec("B 1000", TR, "10:30am", "11:45am")] },
    ]);
    expect(r.options).toHaveLength(1);
    expect(r.options[0]!.sections[1]!.meetings[0]!.days).toEqual(TR);
  });

  it("respects the time window and days off as hard rules", () => {
    const r = buildSchedules(
      [{ course: "A 1000", sections: [sec("A 1000", MW, "8:30am", "9:45am"), sec("A 1000", TR, "10:00am", "11:15am"), sec("A 1000", ["Friday"], "10:00am", "12:45pm")] }],
      { earliest: "10:00am", daysOff: ["Friday"] },
    );
    expect(r.options.map((o) => o.sections[0]!.meetings[0]!.days)).toEqual([TR]);
    expect(r.filtered.map((f) => f.why).sort()).toEqual(["meets on a day you want off", "starts before 10:00am"]);
  });

  it("prefers back-to-back classes when asked for no gaps", () => {
    const reqs: CourseRequest[] = [
      { course: "A 1000", sections: [sec("A 1000", MW, "10:00am", "11:15am")] },
      { course: "B 1000", sections: [sec("B 1000", MW, "11:30am", "12:45pm"), sec("B 1000", MW, "2:30pm", "3:45pm")] },
    ];
    const r = buildSchedules(reqs, { gaps: "none", professor: "ignore" });
    expect(r.options[0]!.sections[1]!.meetings[0]!.start).toBe("11:30am");
    expect(r.options[0]!.reasons).toContain("no gaps between classes");
  });

  it("picks the better-graded professor when times are equally good", () => {
    const good = sec("A 1000", MW, "10:00am", "11:15am", "Ada Good");
    const tough = sec("A 1000", TR, "10:00am", "11:15am", "Tim Tough");
    const r = buildSchedules([
      { course: "A 1000", sections: [tough, good], professorStats: new Map([["good|ada", stats("Ada Good", 3.5)], ["tough|tim", stats("Tim Tough", 2.6)]]) },
    ]);
    expect(r.options[0]!.teachers[0]!.name).toBe("Ada Good");
  });

  it("can rank by fewest withdrawals instead", () => {
    const a = sec("A 1000", MW, "10:00am", "11:15am", "Ada Easy");
    const b = sec("A 1000", TR, "10:00am", "11:15am", "Bo Steady");
    const r = buildSchedules(
      [{ course: "A 1000", sections: [a, b], professorStats: new Map([["easy|ada", stats("Ada Easy", 3.6, 0.1)], ["steady|bo", stats("Bo Steady", 3.0, 0.01)]]) }],
      { professor: "fewestDrops" },
    );
    expect(r.options[0]!.teachers[0]!.name).toBe("Bo Steady");
  });

  it("drops the lowest-priority course, and says so, when everything can't fit", () => {
    const r = buildSchedules([
      { course: "A 1000", sections: [sec("A 1000", MW, "10:00am", "11:15am")] },
      { course: "B 1000", sections: [sec("B 1000", MW, "10:00am", "11:15am")] },
    ]);
    expect(r.options[0]!.sections.map((s) => s.course)).toEqual(["A 1000"]);
    expect(r.dropped).toEqual([{ course: "B 1000", why: "every section clashes with your higher-priority classes" }]);
  });

  it("returns up to 3 different plans with cart numbers", () => {
    const r = buildSchedules([
      { course: "A 1000", sections: [sec("A 1000", MW, "10:00am", "11:15am"), sec("A 1000", TR, "10:00am", "11:15am")] },
      { course: "B 1000", sections: [sec("B 1000", MW, "1:00pm", "2:15pm"), sec("B 1000", TR, "1:00pm", "2:15pm")] },
    ]);
    expect(r.options).toHaveLength(3);
    const carts = r.options.map((o) => o.classNumbers.join(","));
    expect(new Set(carts).size).toBe(3);
    expect(r.options[0]!.classNumbers).toHaveLength(2);
  });

  it("warns about online or TBA sections instead of hiding them", () => {
    const online: Section = { ...sec("A 1000", [], "", ""), meetings: [] };
    const r = buildSchedules([{ course: "A 1000", sections: [online] }]);
    expect(r.options[0]!.warnings.join(" ")).toMatch(/no meeting times/);
  });
});
