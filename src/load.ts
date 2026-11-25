import { readFileSync } from "node:fs";
import type { Course, DegreeRules } from "./model.js";
import type { CoreArea } from "./catalog/parseProgram.js";
import { CatalogIndex } from "./engine/catalogIndex.js";

/** Load the generated catalog data for a year. */
export function loadCatalog(year: number, root = "data/catalog"): CatalogIndex {
  const courses = JSON.parse(readFileSync(`${root}/${year}/courses.json`, "utf8")) as Course[];
  const core = JSON.parse(readFileSync(`${root}/${year}/core-curriculum.json`, "utf8")) as CoreArea[];
  return new CatalogIndex(courses, core);
}

export function loadRules(year: number, programId: string, root = "data/catalog"): DegreeRules {
  return JSON.parse(readFileSync(`${root}/${year}/programs/${programId}.json`, "utf8")) as DegreeRules;
}
