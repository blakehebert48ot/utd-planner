import type { Course, CourseId, CourseSet } from "../model.js";
import type { CoreArea } from "../catalog/parseProgram.js";

/** Fast lookups over the parsed catalog. */
export class CatalogIndex {
  readonly courses = new Map<CourseId, Course>();
  readonly coreAreas = new Map<string, CoreArea>();
  private readonly equiv = new Map<CourseId, Set<CourseId>>();

  constructor(courses: Course[], coreAreas: CoreArea[]) {
    for (const c of courses) this.courses.set(c.id, c);
    for (const a of coreAreas) this.coreAreas.set(a.code, a);
    // Cross-listed courses ("Same as") are interchangeable in both directions.
    for (const c of courses) for (const other of c.sameAs) this.link(c.id, other);
  }

  private link(a: CourseId, b: CourseId) {
    const sa = this.equiv.get(a) ?? new Set([a]);
    const sb = this.equiv.get(b) ?? new Set([b]);
    const merged = new Set([...sa, ...sb]);
    for (const id of merged) this.equiv.set(id, merged);
  }

  /** The course plus every cross-listed equivalent. */
  equivalents(id: CourseId): CourseId[] {
    return [...(this.equiv.get(id) ?? [id])];
  }

  hours(id: CourseId): number {
    const c = this.courses.get(id);
    if (c) return c.hours;
    const digit = Number(id.split(" ")[1]?.[1]);
    return Number.isNaN(digit) ? 3 : digit;
  }

  /** Does a course (or one of its equivalents) belong to a course set? */
  inSet(id: CourseId, set: CourseSet): boolean {
    for (const cid of this.equivalents(id)) {
      if (set.courses?.includes(cid)) return true;
      if (set.coreArea && this.coreAreas.get(set.coreArea)?.courses.includes(cid)) return true;
      const [subj, num] = cid.split(" ");
      const n = Number(num?.replace("V", "0"));
      for (const p of set.patterns ?? []) {
        if (p.subject === subj && n >= p.minNumber && n <= p.maxNumber) return true;
      }
    }
    return false;
  }

  /** All catalog courses that belong to a set (for suggesting electives). */
  expandSet(set: CourseSet): CourseId[] {
    const out = new Set<CourseId>(set.courses ?? []);
    if (set.coreArea) for (const c of this.coreAreas.get(set.coreArea)?.courses ?? []) out.add(c);
    if (set.patterns?.length) for (const id of this.courses.keys()) if (this.inSet(id, { patterns: set.patterns })) out.add(id);
    return [...out];
  }
}

export function isUpperDivision(id: CourseId): boolean {
  return Number(id.split(" ")[1]?.[0]) >= 3;
}
