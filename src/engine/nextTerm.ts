import type { CourseAttempt, CourseId, CourseSet, DegreeRules, PrereqExpr, StudentRecord } from "../model.js";
import { audit, describeSet, type AuditResult, type Remaining } from "./audit.js";
import { CatalogIndex } from "./catalogIndex.js";
import { gradeRank, meetsMinGrade } from "./grades.js";

export interface PlanOptions {
  /** Credit-hour cap for the term (UTD full-time is 12+; 15 is a typical load). */
  maxHours?: number;
}

export type Eligibility = "eligible" | "check" | "blocked";

export interface Suggestion {
  course: CourseId;
  hours: number;
  title: string;
  /** Which degree block this fills. */
  fills: string;
  eligibility: Eligibility;
  /** Why it's ranked where it is, in plain language. */
  reason: string;
  /** Remaining required courses this one is a prerequisite for (directly or indirectly). */
  unlocks: CourseId[];
  /** Conditions code couldn't check ("instructor consent required"), or missing prereqs if blocked. */
  notes: string[];
  /** Courses that must be taken in the same term (corequisites). */
  takeWith: CourseId[];
}

export interface ElectiveSlot {
  fills: string;
  hours: number;
  label: string;
  /** Eligible example courses, best first. Empty when the set is a whole core area (the student picks). */
  eligibleOptions: CourseId[];
}

export interface NextTermPlan {
  audit: AuditResult;
  recommended: Suggestion[];
  electiveSlots: ElectiveSlot[];
  /** Required courses not yet takeable, with what's missing. */
  blocked: Suggestion[];
  plannedHours: number;
  warnings: string[];
}

/**
 * Suggest next term's courses. In-progress courses are assumed passed (the
 * student is planning *after* this term), which the warnings say out loud.
 */
export function planNextTerm(rules: DegreeRules, record: StudentRecord, cat: CatalogIndex, opts: PlanOptions = {}): NextTermPlan {
  const maxHours = opts.maxHours ?? 15;
  const result = audit(rules, record, cat, { assumeInProgressPassed: true });
  const warnings = [...result.warnings];
  if (record.attempts.some((a) => a.status === "in_progress")) {
    warnings.push("This plan assumes you pass the classes you're taking now with at least a C.");
  }

  // Best attempt per course. An in-progress retake only counts if there's no passing attempt.
  const done = new Map<CourseId, CourseAttempt>();
  for (const a of record.attempts) {
    const prev = done.get(a.course);
    if (!prev) done.set(a.course, a);
    else if (a.status === "in_progress") {
      if (!meetsMinGrade(prev.grade, "C")) done.set(a.course, a);
    } else if (prev.status !== "in_progress" && gradeRank(a.grade) > gradeRank(prev.grade)) done.set(a.course, a);
  }
  const hasPassed = (id: CourseId, minGrade?: string) =>
    cat.equivalents(id).some((e) => {
      const a = done.get(e);
      if (!a) return false;
      return a.status === "in_progress" ? true : meetsMinGrade(a.grade, minGrade);
    });

  // 1. Collect the specific courses still needed, and the open elective slots.
  const needed: { course: CourseId; fills: string; alternatives: CourseId[]; advisorNote?: string }[] = [];
  const slots: { fills: string; hours: number; from: CourseSet }[] = [];
  const termOf = (id: CourseId) => termKey(record.attempts.find((a) => cat.equivalents(id).includes(a.course))?.term);
  for (const b of result.blocks) {
    if (b.status === "met" || b.status === "in_progress") continue;
    for (const r of b.remaining) collect(r, b.block.title);
  }
  function collect(r: Remaining, fills: string, advisorNote?: string) {
    if (r.kind === "course") {
      if (!needed.some((n) => r.options.includes(n.course)))
        needed.push({ course: r.options[0]!, fills, alternatives: r.options.slice(1), advisorNote });
    } else if (r.kind === "choose") {
      const startedIdx = r.started.map((s, i) => ({ s, i })).filter((x) => x.s.length);
      let pick: number;
      let note: string | undefined;
      if (startedIdx.length > 1) {
        // Courses from more than one option (e.g. MATH 2417 then MATH 2414): continue the
        // option the student started first, and say an advisor should confirm.
        pick = [...startedIdx].sort((a, b) => Math.min(...a.s.map(termOf)) - Math.min(...b.s.map(termOf)))[0]!.i;
        note = `You have courses from two different options for ${fills} (${startedIdx.map((x) => x.s.join(" + ")).join(" vs ")}). This continues the one you started first; confirm with your advisor.`;
      } else if (startedIdx.length === 1) {
        pick = startedIdx[0]!.i;
      } else {
        // Nothing started: the option with the least left to do.
        pick = r.options.map((o, i) => ({ n: o.length, i })).sort((a, b) => a.n - b.n)[0]?.i ?? 0;
      }
      (r.options[pick] ?? []).forEach((x) => collect(x, fills, note ?? advisorNote));
    } else if (r.kind === "hours" && Object.keys(r.from).length) {
      slots.push({ fills, hours: r.hours, from: r.from });
    }
  }

  // 2. How many remaining required courses depend on each course (directly or through a chain).
  const neededIds = new Set(needed.flatMap((n) => [n.course, ...n.alternatives].flatMap((c) => cat.equivalents(c))));
  const dependents = new Map<CourseId, Set<CourseId>>();
  for (const n of needed) {
    for (const pre of prereqCourses(cat.courses.get(n.course)?.prereq)) {
      for (const e of cat.equivalents(pre)) {
        if (!dependents.has(e)) dependents.set(e, new Set());
        dependents.get(e)!.add(n.course);
      }
    }
  }
  const unlocksOf = (id: CourseId): CourseId[] => {
    const seen = new Set<CourseId>();
    const stack = [...(dependents.get(id) ?? [])];
    while (stack.length) {
      const d = stack.pop()!;
      if (seen.has(d) || !neededIds.has(d)) continue;
      seen.add(d);
      stack.push(...(dependents.get(d) ?? []));
    }
    return [...seen].sort();
  };

  // 3. Check prerequisites for each needed course.
  const suggestions: Suggestion[] = needed.map((n) => {
    const c = cat.courses.get(n.course);
    const check = checkExpr(c?.prereq, hasPassed);
    const unlocks = unlocksOf(n.course);
    const notes = [...check.notes];
    if (n.advisorNote) notes.unshift(n.advisorNote);
    return {
      course: n.course,
      hours: cat.hours(n.course),
      title: c?.title ?? "",
      fills: n.fills,
      eligibility: check.result === false ? "blocked" : check.result === "unknown" || n.advisorNote ? "check" : "eligible",
      reason: unlocks.length ? `Prerequisite for ${unlocks.length} course${unlocks.length > 1 ? "s" : ""} you still need` : "Required, no other course waits on it",
      unlocks,
      notes,
      takeWith: [],
    };
  });

  // Corequisites: a course is only takeable this term if its corequisites are already
  // done or can be added alongside it (e.g. CS 4141 needs CS 4341 in the same term).
  const prereqOk = new Map(suggestions.map((s) => [s.course, s.eligibility !== "blocked"]));
  const partnersFor = (s: Suggestion, chosen: Set<CourseId>): CourseId[] | undefined => {
    const coreq = cat.courses.get(s.course)?.coreq;
    if (!coreq) return [];
    const add: CourseId[] = [];
    const ok = () => checkExpr(coreq, (id, g) => hasPassed(id, g) || chosen.has(id) || add.includes(id)).result !== false;
    if (ok()) return add;
    for (const id of prereqCourses(coreq)) {
      if (hasPassed(id) || chosen.has(id) || !prereqOk.get(id)) continue;
      add.push(id);
      if (ok()) return add;
    }
    return undefined; // can't be satisfied this term
  };
  for (const s of suggestions) {
    if (s.eligibility === "blocked") continue;
    const everyone = new Set(suggestions.filter((x) => x.eligibility !== "blocked").map((x) => x.course));
    if (partnersFor(s, everyone) === undefined) {
      s.eligibility = "blocked";
      s.notes.push(`Must be taken in the same term as ${prereqCourses(cat.courses.get(s.course)?.coreq).join(" or ")}, which you can't take yet`);
    }
  }

  // 4. Pick the highest-impact eligible courses up to the hour cap. Courses that
  //    unlock long chains go first, since delaying them delays graduation.
  const rank = (s: Suggestion) => s.unlocks.length * 10 - Number(s.course.split(" ")[1]?.replace("V", "0")) / 1000;
  const takeable = suggestions.filter((s) => s.eligibility !== "blocked").sort((a, b) => rank(b) - rank(a));
  const recommended: Suggestion[] = [];
  let hours = 0;
  const chosen = new Set<CourseId>();
  for (const s of takeable) {
    if (chosen.has(s.course)) continue;
    const ids = partnersFor(s, chosen);
    if (ids === undefined) continue;
    const partners = ids.map((id) => takeable.find((t) => t.course === id)).filter((x): x is Suggestion => Boolean(x));
    const total = s.hours + partners.reduce((n, p) => n + p.hours, 0);
    if (hours + total > maxHours) continue;
    s.takeWith = partners.map((p) => p.course);
    for (const x of [s, ...partners]) {
      chosen.add(x.course);
      recommended.push(x);
      hours += x.hours;
    }
  }

  // 5. Elective / core slots: list eligible options so the student (or the professor ranker) can choose.
  const electiveSlots: ElectiveSlot[] = slots.map((s) => {
    const options = s.from.coreArea
      ? []
      : cat
          .expandSet(s.from)
          .filter((id) => !hasPassed(id) && checkExpr(cat.courses.get(id)?.prereq, hasPassed).result !== false)
          .sort();
    return { fills: s.fills, hours: s.hours, label: describeSet(s.from, cat), eligibleOptions: options };
  });
  for (const slot of electiveSlots) {
    if (hours + 3 <= maxHours) {
      hours += 3;
      warnings.push(`Room for one ${slot.fills} course (${slot.label}); pick one and the schedule step will rank sections.`);
    }
  }

  return {
    audit: result,
    recommended,
    electiveSlots,
    blocked: suggestions.filter((s) => s.eligibility === "blocked"),
    plannedHours: hours,
    warnings,
  };
}

/** Sortable key for "2027 Spring" style terms; unknown terms sort last. */
function termKey(term: string | undefined): number {
  const m = term?.match(/(\d{4})\s+(Spring|Summer|Fall)/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return Number(m[1]) * 10 + { spring: 1, summer: 2, fall: 3 }[m[2]!.toLowerCase() as "spring" | "summer" | "fall"];
}

function prereqCourses(e: PrereqExpr | undefined): CourseId[] {
  if (!e) return [];
  if (e.op === "course") return [e.course];
  if (e.op === "text") return [];
  return e.items.flatMap(prereqCourses);
}

/** Evaluate a prerequisite expression: true, false, or "unknown" when it hinges on text code can't check. */
export function checkExpr(
  e: PrereqExpr | undefined,
  hasPassed: (id: CourseId, minGrade?: string) => boolean,
): { result: true | false | "unknown"; notes: string[] } {
  if (!e) return { result: true, notes: [] };
  switch (e.op) {
    case "course":
      return hasPassed(e.course, e.minGrade)
        ? { result: true, notes: [] }
        : { result: false, notes: [`Needs ${e.course}${e.minGrade ? ` (${e.minGrade} or better)` : ""}`] };
    case "text":
      return { result: "unknown", notes: [`Check: "${e.text}"`] };
    case "or": {
      const parts = e.items.map((x) => checkExpr(x, hasPassed));
      if (parts.some((p) => p.result === true)) return { result: true, notes: [] };
      if (parts.some((p) => p.result === "unknown")) return { result: "unknown", notes: parts.flatMap((p) => p.notes) };
      return { result: false, notes: [`Needs one of: ${parts.flatMap((p) => p.notes).map((n) => n.replace(/^Needs /, "")).join(", ")}`] };
    }
    case "and": {
      const parts = e.items.map((x) => checkExpr(x, hasPassed));
      if (parts.some((p) => p.result === false)) return { result: false, notes: parts.filter((p) => p.result === false).flatMap((p) => p.notes) };
      if (parts.some((p) => p.result === "unknown")) return { result: "unknown", notes: parts.flatMap((p) => p.notes) };
      return { result: true, notes: [] };
    }
  }
}
