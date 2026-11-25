import { describe, expect, it } from "vitest";
import { audit } from "../src/engine/audit.js";
import { planNextTerm } from "../src/engine/nextTerm.js";
import { loadCatalog, loadRules } from "../src/load.js";
import type { CourseAttempt, StudentRecord } from "../src/model.js";
import { dInCs1337, freshmanFall, mixedCalculus, sophomore } from "./fixtures/students.js";

const cat = loadCatalog(2026);
const rules = loadRules(2026, "cs-bs");
const block = (r: ReturnType<typeof audit>, id: string) => r.blocks.find((b) => b.block.id === id)!;
const done = (course: string, grade = "A", hours = 3): CourseAttempt => ({ course, term: "2026 Spring", hours, grade, status: "completed" });
const student = (attempts: CourseAttempt[]): StudentRecord => ({ programId: "cs-bs", catalogYear: 2026, attempts });

describe("CS 2026 rules (built from the catalog)", () => {
  it("has the catalog's blocks and totals", () => {
    expect(rules.totalHours).toBe(124);
    expect(rules.upperDivisionHours).toBe(45);
    expect(rules.blocks.map((b) => b.id)).toEqual([
      "communication",
      "mathematics",
      "life-and-physical-sciences",
      "language-philosophy-and-culture",
      "creative-arts",
      "american-history",
      "government-political-science",
      "social-and-behavioral-sciences",
      "component-area-option",
      "major-preparatory-courses",
      "major-core-courses",
      "major-technical-electives",
      "free-electives",
    ]);
  });

  it("models technical electives as 9 hours from the list or any CS 4000-level course", () => {
    const te = rules.blocks.find((b) => b.id === "major-technical-electives")!.requirement;
    expect(te).toMatchObject({ type: "hours", hours: 9, from: { patterns: [{ subject: "CS", minNumber: 4000, maxNumber: 4999 }] } });
  });

  it("models the calculus sequence as a choice between two pairs", () => {
    const prep = rules.blocks.find((b) => b.id === "major-preparatory-courses")!.requirement;
    expect(JSON.stringify(prep)).toContain(
      '{"type":"oneOf","options":[{"type":"all","items":[{"type":"course","course":"MATH 2413"},{"type":"course","course":"MATH 2414"}]},{"type":"all","items":[{"type":"course","course":"MATH 2417"},{"type":"course","course":"MATH 2419"}]}]}',
    );
  });
});

describe("audit", () => {
  it("shows current classes as in progress", () => {
    const r = audit(rules, freshmanFall, cat);
    expect(block(r, "mathematics").status).toBe("in_progress");
    expect(r.totalHours).toEqual({ credited: 0, inProgress: 15, required: 124 });
  });

  it("does not count a major core course as a technical elective", () => {
    const r = audit(rules, student([done("CS 4337"), done("CS 4349"), done("CS 4365")]), cat);
    const te = block(r, "major-technical-electives");
    expect(te.used).toEqual(["CS 4365"]);
    expect(te.remaining).toMatchObject([{ kind: "hours", hours: 6 }]);
  });

  it("accepts any CS 4000-level course as a technical elective", () => {
    const r = audit(rules, student([done("CS 4365"), done("CS 4375"), done("CS 4V98")]), cat);
    expect(block(r, "major-technical-electives").status).toBe("met");
  });

  it("counts cross-listed courses (SE 3345 = CS 3345)", () => {
    const r = audit(rules, student([done("SE 3345")]), cat);
    const core = block(r, "major-core-courses");
    expect(core.used).toContain("SE 3345");
    expect(JSON.stringify(core.remaining)).not.toContain("CS 3345");
  });

  it("uses the 'any 6 hours of Communication Core' path when the listed courses aren't taken", () => {
    const comm = cat.coreAreas.get("010")!.courses.filter((c) => c !== "RHET 1302" && c !== "ECS 2390").slice(0, 2);
    const r = audit(rules, student(comm.map((c) => done(c))), cat);
    expect(block(r, "communication")).toMatchObject({ status: "met", path: "alternative" });
  });

  it("gives credit for a D but not for an F", () => {
    const r = audit(rules, student([done("CS 1337", "D"), done("CS 1436", "F", 4)]), cat);
    const prep = JSON.stringify(block(r, "major-preparatory-courses").remaining);
    expect(prep).not.toContain('"CS 1337"');
    expect(prep).toContain('"CS 1436"');
  });
});

describe("next-term plan", () => {
  it("puts the courses that unlock the most first, within the hour cap", () => {
    const plan = planNextTerm(rules, freshmanFall, cat, { maxHours: 15 });
    expect(plan.recommended.slice(0, 2).map((s) => s.course).sort()).toEqual(["CS 1337", "CS 2305"]);
    expect(plan.recommended.reduce((n, s) => n + s.hours, 0)).toBeLessThanOrEqual(15);
  });

  it("blocks CS 2336 after a D in CS 1337 (needs a C)", () => {
    const plan = planNextTerm(rules, dInCs1337, cat);
    expect(plan.recommended.map((s) => s.course)).not.toContain("CS 2336");
    expect(plan.blocked.find((s) => s.course === "CS 2336")?.notes.join(" ")).toMatch(/CS 1337 \(C or better\)/);
  });

  it("recommends Data Structures first for a sophomore finishing CS II", () => {
    const plan = planNextTerm(rules, sophomore, cat);
    expect(plan.recommended[0]?.course).toBe("CS 3345");
  });

  it("holds back a course whose corequisite can't be taken yet (CS 4141 needs CS 4341)", () => {
    const plan = planNextTerm(rules, freshmanFall, cat, { maxHours: 18 });
    expect(plan.recommended.map((s) => s.course)).not.toContain("CS 4141");
    expect(plan.blocked.find((s) => s.course === "CS 4141")?.notes.join(" ")).toMatch(/same term as CS 4341/);
  });

  it("adds one corequisite partner, not every alternative (PHYS 2325 with PHYS 2125)", () => {
    const plan = planNextTerm(rules, sophomore, cat, { maxHours: 30 });
    const ids = plan.recommended.map((s) => s.course);
    if (ids.includes("PHYS 2126")) expect(ids).toContain("PHYS 2326");
    expect(ids).not.toContain("PHYS 2422");
  });

  it("continues the calculus sequence started first and flags it for an advisor", () => {
    const r = audit(rules, mixedCalculus, cat);
    expect(r.warnings.join(" ")).toMatch(/different options/);
    const plan = planNextTerm(rules, mixedCalculus, cat);
    const math = plan.recommended.find((s) => s.course.startsWith("MATH 241"));
    expect(math?.course).toBe("MATH 2419");
    expect(math?.eligibility).toBe("check");
    expect(plan.recommended.map((s) => s.course)).not.toContain("MATH 2413");
  });
});

describe("university checks", () => {
  it("counts UTD residency hours, excluding transfer credit", () => {
    const r = audit(rules, student([done("CS 1337"), { course: "HIST 1302", term: "2026 Fall", hours: 3, grade: "C", status: "transfer" }]), cat);
    expect(r.universityChecks[0]?.detail).toBe("3 done + 0 in progress at UTD");
  });

  it("computes UTD GPA from letter grades", () => {
    const r = audit(rules, student([done("CS 1337", "A"), done("CS 2305", "C")]), cat);
    expect(r.universityChecks[1]).toMatchObject({ status: "met", detail: "GPA 3.00 from 6 graded hours" });
  });
});
