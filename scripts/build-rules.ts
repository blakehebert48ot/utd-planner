/**
 * Build machine-checkable rules from the UTD catalog.
 *
 *   npm run build:rules            # CS BS, 2026 catalog
 *
 * Output (committed, reviewed by a human):
 *   data/catalog/<year>/courses.json
 *   data/catalog/<year>/core-curriculum.json
 *   data/catalog/<year>/programs/<id>.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fetchCatalogPage, programUrl } from "../src/catalog/fetch.js";
import { coursesIn, parseCourseListing } from "../src/catalog/parseCourses.js";
import { buildRules, parseCoreCurriculum, parseProgramPage } from "../src/catalog/parseProgram.js";
import type { Course, DegreeRules, Requirement } from "../src/model.js";

const YEAR = 2026;
const PROGRAMS = [{ id: "cs-bs", school: "ecs", slug: "computer-science" }];

async function main() {
  const out = `data/catalog/${YEAR}`;
  await mkdir(`${out}/programs`, { recursive: true });

  const core = parseCoreCurriculum(await fetchCatalogPage(YEAR, "curriculum/core-curriculum"));
  const coreAreaCodes = Object.fromEntries(core.map((a) => [a.name, a.code]));
  await writeFile(`${out}/core-curriculum.json`, JSON.stringify(core, null, 2) + "\n");
  console.log(`core curriculum: ${core.length} areas, ${core.reduce((n, a) => n + a.courses.length, 0)} courses`);

  // Substitutions the official degree audit accepts but the catalog page doesn't list.
  const overrides = (await readFile(`${out}/program-overrides.json`, "utf8").then(JSON.parse).catch(() => ({}))) as Record<
    string,
    { source: string; alternatives: Record<string, string[]> }
  >;

  const subjects = new Set<string>();
  for (const p of PROGRAMS) {
    const html = await fetchCatalogPage(YEAR, `programs/${p.school}/${p.slug}`);
    const rules = buildRules(parseProgramPage(html), {
      programId: p.id,
      catalogYear: YEAR,
      sourceUrl: programUrl(YEAR, p.school, p.slug),
      coreAreaCodes,
    });
    applyOverrides(rules, overrides[p.id]);
    // Never overwrite a human's "verified" flag silently.
    const file = `${out}/programs/${p.id}.json`;
    const prev = await readFile(file, "utf8").then(JSON.parse).catch(() => undefined) as DegreeRules | undefined;
    if (prev?.verification) rules.verification = prev.verification;
    if (prev?.verified) {
      const changed = JSON.stringify({ ...prev, verified: false }) !== JSON.stringify(rules);
      rules.verified = !changed;
      if (changed) console.warn(`!! ${p.id}: catalog changed since it was verified. Re-check it, then set "verified": true.`);
    }
    await writeFile(file, JSON.stringify(rules, null, 2) + "\n");
    console.log(`${p.id}: ${rules.blocks.length} blocks, ${rules.needsReview.length} lines need review`);
    for (const b of rules.blocks) collectSubjects(b.requirement, subjects), b.alternative && collectSubjects(b.alternative, subjects);
  }

  // Course details for every subject the rules mention, plus subjects their prerequisites mention.
  const courses = new Map<string, Course>();
  const fetched = new Set<string>();
  for (let round = 0; round < 2; round++) {
    for (const s of [...subjects]) {
      if (fetched.has(s)) continue;
      fetched.add(s);
      try {
        for (const c of parseCourseListing(await fetchCatalogPage(YEAR, `courses/${s.toLowerCase()}`))) courses.set(c.id, c);
      } catch (e) {
        console.warn(`could not fetch subject ${s}: ${(e as Error).message}`);
      }
    }
    for (const c of courses.values()) for (const id of [...coursesIn(c.prereq), ...coursesIn(c.coreq), ...c.sameAs]) subjects.add(id.split(" ")[0]!);
  }
  const list = [...courses.values()].sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(`${out}/courses.json`, JSON.stringify(list, null, 2) + "\n");
  console.log(`courses: ${list.length} from ${fetched.size} subjects`);
}

function applyOverrides(rules: DegreeRules, o?: { source: string; alternatives: Record<string, string[]> }) {
  if (!o) return;
  const visit = (r: Requirement) => {
    if (r.type === "course") {
      const extra = o.alternatives[r.course] ?? [];
      for (const alt of extra) if (!(r.alternatives ?? []).includes(alt)) (r.alternatives ??= []).push(alt);
    } else if (r.type === "all") r.items.forEach(visit);
    else if (r.type === "oneOf") r.options.forEach(visit);
  };
  for (const b of rules.blocks) {
    visit(b.requirement);
    if (b.alternative) visit(b.alternative);
  }
  rules.needsReview.push(`Overrides applied (${o.source})`);
}

function collectSubjects(r: Requirement, into: Set<string>) {
  if (r.type === "course") [r.course, ...(r.alternatives ?? [])].forEach((c) => into.add(c.split(" ")[0]!));
  else if (r.type === "all") r.items.forEach((x) => collectSubjects(x, into));
  else if (r.type === "oneOf") r.options.forEach((x) => collectSubjects(x, into));
  else if (r.type === "hours") {
    r.from.courses?.forEach((c) => into.add(c.split(" ")[0]!));
    r.from.patterns?.forEach((p) => into.add(p.subject));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
