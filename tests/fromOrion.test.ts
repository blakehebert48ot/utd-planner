import { describe, expect, it } from "vitest";
import { type OrionSection, nameKeys, parseClassName, parseDayTime, pickSchedule } from "../src/schedule/fromOrion.js";
import { profKey, type ProfessorStats } from "../src/grades/professorStats.js";
import { expandCourse } from "../src/grades/compactStats.js";

// Real CS 2336 sections for 2027 Spring, as Orion's class search listed them on 2026-11-24.
const CS2336: OrionSection[] = [
  { classNumber: "25001", section: "001", component: "LEC", meetings: [{ days: ["Monday", "Wednesday"], start: "10:00AM", end: "11:15AM", room: "ECSS 2.201" }], instructors: ["Brian Wescott Ricks"], status: "Open" },
  { classNumber: "25655", section: "002", component: "LEC", meetings: [{ days: ["Tuesday", "Thursday"], start: "2:30PM", end: "3:45PM", room: "ECSS 2.201" }], instructors: ["Sruthi Chappidi"], status: "Open" },
  { classNumber: "25248", section: "003", component: "LEC", meetings: [{ days: ["Monday", "Wednesday"], start: "11:30AM", end: "12:45PM", room: "CR 1.202" }], instructors: ["Brian Wescott Ricks"], status: "Open" },
  { classNumber: "24404", section: "004", component: "LEC", meetings: [{ days: ["Tuesday", "Thursday"], start: "11:30AM", end: "12:45PM", room: "JO 4.102" }], instructors: ["Sruthi Chappidi"], status: "Open" },
  { classNumber: "25978", section: "501", component: "LEC", meetings: [{ days: ["Tuesday", "Thursday"], start: "5:30PM", end: "6:45PM", room: "FO 2.404" }], instructors: ["Priya Narayanasami"], status: "Open" },
  { classNumber: "25980", section: "701", component: "EXM", meetings: [{ days: ["Friday"], start: "4:00PM", end: "6:00PM", room: "ECSW 1.315" }], instructors: ["Brian Wescott Ricks", "To be Announced"], status: "Open" },
];
const MORNING_ONLY: OrionSection[] = [
  { classNumber: "21001", section: "001", component: "LEC", meetings: [{ days: ["Monday", "Wednesday"], start: "8:30AM", end: "9:45AM", room: "SLC 1.102" }], instructors: ["Ann Early"], status: "Open" },
  { classNumber: "21002", section: "002", component: "LEC", meetings: [{ days: ["Tuesday", "Thursday"], start: "10:00AM", end: "11:15AM", room: "SLC 1.102" }], instructors: ["Bob Morning"], status: "Open" },
];

describe("reading Orion's search results", () => {
  it("parses day/time strings", () => {
    expect(parseDayTime("MoWe 10:00AM - 11:15AM")).toEqual({ days: ["Monday", "Wednesday"], start: "10:00AM", end: "11:15AM" });
    expect(parseDayTime("Fr 4:00PM - 6:00PM")?.days).toEqual(["Friday"]);
    expect(parseDayTime("TBA")).toBeUndefined();
  });

  it("splits section and component", () => {
    expect(parseClassName("001-LEC\nRegular")).toEqual({ section: "001", component: "LEC" });
    expect(parseClassName("701-EXM Regular")).toEqual({ section: "701", component: "EXM" });
  });

  it("matches Orion's full names to grade-data names", () => {
    expect(nameKeys("Brian Wescott Ricks")).toContain(profKey("Ricks", "Brian"));
    expect(nameKeys("Carlos Arreche Aguayo")).toContain(profKey("Arreche Aguayo", "Carlos"));
  });
});

describe("picking sections inside the student's hours", () => {
  it("only picks lectures that fit 1pm–7pm", () => {
    const r = pickSchedule(["CS 2336"], { "CS 2336": CS2336 }, "2027 Spring", { earliest: "13:00", latest: "19:00" });
    expect(["25655", "25978"]).toContain(r.picked[0]!.section.classNumber);
    expect(r.picked[0]!.outsideHours).toBe(false);
  });

  it("never picks the exam section as the class, but mentions it", () => {
    const r = pickSchedule(["CS 2336"], { "CS 2336": CS2336 }, "2027 Spring", { earliest: "8:00", latest: "20:00" });
    expect(r.picked[0]!.section.mode).toBe("LEC");
    expect(r.notices.join(" ")).toMatch(/common exams \(Fri 4:00PM–6:00PM\)/);
  });

  it("still adds a class with nothing inside the hours, and says so", () => {
    const r = pickSchedule(["CS 2336", "MATH 2419"], { "CS 2336": CS2336, "MATH 2419": MORNING_ONLY }, "2027 Spring", { earliest: "13:00", latest: "19:00" });
    const math = r.picked.find((p) => p.course === "MATH 2419")!;
    expect(math.outsideHours).toBe(true);
    expect(math.section.classNumber).toBe("21002"); // 10:00 is closer to 1pm than 8:30
    expect(r.notices.join(" ")).toMatch(/MATH 2419: no open section fits 1:00pm–7:00pm\. Added the closest one instead/);
  });

  it("reports a class with no open sections at all", () => {
    const r = pickSchedule(["CS 9999"], { "CS 9999": [] }, "2027 Spring", { earliest: "13:00", latest: "19:00" });
    expect(r.picked).toEqual([]);
    expect(r.notices[0]).toMatch(/CS 9999: no open sections/);
  });

  it("uses grade data to choose between professors", () => {
    const stats = expandCourse("CS 2336", {
      mean: 3.1,
      profs: [
        ["Sruthi Chappidi", 3.5, 3.6, 300, 0.02, 0.7, 0.03, "26S,25F"],
        ["Priya Narayanasami", 2.8, 2.7, 300, 0.05, 0.3, 0.1, "26S"],
      ],
    });
    const r = pickSchedule(["CS 2336"], { "CS 2336": CS2336 }, "2027 Spring", { earliest: "13:00", latest: "19:00" }, { "CS 2336": stats });
    expect(r.picked[0]!.section.classNumber).toBe("25655");
    expect((r.picked[0]!.teacher as ProfessorStats).summary).toMatch(/Average GPA 3\.60/);
  });
});
