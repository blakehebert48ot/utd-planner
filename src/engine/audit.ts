import type { CourseAttempt, CourseId, CourseSet, DegreeRules, Domain, Requirement, RequirementBlock, StudentRecord } from "../model.js";
import { CatalogIndex, isUpperDivision } from "./catalogIndex.js";
import { earnsCredit, gradeRank } from "./grades.js";

export type Status = "met" | "in_progress" | "unmet" | "unknown";

/** What a student still has to do for an unmet requirement. */
export type Remaining =
  | { kind: "course"; options: CourseId[] }
  /** Pick one option. `started[i]` lists courses already used toward option i. */
  | { kind: "choose"; options: Remaining[][]; started: CourseId[][] }
  | { kind: "hours"; hours: number; from: CourseSet; label: string }
  | { kind: "manual"; text: string };

export interface ReqResult {
  status: Status;
  used: CourseId[];
  remaining: Remaining[];
}

export interface BlockResult extends ReqResult {
  block: RequirementBlock;
  /** "main" if the catalog's listed courses were used, "alternative" for e.g. "any 6 hours of Communication Core". */
  path: "main" | "alternative";
}

export interface AuditResult {
  rules: { programId: string; catalogYear: number; verified: boolean };
  /** Residency and GPA checks that apply to every UTD degree. */
  universityChecks: UniversityCheck[];
  blocks: BlockResult[];
  totalHours: { credited: number; inProgress: number; required: number };
  upperDivisionHours: { credited: number; inProgress: number; required: number };
  /** Plain-language caveats the student should see. */
  warnings: string[];
}

export interface AuditOptions {
  /** Treat in-progress courses as already passed (used when planning next term). */
  assumeInProgressPassed?: boolean;
}

const RANK: Record<Status, number> = { met: 0, in_progress: 1, unknown: 2, unmet: 3 };
const worst = (a: Status, b: Status): Status => (RANK[a] >= RANK[b] ? a : b);

export function audit(rules: DegreeRules, record: StudentRecord, cat: CatalogIndex, opts: AuditOptions = {}): AuditResult {
  const warnings: string[] = [];
  if (!rules.verified) {
    warnings.push(
      `These ${rules.catalogYear} rules for ${rules.programName} have not been checked against an official degree audit yet. Confirm with your advisor.`,
    );
  }
  if (record.catalogYear !== rules.catalogYear) {
    warnings.push(`Your catalog year is ${record.catalogYear}, but these rules are for ${rules.catalogYear}.`);
  }

  // Best attempt per course (repeats count once).
  const credited = new Map<CourseId, CourseAttempt>();
  const inProgress = new Map<CourseId, CourseAttempt>();
  for (const a of record.attempts) {
    if (a.status === "in_progress") {
      if (opts.assumeInProgressPassed) credited.set(a.course, a);
      else inProgress.set(a.course, a);
      continue;
    }
    if (!earnsCredit(a.grade)) continue;
    const prev = credited.get(a.course);
    if (!prev || gradeRank(a.grade) > gradeRank(prev.grade)) credited.set(a.course, a);
  }

  const find = (map: Map<CourseId, CourseAttempt>, id: CourseId) => {
    for (const e of cat.equivalents(id)) {
      const hit = map.get(e);
      if (hit) return hit;
    }
    return undefined;
  };

  const usedByDomain: Record<Domain, Set<CourseId>> = { core: new Set(), major: new Set() };

  function evalReq(req: Requirement, used: Set<CourseId>): ReqResult {
    switch (req.type) {
      case "course": {
        const options = [req.course, ...(req.alternatives ?? [])];
        for (const o of options) {
          const hit = find(credited, o);
          if (hit) return { status: "met", used: [hit.course], remaining: [] };
        }
        for (const o of options) {
          const hit = find(inProgress, o);
          if (hit) return { status: "in_progress", used: [hit.course], remaining: [] };
        }
        return { status: "unmet", used: [], remaining: [{ kind: "course", options }] };
      }
      case "all": {
        // Specific courses claim their courses before "N hours from a set" picks.
        const order = req.items.map((r, i) => ({ r, i })).sort((a, b) => Number(a.r.type === "hours") - Number(b.r.type === "hours"));
        let status: Status = "met";
        const usedAll: CourseId[] = [];
        const remaining: Remaining[] = [];
        for (const { r } of order) {
          const res = evalReq(r, used);
          res.used.forEach((c) => used.add(c));
          usedAll.push(...res.used);
          remaining.push(...res.remaining);
          status = worst(status, res.status);
        }
        return { status, used: usedAll, remaining };
      }
      case "oneOf": {
        const tries = req.options.map((o) => {
          const scratch = new Set(used);
          return evalReq(o, scratch);
        });
        const best = [...tries].sort((a, b) => RANK[a.status] - RANK[b.status] || remainingSize(a) - remainingSize(b))[0]!;
        if (best.status === "met" || best.status === "in_progress") return best;
        // Courses from two different options, none complete: e.g. MATH 2417 then MATH 2414.
        const started = tries.filter((t) => t.used.length);
        if (started.length > 1) {
          const mixed = started.map((t) => t.used.join(" + ")).join(" and ");
          warnings.push(
            `You have courses from different options (${mixed}) and neither option is complete. Check with your advisor which course to take next, or whether a substitution is possible.`,
          );
        }
        return {
          status: best.status,
          used: best.used,
          remaining: [{ kind: "choose", options: tries.map((t) => t.remaining), started: tries.map((t) => t.used) }],
        };
      }
      case "hours": {
        const pick = (map: Map<CourseId, CourseAttempt>) =>
          [...map.values()].filter((a) => !used.has(a.course) && cat.inSet(a.course, req.from));
        let have = 0;
        const picked: CourseId[] = [];
        for (const a of pick(credited)) {
          if (have >= req.hours) break;
          have += a.hours || cat.hours(a.course);
          picked.push(a.course);
        }
        let pending = have;
        for (const a of pick(inProgress)) {
          if (pending >= req.hours) break;
          pending += a.hours || cat.hours(a.course);
          picked.push(a.course);
        }
        const status: Status = have >= req.hours ? "met" : pending >= req.hours ? "in_progress" : "unmet";
        const remaining: Remaining[] =
          status === "unmet" ? [{ kind: "hours", hours: req.hours - pending, from: req.from, label: describeSet(req.from, cat) }] : [];
        return { status, used: picked, remaining };
      }
      case "manual":
        return { status: "unknown", used: [], remaining: [{ kind: "manual", text: req.text }] };
    }
  }

  // Evaluate blocks whose top level is "N hours from a set" last, so specific
  // requirements claim their courses first (e.g. CS 4337 counts as major core,
  // not as a technical elective).
  const order = rules.blocks.map((b, i) => ({ b, i })).sort((x, y) => Number(x.b.requirement.type === "hours") - Number(y.b.requirement.type === "hours"));
  const results: BlockResult[] = new Array(rules.blocks.length);

  let totalCredited = 0;
  let totalInProgress = 0;
  let upperCredited = 0;
  let upperInProgress = 0;
  for (const a of credited.values()) {
    const h = a.hours || cat.hours(a.course);
    totalCredited += h;
    if (isUpperDivision(a.course)) upperCredited += h;
  }
  for (const a of inProgress.values()) {
    const h = a.hours || cat.hours(a.course);
    totalInProgress += h;
    if (isUpperDivision(a.course)) upperInProgress += h;
  }

  for (const { b, i } of order) {
    const used = usedByDomain[b.domain];
    if (b.id === "free-electives") {
      const status: Status =
        totalCredited >= rules.totalHours ? "met" : totalCredited + totalInProgress >= rules.totalHours ? "in_progress" : "unmet";
      const left = Math.max(0, rules.totalHours - totalCredited - totalInProgress);
      results[i] = {
        block: b,
        path: "main",
        status,
        used: [],
        remaining: left ? [{ kind: "hours", hours: left, from: {}, label: "any courses (free electives / total hours)" }] : [],
      };
      continue;
    }
    const mainScratch = new Set(used);
    const main = evalReq(b.requirement, mainScratch);
    let chosen = main;
    let path: "main" | "alternative" = "main";
    let chosenScratch = mainScratch;
    if (main.status !== "met" && b.alternative) {
      const altScratch = new Set(used);
      const alt = evalReq(b.alternative, altScratch);
      if (RANK[alt.status] < RANK[main.status]) {
        chosen = alt;
        path = "alternative";
        chosenScratch = altScratch;
      }
    }
    chosenScratch.forEach((c) => used.add(c));
    results[i] = { block: b, path, ...chosen };
  }

  // University-wide checks from UTD's degree audit (not on the program page).
  let utdHours = 0;
  let utdInProgress = 0;
  let points = 0;
  let gpaHours = 0;
  for (const a of [...credited.values(), ...inProgress.values()]) {
    if (a.status === "transfer" || a.status === "credit_by_exam") continue;
    const h = a.hours || cat.hours(a.course);
    if (a.status === "in_progress") utdInProgress += h;
    else utdHours += h;
    const gp = a.status === "completed" && a.grade ? GRADE_POINTS[a.grade.toUpperCase()] : undefined;
    if (gp !== undefined) {
      points += gp * h;
      gpaHours += h;
    }
  }
  const gpa = gpaHours ? points / gpaHours : undefined;
  const universityChecks: UniversityCheck[] = [
    {
      label: "At least 45 hours taken at UTD",
      status: utdHours >= 45 ? "met" : utdHours + utdInProgress >= 45 ? "in_progress" : "unmet",
      detail: `${utdHours} done + ${utdInProgress} in progress at UTD`,
    },
    {
      label: "UTD GPA of 2.0 or higher",
      status: gpa === undefined ? "unknown" : gpa >= 2 ? "met" : "unmet",
      detail: gpa === undefined ? "No graded UTD courses yet" : `GPA ${gpa.toFixed(2)} from ${gpaHours} graded hours`,
    },
  ];

  return {
    rules: { programId: rules.programId, catalogYear: rules.catalogYear, verified: rules.verified },
    universityChecks,
    blocks: results,
    totalHours: { credited: totalCredited, inProgress: totalInProgress, required: rules.totalHours },
    upperDivisionHours: { credited: upperCredited, inProgress: upperInProgress, required: rules.upperDivisionHours },
    warnings: [...new Set(warnings)],
  };
}

const GRADE_POINTS: Record<string, number> = {
  "A+": 4, A: 4, "A-": 3.67, "B+": 3.33, B: 3, "B-": 2.67, "C+": 2.33, C: 2, "C-": 1.67, "D+": 1.33, D: 1, "D-": 0.67, F: 0,
};

export interface UniversityCheck {
  label: string;
  status: Status;
  detail: string;
}

function remainingSize(r: ReqResult): number {
  return r.remaining.reduce((n, x) => n + (x.kind === "hours" ? Math.ceil(x.hours / 3) : 1), 0);
}

export function describeSet(set: CourseSet, cat: CatalogIndex): string {
  const parts: string[] = [];
  if (set.coreArea) parts.push(`${cat.coreAreas.get(set.coreArea)?.name ?? set.coreArea} core courses`);
  if (set.courses?.length) parts.push(`${set.courses.length} listed courses`);
  for (const p of set.patterns ?? []) parts.push(`any ${p.subject} ${p.minNumber / 1000}000-level course`);
  return parts.join(" or ") || "any course";
}
