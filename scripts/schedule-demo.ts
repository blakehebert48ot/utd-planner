/**
 * Full pipeline on one student: plan next term -> rank professors -> build schedules.
 *   npm run schedule:demo -- data/students/me.json --earliest 10:00am --latest 4:00pm --gaps none
 * Flags: --earliest, --latest, --gaps none|some|dontCare, --off Friday, --fewer-days,
 *        --prof easiest|fewestDrops|ignore
 * Uses SAMPLE (made-up) sections until a Nebula key is set up.
 */
import { readFileSync } from "node:fs";
import { loadCatalog, loadRules } from "../src/load.js";
import { planNextTerm } from "../src/engine/nextTerm.js";
import { rankProfessors, type ProfessorStats } from "../src/grades/professorStats.js";
import type { SectionGrades } from "../src/grades/parseGrades.js";
import { buildSchedules, describeWeek, type SchedulePrefs } from "../src/schedule/solver.js";
import { toDay, type Day } from "../src/schedule/time.js";
import type { StudentRecord } from "../src/model.js";
import { SAMPLE_SECTIONS } from "../tests/fixtures/sampleSections.js";
import { freshmanFall } from "../tests/fixtures/students.js";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const recordPath = argv.find((a) => a.endsWith(".json"));
const record: StudentRecord = recordPath ? JSON.parse(readFileSync(recordPath, "utf8")) : freshmanFall;

const prefs: SchedulePrefs = {
  earliest: flag("earliest"),
  latest: flag("latest"),
  gaps: (flag("gaps") as SchedulePrefs["gaps"]) ?? "some",
  daysOff: flag("off")?.split(",").map((d) => toDay(d)).filter((d): d is Day => Boolean(d)),
  fewerDays: argv.includes("--fewer-days"),
  professor: (flag("prof") as SchedulePrefs["professor"]) ?? "easiest",
};

const cat = loadCatalog(record.catalogYear);
const plan = planNextTerm(loadRules(record.catalogYear, record.programId), record, cat);
const grades = JSON.parse(readFileSync("data/grades/sections.json", "utf8")) as SectionGrades[];

const courses = plan.recommended.map((s) => s.course);
console.log(`\nPlanned courses: ${courses.join(", ")}`);
console.log(`Preferences: ${JSON.stringify(prefs)}`);
console.log("⚠️  SAMPLE sections (made-up times and class numbers) until the Nebula key works.\n");

const requests = courses
  .filter((c) => SAMPLE_SECTIONS[c])
  .map((c) => {
    const ranked = rankProfessors(grades, cat.equivalents(c), { rankBy: prefs.professor === "fewestDrops" ? "fewestDrops" : "easiest" });
    return { course: c, sections: SAMPLE_SECTIONS[c]!, professorStats: new Map<string, ProfessorStats>(ranked.professors.map((p) => [p.key, p])) };
  });
const missing = courses.filter((c) => !SAMPLE_SECTIONS[c]);
if (missing.length) console.log(`(no sample sections for ${missing.join(", ")}; skipped)\n`);

const result = buildSchedules(requests, prefs);
if (result.filtered.length) console.log(`Skipped ${result.filtered.length} sections: ${result.filtered.map((f) => `${f.course}-${f.section} (${f.why})`).join(", ")}`);
for (const d of result.dropped) console.log(`✗ Couldn't fit ${d.course}: ${d.why}`);
if (!result.options.length) console.log("No schedule fits these rules. Try widening the time window.");

for (const o of result.options) {
  console.log(`\n━━ Plan ${"ABC"[o.rank - 1] ?? o.rank} (score ${o.score}) ━━`);
  for (const line of describeWeek(o.week)) console.log("  " + line);
  console.log("  Why: " + o.reasons.join("; "));
  if (o.warnings.length) console.log("  Heads up: " + o.warnings.join("; "));
  console.log("  Teachers:");
  for (const t of o.teachers) {
    console.log(`    ${t.course}-${t.section} ${t.name}: ${t.stats ? t.stats.summary : "No grade history yet."}`);
    if (t.stats) console.log(`      RMP: ${t.stats.rmpSearchUrl}`);
  }
  console.log(`  Cart: ${o.classNumbers.join(", ")}`);
}
