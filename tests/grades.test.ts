import { describe, expect, it } from "vitest";
import { parseCsv, parseGradeCsv } from "../src/grades/parseGrades.js";
import { profKey, rankProfessors, termKey } from "../src/grades/professorStats.js";
import { normalizeSection } from "../src/nebula/client.js";

// Header and rows in the real 26S format (with the extra instructor_id columns).
const CSV_26S = `Subject,Catalog Nbr,Section,A+,A,A-,B+,B,B-,C+,C,C-,D+,D,D-,F,CR,I,NC,W,P,Instructor 1,Instructor 2,Instructor 3,Instructor 4,Instructor 5,Instructor 6,instructor_id,instructor_name_normalized,title
CS,2336,001,4,18,11,9,7,1,,1,,,1,,,,,,1,,"Ricks, Brian",,,,,,bwr031000,brian ricks,Computer Science II
CS,2336,005,3,7,4,3,5,4,5,1,2,,3,4,1,,,,,,"Lin, Beiyu",,,,,,dal207602,,Computer Science II
`;
// Older format: "Total W" column name, no instructor_id.
const CSV_OLD = `Subject,Catalog Number,Section,A+,A,A-,B+,B,B-,C+,C,C-,D+,D,D-,F,Total W,Instructor 1,Instructor 2
CS,2336,002,0,30,0,0,10,0,0,5,0,0,0,0,5,10,"Ricks, Brian","Doe, Jane Q"
`;

describe("grade CSV parsing", () => {
  it("handles quoted names with commas", () => {
    expect(parseCsv('a,"Ricks, Brian",c\n')).toEqual([["a", "Ricks, Brian", "c"]]);
  });

  it("reads grades in Nebula's order and ignores instructor_id columns", () => {
    const { rows } = parseGradeCsv(CSV_26S, "26S");
    expect(rows[0]).toMatchObject({ course: "CS 2336", section: "001", term: "26S" });
    expect(rows[0]!.dist).toEqual([4, 18, 11, 9, 7, 1, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(rows[0]!.instructors.map((i) => i.raw)).toEqual(["Ricks, Brian"]);
  });

  it("accepts older column names (Catalog Number, Total W)", () => {
    const { rows, warnings } = parseGradeCsv(CSV_OLD, "21F");
    expect(warnings).toEqual([]);
    expect(rows[0]!.dist[13]).toBe(10);
    expect(rows[0]!.instructors.map((i) => i.last)).toEqual(["Ricks", "Doe"]);
  });
});

describe("professor ranking", () => {
  const rows = [...parseGradeCsv(CSV_26S, "26S").rows, ...parseGradeCsv(CSV_OLD, "21F").rows];

  it("merges a professor across semesters and file formats", () => {
    const r = rankProfessors(rows, ["CS 2336"], { since: "21F" });
    const ricks = r.professors.find((p) => p.key === profKey("Ricks", "Brian"))!;
    expect(ricks.sections).toBe(2);
    expect(ricks.terms).toEqual(["26S", "21F"]);
    expect(ricks.withdrew).toBe(11);
  });

  it("computes GPA, A rate and withdrawal rate", () => {
    const r = rankProfessors(parseGradeCsv(CSV_OLD, "21F").rows, ["CS 2336"], { since: "21F" });
    const p = r.professors[0]!;
    // 30 A (4.0) + 10 B (3.0) + 5 C (2.0) + 5 F (0) = 160 points / 50 students
    expect(p.meanGpa).toBeCloseTo(3.2);
    expect(p.pctA).toBeCloseTo(0.6);
    expect(p.wRate).toBeCloseTo(10 / 60);
    expect(p.summary).toMatch(/Average GPA 3\.20/);
  });

  it("pulls small samples toward the course average", () => {
    const r = rankProfessors(rows, ["CS 2336"], { since: "21F" });
    for (const p of r.professors) {
      expect(Math.abs(p.adjustedGpa - r.meanGpa)).toBeLessThanOrEqual(Math.abs(p.meanGpa - r.meanGpa) + 1e-9);
    }
  });

  it("orders terms with summer between spring and fall", () => {
    expect(termKey("26S") < termKey("26U")).toBe(true);
    expect(termKey("26U") < termKey("26F")).toBe(true);
  });
});

describe("Nebula section normalizing", () => {
  it("keeps the class number, meetings and professor names", () => {
    const s = normalizeSection("CS 2336", {
      _id: "x",
      section_number: "002",
      academic_session: { name: "27F", start_date: "", end_date: "" },
      internal_class_number: "21075",
      instruction_mode: "Face-to-Face",
      meetings: [
        {
          start_date: "",
          end_date: "",
          meeting_days: ["Tuesday", "Thursday"],
          start_time: "1:00pm",
          end_time: "2:15pm",
          modality: "",
          location: { building: "SCI", room: "1.220", map_uri: "" },
        },
      ],
      professors: ["p1"],
      professor_details: [{ _id: "p1", first_name: "Brian", last_name: "Ricks" }],
      core_flags: [],
    });
    expect(s).toMatchObject({ classNumber: "21075", term: "27F", professors: [{ name: "Brian Ricks", key: profKey("Ricks", "Brian") }] });
    expect(s.meetings[0]).toEqual({ days: ["Tuesday", "Thursday"], start: "1:00pm", end: "2:15pm", building: "SCI", room: "1.220" });
  });
});
