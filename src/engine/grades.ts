const ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];

/** Grades that never earn credit. */
const NO_CREDIT = new Set(["F", "W", "WL", "I", "NC", "NF", "X", "U"]);
/** Pass-type grades that earn credit but have no letter value. */
const PASS_TYPE = new Set(["CR", "P", "S", "T", "TA", "TB", "TC"]);

/** Did this grade earn credit at all? Missing grade (transfer, exam credit) counts as credit. */
export function earnsCredit(grade: string | undefined): boolean {
  if (!grade) return true;
  return !NO_CREDIT.has(grade.toUpperCase());
}

/**
 * Does `grade` meet a minimum like "C"? Pass-type grades and missing grades are
 * treated as meeting it, but callers should surface that as an assumption.
 */
export function meetsMinGrade(grade: string | undefined, min: string | undefined): boolean {
  if (!earnsCredit(grade)) return false;
  if (!min || !grade) return true;
  const g = grade.toUpperCase();
  if (PASS_TYPE.has(g)) return true;
  const gi = ORDER.indexOf(g);
  const mi = ORDER.indexOf(min.toUpperCase());
  if (gi < 0 || mi < 0) return true;
  return gi <= mi;
}

/** Higher is better; used to keep the best attempt when a course was repeated. */
export function gradeRank(grade: string | undefined): number {
  if (!grade) return ORDER.length;
  const i = ORDER.indexOf(grade.toUpperCase());
  if (i >= 0) return ORDER.length - i;
  return earnsCredit(grade) ? ORDER.length - 8 : -1;
}
