import { describe, expect, it } from "vitest";
import { parsePrereqText } from "../src/catalog/parseCourses.js";

describe("prerequisite parser", () => {
  it("handles grouped ORs joined by AND, with grade minimums", () => {
    const e = parsePrereqText(
      "(CS 2305 or MATH 3315) with a grade of C or better, and (CS 2336 or CS 2337) with a grade of C or better",
    );
    expect(e).toEqual({
      op: "and",
      items: [
        { op: "or", items: [{ op: "course", course: "CS 2305", minGrade: "C" }, { op: "course", course: "MATH 3315", minGrade: "C" }] },
        { op: "or", items: [{ op: "course", course: "CS 2336", minGrade: "C" }, { op: "course", course: "CS 2337", minGrade: "C" }] },
      ],
    });
  });

  it("handles a grade written before the courses", () => {
    const e = parsePrereqText("A grade of C- or better in either MATH 2417 or in MATH 2413 or equivalent");
    expect(e).toEqual({
      op: "or",
      items: [
        { op: "course", course: "MATH 2417", minGrade: "C-" },
        { op: "course", course: "MATH 2413", minGrade: "C-" },
        { op: "text", text: "equivalent" },
      ],
    });
  });

  it("keeps conditions it can't check as text instead of dropping them", () => {
    expect(parsePrereqText("CS 1436 with a grade of C or better or equivalent")).toEqual({
      op: "or",
      items: [{ op: "course", course: "CS 1436", minGrade: "C" }, { op: "text", text: "equivalent" }],
    });
    expect(parsePrereqText("CS 3345 or instructor consent required")).toEqual({
      op: "or",
      items: [{ op: "course", course: "CS 3345" }, { op: "text", text: "instructor consent required" }],
    });
  });

  it("reads course codes written without a space", () => {
    expect(parsePrereqText("BIOL2V81")).toEqual({ op: "course", course: "BIOL 2V81" });
  });
});
