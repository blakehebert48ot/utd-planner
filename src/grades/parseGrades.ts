import type { CourseId } from "../model.js";

/**
 * Letter grades in the order Nebula uses everywhere (CSV loader, API arrays,
 * UTD Trends). Index 13 is W (withdrew). Confirmed from Nebula's
 * api-tools/parser/gradeLoader.go and utd-trends/src/modules/fetchGrades.ts.
 */
export const GRADE_ORDER = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "W"] as const;
export const GRADE_POINTS = [4, 4, 3.67, 3.33, 3, 2.67, 2.33, 2, 1.67, 1.33, 1, 0.67, 0];

export interface Instructor {
  /** As written in the data: "Arnold, Gordon L". */
  raw: string;
  last: string;
  first: string;
}

export interface SectionGrades {
  term: string; // "25F", "26S", "24U"
  course: CourseId;
  section: string;
  /** Counts in GRADE_ORDER (14 numbers: A+ … F, W). */
  dist: number[];
  instructors: Instructor[];
}

export function parseInstructor(raw: string): Instructor | undefined {
  const s = raw.trim();
  if (!s) return undefined;
  const [last, rest = ""] = s.split(",").map((x) => x.trim());
  return { raw: s, last: last ?? "", first: rest.split(/\s+/)[0] ?? "" };
}

/** Minimal CSV parser (handles quoted fields with commas and doubled quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** Column names vary by year ("Catalog Nbr" vs "Catalog Number", "W" vs "Total W"). */
const ALIASES: Record<string, string[]> = {
  subject: ["Subject"],
  number: ["Catalog Nbr", "Catalog Number"],
  section: ["Section"],
  W: ["W", "Total W", "W Total"],
};

export function parseGradeCsv(text: string, term: string): { rows: SectionGrades[]; warnings: string[] } {
  const warnings: string[] = [];
  const [header, ...data] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return { rows: [], warnings: ["empty file"] };
  const h = header.map((x) => x.trim());
  const col = (names: string[]) => h.findIndex((x) => names.includes(x));
  const subj = col(ALIASES.subject!);
  const num = col(ALIASES.number!);
  const sec = col(ALIASES.section!);
  const gradeCols = GRADE_ORDER.map((g) => (g === "W" ? col(ALIASES.W!) : col([g])));
  // Only "Instructor 1".."Instructor 6". Newer files (26S+) also have instructor_id
  // (a NetID) and instructor_name_normalized, which would double-count people.
  const instCols = h.map((x, i) => (/^Instructor \d+$/i.test(x) ? i : -1)).filter((i) => i >= 0);
  if (subj < 0 || num < 0 || sec < 0) return { rows: [], warnings: [`missing Subject/Catalog/Section columns: ${h.join("|")}`] };
  gradeCols.forEach((c, i) => c < 0 && warnings.push(`no ${GRADE_ORDER[i]} column`));
  if (!instCols.length) warnings.push("no instructor columns");

  const rows: SectionGrades[] = [];
  for (const r of data) {
    const s = r[subj]?.trim();
    const n = r[num]?.trim();
    if (!s || !n) continue;
    rows.push({
      term,
      course: `${s} ${n}`,
      section: (r[sec] ?? "").trim(),
      dist: gradeCols.map((c) => (c >= 0 ? Number(r[c]) || 0 : 0)),
      instructors: instCols.map((c) => parseInstructor(r[c] ?? "")).filter((x): x is Instructor => Boolean(x)),
    });
  }
  return { rows, warnings };
}
