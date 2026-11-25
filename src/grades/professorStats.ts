import type { CourseId } from "../model.js";
import { GRADE_POINTS, type SectionGrades } from "./parseGrades.js";

/**
 * What a student actually wants to know about a professor for one course,
 * computed only from public grade distributions.
 *
 * Honest limit: grades measure how a professor *grades*, not how well they
 * *teach*. The UI must say so and link to Rate My Professors for the rest.
 */
export interface ProfessorStats {
  name: string; // "Gordon Arnold"
  key: string; // "arnold|gordon" for matching against section data
  course: CourseId;
  sections: number;
  terms: string[]; // newest first, e.g. ["25F", "25S"]
  /** Students with a letter grade (A+ … F). */
  graded: number;
  withdrew: number;
  dist: number[];
  meanGpa: number;
  /** meanGpa pulled toward the course average when there's little data (fair to new professors). */
  adjustedGpa: number;
  pctA: number; // A+, A, A-
  pctDF: number; // D+ … F
  wRate: number; // W / (graded + W)
  summary: string;
  rmpSearchUrl: string;
}

export interface CourseGradeOverview {
  course: CourseId;
  meanGpa: number;
  graded: number;
  professors: ProfessorStats[];
}

export type RankBy = "easiest" | "fewestDrops";

export interface RankOptions {
  /** Only count semesters at or after this term (e.g. "22F"). Defaults to the last ~4 years of data. */
  since?: string;
  rankBy?: RankBy;
  /** How many students of "course average" to blend in (higher = more cautious with small samples). */
  priorWeight?: number;
}

/** "25F" -> sortable 2025*10+3. Summer = U. */
export function termKey(t: string): number {
  const m = t.match(/^(\d{2})([SUF])$/);
  if (!m) return 0;
  return (2000 + Number(m[1])) * 10 + { S: 1, U: 2, F: 3 }[m[2] as "S" | "U" | "F"];
}

export function profKey(last: string, first: string): string {
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
  return `${norm(last)}|${norm(first)}`;
}

/**
 * Rank everyone who taught a course (and its cross-listed equivalents) by
 * their grade history.
 */
export function rankProfessors(all: SectionGrades[], courses: CourseId[], opts: RankOptions = {}): CourseGradeOverview {
  const wanted = new Set(courses);
  const rows = all.filter((r) => wanted.has(r.course));
  const latest = Math.max(0, ...rows.map((r) => termKey(r.term)));
  const since = opts.since ? termKey(opts.since) : latest - 40; // ~4 years back
  const recent = rows.filter((r) => termKey(r.term) >= since);

  // Course-wide average, used to keep tiny samples from dominating.
  const courseDist = sum(recent.map((r) => r.dist));
  const courseGraded = gradedCount(courseDist);
  const courseMean = gpa(courseDist);
  const k = opts.priorWeight ?? 40;

  const byProf = new Map<string, { name: string; rows: SectionGrades[] }>();
  for (const r of recent) {
    // Co-taught sections count for each listed instructor.
    for (const ins of r.instructors) {
      const key = profKey(ins.last, ins.first);
      const e = byProf.get(key) ?? { name: `${ins.first} ${ins.last}`.trim(), rows: [] };
      e.rows.push(r);
      byProf.set(key, e);
    }
  }

  const professors: ProfessorStats[] = [...byProf.entries()].map(([key, { name, rows: rs }]) => {
    const dist = sum(rs.map((r) => r.dist));
    const graded = gradedCount(dist);
    const withdrew = dist[13] ?? 0;
    const meanGpa = gpa(dist);
    const adjustedGpa = graded + k > 0 ? (meanGpa * graded + courseMean * k) / (graded + k) : courseMean;
    const pctA = graded ? (dist[0]! + dist[1]! + dist[2]!) / graded : 0;
    const pctDF = graded ? (dist[9]! + dist[10]! + dist[11]! + dist[12]!) / graded : 0;
    const wRate = graded + withdrew ? withdrew / (graded + withdrew) : 0;
    const terms = [...new Set(rs.map((r) => r.term))].sort((a, b) => termKey(b) - termKey(a));
    const s: ProfessorStats = {
      name,
      key,
      course: courses[0]!,
      sections: rs.length,
      terms,
      graded,
      withdrew,
      dist,
      meanGpa,
      adjustedGpa,
      pctA,
      pctDF,
      wRate,
      summary: "",
      rmpSearchUrl: `https://www.ratemyprofessors.com/search/professors/1273?q=${encodeURIComponent(name)}`,
    };
    s.summary = summarize(s, courseMean);
    return s;
  });

  const rankBy = opts.rankBy ?? "easiest";
  professors.sort((a, b) =>
    rankBy === "fewestDrops" ? a.wRate - b.wRate || b.adjustedGpa - a.adjustedGpa : b.adjustedGpa - a.adjustedGpa || a.wRate - b.wRate,
  );
  return { course: courses[0]!, meanGpa: courseMean, graded: courseGraded, professors };
}

export function summarize(s: Pick<ProfessorStats, "meanGpa" | "graded" | "terms" | "pctA" | "pctDF" | "wRate">, courseMean: number): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const diff = s.meanGpa - courseMean;
  const vs = Math.abs(diff) < 0.1 ? "about the course average" : diff > 0 ? `${diff.toFixed(2)} above the course average` : `${(-diff).toFixed(2)} below the course average`;
  const sample = s.graded < 60 ? ` Small sample (${s.graded} students), so treat this loosely.` : "";
  return (
    `Average GPA ${s.meanGpa.toFixed(2)} (${vs}) across ${s.graded} students in ${s.terms.length} semester${s.terms.length > 1 ? "s" : ""}, ` +
    `last taught ${s.terms[0]}. ${pct(s.pctA)} got an A, ${pct(s.pctDF)} got a D or F, ${pct(s.wRate)} withdrew.${sample}`
  );
}

function sum(dists: number[][]): number[] {
  const out = new Array(14).fill(0) as number[];
  for (const d of dists) for (let i = 0; i < 14; i++) out[i]! += d[i] ?? 0;
  return out;
}

function gradedCount(d: number[]): number {
  return d.slice(0, 13).reduce((a, b) => a + b, 0);
}

function gpa(d: number[]): number {
  const n = gradedCount(d);
  if (!n) return 0;
  return GRADE_POINTS.reduce((acc, p, i) => acc + p * (d[i] ?? 0), 0) / n;
}
