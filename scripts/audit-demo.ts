/**
 * Print an audit and a next-term plan for a sample student.
 *   npm run audit:demo                # freshman
 *   npm run audit:demo -- sophomore
 */
import { readFileSync } from "node:fs";
import { loadCatalog, loadRules } from "../src/load.js";
import type { StudentRecord } from "../src/model.js";
import { planNextTerm } from "../src/engine/nextTerm.js";
import { audit } from "../src/engine/audit.js";
import * as students from "../tests/fixtures/students.js";

// A sample student name, or a path to a JSON record (e.g. data/students/me.json).
const arg = process.argv[2] ?? "freshmanFall";
const name = arg.endsWith(".json") ? arg : arg;
const record: StudentRecord = arg.endsWith(".json")
  ? JSON.parse(readFileSync(arg, "utf8"))
  : students[arg as keyof typeof students];
const cat = loadCatalog(record.catalogYear);
const rules = loadRules(record.catalogYear, record.programId);
const plan = planNextTerm(rules, record, cat, { maxHours: 15 });

// The plan assumes current classes pass; the progress view shows them as in progress.
const now = audit(rules, record, cat);
const icon = { met: "✅", in_progress: "⏳", unmet: "⬜", unknown: "❔" } as const;
console.log(`\n${rules.programName}, ${rules.catalogYear} catalog: student "${name}"\n`);
for (const b of now.blocks) {
  const left = b.remaining
    .map((r) => (r.kind === "course" ? r.options.join("/") : r.kind === "hours" ? `${r.hours}h of ${r.label}` : r.kind === "choose" ? "one sequence" : r.text))
    .join(", ");
  console.log(`${icon[b.status]} ${b.block.title}${b.path === "alternative" ? " (alt path)" : ""}${left ? `: needs ${left}` : ""}`);
}
for (const u of now.universityChecks) console.log(`${icon[u.status]} ${u.label}: ${u.detail}`);
const t = now.totalHours;
const up = now.upperDivisionHours;
console.log(`\nHours: ${t.credited} done + ${t.inProgress} in progress / ${t.required} required (upper division ${up.credited + up.inProgress}/${up.required})`);
for (const w of now.warnings.filter((w) => !plan.warnings.includes(w))) console.log(`  ! ${w}`);
console.log("");

console.log(`Recommended next term (${plan.plannedHours}h incl. elective slots):`);
for (const s of plan.recommended) {
  console.log(`  ${s.eligibility === "check" ? "❔" : "•"} ${s.course} ${s.title} (${s.hours}h): ${s.reason}${s.unlocks.length ? ` [${s.unlocks.join(", ")}]` : ""}${s.notes.length ? `\n      ${s.notes.join("; ")}` : ""}`);
}
console.log(`\nNot yet takeable:`);
for (const s of plan.blocked.slice(0, 8)) console.log(`  - ${s.course}: ${s.notes.join("; ")}`);
console.log(`\nNotes:`);
for (const w of plan.warnings) console.log(`  ! ${w}`);
