import type { StudentRecord } from "../../src/model.js";

/** A 2026 CS freshman in their first fall, planning spring. All made-up data. */
export const freshmanFall: StudentRecord = {
  programId: "cs-bs",
  catalogYear: 2026,
  attempts: [
    { course: "ECS 1100", term: "2026 Fall", hours: 1, status: "in_progress" },
    { course: "CS 1436", term: "2026 Fall", hours: 4, status: "in_progress" },
    { course: "MATH 2413", term: "2026 Fall", hours: 4, status: "in_progress" },
    { course: "RHET 1302", term: "2026 Fall", hours: 3, status: "in_progress" },
    { course: "GOVT 2305", term: "2026 Fall", hours: 3, status: "in_progress" },
  ],
};

/** End of sophomore fall, with AP credit and one rough grade. */
export const sophomore: StudentRecord = {
  programId: "cs-bs",
  catalogYear: 2026,
  attempts: [
    { course: "HIST 1301", term: "AP", hours: 3, status: "credit_by_exam" },
    { course: "MATH 2413", term: "AP", hours: 4, status: "credit_by_exam" },
    { course: "ECS 1100", term: "2025 Fall", hours: 1, grade: "A", status: "completed" },
    { course: "CS 1436", term: "2025 Fall", hours: 4, grade: "A-", status: "completed" },
    { course: "MATH 2414", term: "2025 Fall", hours: 4, grade: "B", status: "completed" },
    { course: "RHET 1302", term: "2025 Fall", hours: 3, grade: "A", status: "completed" },
    { course: "CS 1337", term: "2026 Spring", hours: 3, grade: "B+", status: "completed" },
    { course: "CS 2305", term: "2026 Spring", hours: 3, grade: "C+", status: "completed" },
    { course: "ECS 1210", term: "2026 Spring", hours: 2, grade: "A", status: "completed" },
    { course: "PHYS 2325", term: "2026 Spring", hours: 3, grade: "B-", status: "completed" },
    { course: "PHYS 2125", term: "2026 Spring", hours: 1, grade: "A", status: "completed" },
    { course: "GOVT 2305", term: "2026 Spring", hours: 3, grade: "A", status: "completed" },
    { course: "CS 2336", term: "2026 Fall", hours: 3, status: "in_progress" },
    { course: "CS 2340", term: "2026 Fall", hours: 3, status: "in_progress" },
    { course: "MATH 2418", term: "2026 Fall", hours: 4, status: "in_progress" },
    { course: "PHYS 2326", term: "2026 Fall", hours: 3, status: "in_progress" },
    { course: "PHYS 2126", term: "2026 Fall", hours: 1, status: "in_progress" },
  ],
};

/** Took Calculus I from one sequence (MATH 2417) and the second course of the other (MATH 2414). */
export const mixedCalculus: StudentRecord = {
  programId: "cs-bs",
  catalogYear: 2026,
  attempts: [
    { course: "MATH 2417", term: "2026 Fall", hours: 4, grade: "B", status: "completed" },
    { course: "CS 1436", term: "2026 Fall", hours: 4, grade: "A", status: "completed" },
    { course: "MATH 2414", term: "2027 Spring", hours: 4, status: "in_progress" },
    { course: "CS 1337", term: "2027 Spring", hours: 3, status: "in_progress" },
  ],
};

/** Got a D in CS 1337: has credit for it, but not a C for CS 2336's prerequisite. */
export const dInCs1337: StudentRecord = {
  programId: "cs-bs",
  catalogYear: 2026,
  attempts: [
    { course: "CS 1436", term: "2025 Fall", hours: 4, grade: "B", status: "completed" },
    { course: "CS 1337", term: "2026 Spring", hours: 3, grade: "D", status: "completed" },
  ],
};
