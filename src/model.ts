/**
 * Core data shapes.
 *
 * Design rule: AI may help *produce* these rules from the catalog, but only
 * plain code *evaluates* them. Every rule keeps a pointer back to the catalog
 * text it came from so a human (or the student) can check it.
 */

/** Normalized course id, e.g. "CS 1337". */
export type CourseId = string;

// ---------------------------------------------------------------------------
// Catalog: courses
// ---------------------------------------------------------------------------

/** A boolean prerequisite expression parsed from catalog text. */
export type PrereqExpr =
  | { op: "course"; course: CourseId; minGrade?: string; concurrentOk?: boolean }
  | { op: "and"; items: PrereqExpr[] }
  | { op: "or"; items: PrereqExpr[] }
  /** Something code can't check yet (e.g. "instructor consent"). Shown to the student. */
  | { op: "text"; text: string };

export interface Course {
  id: CourseId;
  title: string;
  /** Credit hours. UTD's second course-number digit usually matches. */
  hours: number;
  prereq?: PrereqExpr;
  coreq?: PrereqExpr;
  /** Cross-listed equivalents ("Same as SE 3345"). Taking any one counts as this course. */
  sameAs: CourseId[];
  /**
   * Raw letter after "(3-0)" in the catalog (seen: S, Y, R, T). Its meaning is
   * NOT verified yet, so the planner must not rely on it; use real past section
   * data (Nebula / CourseBook) to decide which terms a course is offered.
   */
  scheduleCode?: string;
  /** Full description text, for display and for re-checking the parse. */
  description: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Catalog: degree requirements
// ---------------------------------------------------------------------------

/** A set of courses a requirement can draw from. */
export interface CourseSet {
  courses?: CourseId[];
  /** e.g. any CS course numbered 4000-4999. */
  patterns?: { subject: string; minNumber: number; maxNumber: number }[];
  /** A UTD Core Curriculum area code, e.g. "010" for Communication. */
  coreArea?: string;
}

export type Requirement =
  /** One specific course; any listed alternative also satisfies it. */
  | { type: "course"; course: CourseId; alternatives?: CourseId[] }
  /** Every item is required. */
  | { type: "all"; items: Requirement[] }
  /** Exactly one option must be fully satisfied (e.g. calculus sequence I or II). */
  | { type: "oneOf"; options: Requirement[] }
  /** At least `hours` credit hours from a set (e.g. 9 hours of technical electives). */
  | { type: "hours"; hours: number; from: CourseSet }
  /** Can't be checked by code; show it to the student instead of guessing. */
  | { type: "manual"; text: string };

/**
 * Which pool of courses a block draws from. Courses may count toward both a
 * "core" block and a "major" block (UTD lists the same courses in both), but a
 * course is only used once by the "hours" blocks within the same domain.
 */
export type Domain = "core" | "major";

export interface RequirementBlock {
  id: string;
  title: string;
  domain: Domain;
  /** Credit hours the catalog states for this block. */
  statedHours?: number;
  /** The catalog's recommended way to satisfy the block. */
  requirement: Requirement;
  /**
   * Another accepted way, e.g. "Or select any 6 semester credit hours from
   * Communication Core courses". The block is met if either path is met.
   */
  alternative?: Requirement;
  /** Catalog notes and footnotes attached to this block, verbatim. */
  notes: string[];
}

export interface DegreeRules {
  programId: string;
  programName: string;
  catalogYear: number;
  sourceUrl: string;
  totalHours: number;
  upperDivisionHours: number;
  blocks: RequirementBlock[];
  /** Catalog lines the builder could not turn into rules. A human must review these. */
  needsReview: string[];
  /** True only after a human checked the rules against a real degree audit. */
  verified: boolean;
  /** How and when the rules were checked (kept across rebuilds). */
  verification?: string;
}

// ---------------------------------------------------------------------------
// Student record
// ---------------------------------------------------------------------------

export type AttemptStatus = "completed" | "in_progress" | "transfer" | "credit_by_exam";

export interface CourseAttempt {
  course: CourseId;
  term: string; // e.g. "2026 Fall"
  hours: number;
  /** Letter grade if any ("A", "B+", "CR", "P", "W", ...). */
  grade?: string;
  status: AttemptStatus;
}

export interface StudentRecord {
  programId: string;
  catalogYear: number;
  attempts: CourseAttempt[];
}
