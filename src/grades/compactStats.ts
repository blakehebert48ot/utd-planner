/**
 * Small per-course professor stats for the Chrome extension (no server needed).
 * Built by scripts/build-ext-data.ts from the public grade CSVs.
 */
import type { CourseId } from "../model.js";
import { type ProfessorStats, summarize } from "./professorStats.js";
import { nameKeys } from "../schedule/fromOrion.js";

/** [name, adjustedGpa, meanGpa, graded, wRate, pctA, pctDF, terms (newest first, comma-joined)] */
export type CompactProf = [string, number, number, number, number, number, number, string];
export interface CompactStats {
  generated: string;
  courses: Record<CourseId, { mean: number; profs: CompactProf[] }>;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function compactOf(p: ProfessorStats): CompactProf {
  return [p.name, r3(p.adjustedGpa), r3(p.meanGpa), p.graded, r3(p.wRate), r3(p.pctA), r3(p.pctDF), p.terms.join(",")];
}

/** Expand one course's compact stats into a lookup that answers to every name variant. */
export function expandCourse(course: CourseId, entry: { mean: number; profs: CompactProf[] } | undefined): Map<string, ProfessorStats> {
  const map = new Map<string, ProfessorStats>();
  if (!entry) return map;
  for (const [name, adjustedGpa, meanGpa, graded, wRate, pctA, pctDF, terms] of entry.profs) {
    const t = terms ? terms.split(",") : [];
    const s: ProfessorStats = {
      name,
      key: nameKeys(name)[0] ?? name.toLowerCase(),
      course,
      sections: 0,
      terms: t,
      graded,
      withdrew: 0,
      dist: [],
      meanGpa,
      adjustedGpa,
      pctA,
      pctDF,
      wRate,
      summary: "",
      rmpSearchUrl: `https://www.ratemyprofessors.com/search/professors/1273?q=${encodeURIComponent(name)}`,
    };
    s.summary = summarize(s, entry.mean);
    for (const k of nameKeys(name)) if (!map.has(k)) map.set(k, s);
  }
  return map;
}
