/**
 * Build extension/data/prof-stats.json: per course, recent professors' grade stats.
 *   npm run build:ext-data      (needs data/grades/sections.json from npm run fetch:grades)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { SectionGrades } from "../src/grades/parseGrades.js";
import { rankProfessors } from "../src/grades/professorStats.js";
import { type CompactStats, compactOf } from "../src/grades/compactStats.js";

const all = JSON.parse(await readFile("data/grades/sections.json", "utf8")) as SectionGrades[];
const byCourse = new Map<string, SectionGrades[]>();
for (const r of all) {
  const list = byCourse.get(r.course) ?? [];
  list.push(r);
  byCourse.set(r.course, list);
}

const out: CompactStats = { generated: new Date().toISOString().slice(0, 10), courses: {} };
for (const [course, rows] of byCourse) {
  const r = rankProfessors(rows, [course]);
  if (!r.professors.length || !r.graded) continue;
  out.courses[course] = { mean: Math.round(r.meanGpa * 1000) / 1000, profs: r.professors.map(compactOf) };
}
await mkdir("extension/data", { recursive: true });
const json = JSON.stringify(out);
await writeFile("extension/data/prof-stats.json", json);
console.log(`${Object.keys(out.courses).length} courses, ${(json.length / 1024).toFixed(0)} KB`);
