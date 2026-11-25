/**
 * Download UTD grade distributions (public-records data published by Nebula
 * Labs, MIT license) and build per-course, per-instructor aggregates.
 *
 *   npm run fetch:grades
 *
 * Raw CSVs:   data/raw/grades/<term>.csv  (cached, gitignored)
 * Output:     data/grades/sections.json   (one row per section per term)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseGradeCsv } from "../src/grades/parseGrades.js";
import type { SectionGrades } from "../src/grades/parseGrades.js";

const REPO = "UTDNebula/api-tools";
const BRANCH = "develop";
const DIR = "static-data/grades";
const UA = { "User-Agent": "utd-planner (student project)" };

async function main() {
  await mkdir("data/raw/grades", { recursive: true });
  await mkdir("data/grades", { recursive: true });

  const tree = (await (await fetch(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`, { headers: UA })).json()) as {
    tree: { path: string }[];
  };
  const terms = tree.tree
    .map((t) => t.path)
    .filter((p) => p.startsWith(DIR + "/") && p.endsWith(".csv"))
    .map((p) => p.slice(DIR.length + 1, -4))
    .sort();

  const all: SectionGrades[] = [];
  for (const term of terms) {
    const file = `data/raw/grades/${term}.csv`;
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${DIR}/${term}.csv`, { headers: UA });
      if (!res.ok) throw new Error(`${term}: ${res.status}`);
      text = await res.text();
      await writeFile(file, text);
      await new Promise((r) => setTimeout(r, 300));
    }
    const { rows, warnings } = parseGradeCsv(text, term);
    for (const w of warnings) console.warn(`  ${term}: ${w}`);
    all.push(...rows);
    console.log(`${term}: ${rows.length} sections`);
  }
  await writeFile("data/grades/sections.json", JSON.stringify(all));
  console.log(`total: ${all.length} sections from ${terms.length} terms`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
