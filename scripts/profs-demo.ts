/**
 * Rank professors for courses from public grade data.
 *   npm run profs -- "CS 2336" "MATH 2419"
 *   npm run profs -- "CS 2336" --fewest-drops
 */
import { readFileSync } from "node:fs";
import { loadCatalog } from "../src/load.js";
import { rankProfessors } from "../src/grades/professorStats.js";
import type { SectionGrades } from "../src/grades/parseGrades.js";

const args = process.argv.slice(2);
const rankBy = args.includes("--fewest-drops") ? "fewestDrops" : "easiest";
const courses = args.filter((a) => !a.startsWith("--"));
const all = JSON.parse(readFileSync("data/grades/sections.json", "utf8")) as SectionGrades[];
const cat = loadCatalog(2026);

for (const c of courses.length ? courses : ["CS 2336"]) {
  const ids = cat.equivalents(c); // CS 3345 also counts SE/CE 3345 sections
  const r = rankProfessors(all, ids, { rankBy });
  console.log(`\n${c} (${ids.join(" / ")}): course average GPA ${r.meanGpa.toFixed(2)} over ${r.graded} students, last ~4 years. Ranked by ${rankBy}.`);
  for (const [i, p] of r.professors.slice(0, 8).entries()) {
    console.log(`  ${i + 1}. ${p.name}: ${p.summary}`);
  }
  if (r.professors.length > 8) console.log(`  … and ${r.professors.length - 8} more`);
}
