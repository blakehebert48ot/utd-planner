import * as cheerio from "cheerio";
import type { Course, CourseId, PrereqExpr } from "../model.js";

/** Course numbers are 4 characters; variable-credit courses use V as the 2nd (e.g. CS 4V98). */
const COURSE_RE = /\b([A-Z]{2,4}) (\d[0-9V]\d{2})\b/;

export function normalizeCourseId(text: string): CourseId | undefined {
  const m = text.toUpperCase().match(COURSE_RE);
  return m ? `${m[1]} ${m[2]}` : undefined;
}

/** Parse a catalog subject listing page (e.g. /courses/cs) into courses. */
export function parseCourseListing(html: string): Course[] {
  const $ = cheerio.load(html);
  const courses: Course[] = [];
  $("span.course_address").each((_, el) => {
    const p = $(el).closest("p");
    const course = parseCourseParagraph($, p);
    if (course) courses.push(course);
  });
  return courses;
}

function parseCourseParagraph($: cheerio.CheerioAPI, p: cheerio.Cheerio<any>): Course | undefined {
  const idText = p.find("span.course_address").first().text();
  const id = normalizeCourseId(idText);
  if (!id) return undefined;
  const title = p.find("span.course_title").first().text().trim();
  const hoursText = p.find("span.course_hours").first().text();
  const hoursMatch = hoursText.match(/(\d+)(?:-(\d+))?\s*semester credit hour/);
  // Variable-credit courses ("1-6 semester credit hours") use the minimum for planning.
  const digit = Number(id.split(" ")[1]![1]);
  const hours = hoursMatch ? Number(hoursMatch[1]) : Number.isNaN(digit) ? 1 : digit;
  const url = p.find("span.course_address a").attr("href") ?? "";

  // Replace each course link with a stable token so the prerequisite grammar
  // can tell course references apart from ordinary words.
  const clone = p.clone();
  clone.find("span.course_address, span.course_title, span.course_hours").remove();
  clone.find("a").each((_, a) => {
    const cid = normalizeCourseId($(a).text());
    $(a).replaceWith(cid ? ` «${cid}» ` : $(a).text());
  });
  const body = clone.text().replace(/\s+/g, " ").trim();
  const description = body.replace(/«([^»]+)»/g, "$1").replace(/\s+([,.)])/g, "$1").replace(/\(\s+/g, "(");

  const sameAs = extractSameAs(body);
  const scheduleCode = body.match(new RegExp(`${LECTURE_LAB.source}\\s*([A-Z])\\s*$`))?.[1];
  const { prereq, coreq } = extractRequisites(body);

  return { id, title, hours, prereq, coreq, sameAs, scheduleCode, description, url };
}

function extractSameAs(body: string): CourseId[] {
  const m = body.match(/\(Same as ([^)]*)\)/);
  if (!m) return [];
  return [...m[1]!.matchAll(/«([^»]+)»/g)].map((x) => x[1]!);
}

/**
 * Pull out the prerequisite / corequisite clauses. The catalog writes them as
 * "Prerequisites: ... . Corequisite: ... . (Same as ...) (3-0) S".
 */
/** Lecture-lab hours at the end of a description: "(3-0)", "([1-6]-0)", "(1.5-1.5)", "(0-[2-6])". */
const LECTURE_LAB = /\(\s*\[?[\d.]+(?:-[\d.]+)?\]?\s*-\s*\[?[\d.]+(?:-[\d.]+)?\]?\s*\)/;

export function extractRequisites(body: string): { prereq?: PrereqExpr; coreq?: PrereqExpr } {
  const out: { prereq?: PrereqExpr; coreq?: PrereqExpr } = {};
  const clauseRe = new RegExp(
    `(Prerequisites? or Corequisites?|Prerequisites?|Corequisites?):\\s*(.*?)(?=(?:Prerequisites? or Corequisites?|Prerequisites?|Corequisites?):|\\(Same as|${LECTURE_LAB.source}|$)`,
    "g",
  );
  for (const m of body.matchAll(clauseRe)) {
    const kind = m[1]!.toLowerCase();
    const text = m[2]!.trim().replace(/\.$/, "").trim();
    if (!text) continue;
    if (kind.startsWith("prerequisite") && kind.includes("corequisite")) {
      const expr = markConcurrent(parsePrereqText(text));
      out.prereq = out.prereq ? { op: "and", items: [out.prereq, expr] } : expr;
    } else if (kind.startsWith("prerequisite")) {
      const expr = parsePrereqText(text);
      out.prereq = out.prereq ? { op: "and", items: [out.prereq, expr] } : expr;
    } else {
      const expr = parsePrereqText(text);
      out.coreq = out.coreq ? { op: "and", items: [out.coreq, expr] } : expr;
    }
  }
  return out;
}

function markConcurrent(e: PrereqExpr): PrereqExpr {
  if (e.op === "course") return { ...e, concurrentOk: true };
  if (e.op === "and" || e.op === "or") return { ...e, items: e.items.map(markConcurrent) };
  return e;
}

// ---------------------------------------------------------------------------
// Prerequisite grammar
//   expr   := orList (("," "and" | "and" | ",") orList)*
//   orList := unit ("or" unit)*
//   unit   := "(" expr ")" [grade] | COURSE [grade] | WORDS
// ---------------------------------------------------------------------------

type Tok =
  | { t: "course"; v: CourseId }
  | { t: "grade"; v: string }
  /** "A grade of C- or better in (either) ..." puts the grade *before* the courses. */
  | { t: "gradepre"; v: string }
  | { t: "("; v?: undefined }
  | { t: ")"; v?: undefined }
  | { t: "and"; v?: undefined }
  | { t: "or"; v?: undefined }
  | { t: ","; v?: undefined }
  | { t: "word"; v: string };

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  // Grade clauses contain "or", so turn them into one token first.
  const s = text
    // Course codes written as plain text instead of links ("MATH 2306", "BIOL2V81").
    .replace(/(?<!«)\b([A-Z]{2,4}) ?(\d[0-9V]\d{2})\b(?!»)/g, " «$1 $2» ")
    .replace(/\ba (?:minimum )?grade of ([A-F][+-]?) or better in (?:either )?/gi, " «GRADEPRE:$1» ")
    .replace(/\ba grade of at least an? ([A-F][+-]?) in (?:either )?/gi, " «GRADEPRE:$1» ")
    .replace(/with (?:a )?(?:minimum )?grade of ([A-F][+-]?) or better/gi, " «GRADE:$1» ");
  const re = /«GRADEPRE:([A-F][+-]?)»|«GRADE:([A-F][+-]?)»|«([^»]+)»|\(|\)|,|\band\b|\bor\b|[^\s(),«]+/gi;
  for (const m of s.matchAll(re)) {
    const w = m[0];
    if (m[1]) toks.push({ t: "gradepre", v: m[1].toUpperCase() });
    else if (m[2]) toks.push({ t: "grade", v: m[2].toUpperCase() });
    else if (m[3]) toks.push({ t: "course", v: m[3] });
    else if (w === "(") toks.push({ t: "(" });
    else if (w === ")") toks.push({ t: ")" });
    else if (w === ",") toks.push({ t: "," });
    else if (/^and$/i.test(w)) toks.push({ t: "and" });
    else if (/^or$/i.test(w)) toks.push({ t: "or" });
    else toks.push({ t: "word", v: w });
  }
  return toks;
}

const FILLER = new Set(["in", "either", "the", "of", "both"]);

export function parsePrereqText(text: string): PrereqExpr {
  const toks = tokenize(text);
  let i = 0;

  const peek = () => toks[i];

  function applyGrade(e: PrereqExpr, g: string): PrereqExpr {
    if (e.op === "course") return { ...e, minGrade: g };
    if (e.op === "and" || e.op === "or") return { ...e, items: e.items.map((x) => applyGrade(x, g)) };
    return e;
  }

  function unit(): PrereqExpr {
    // Filler words before a course ("or in MATH 2413", "either CS 1337") carry no meaning.
    while (peek()?.t === "word" && FILLER.has(String(peek()!.v).toLowerCase()) && toks[i + 1]?.t === "course") i++;
    const tok = peek();
    let e: PrereqExpr;
    if (tok?.t === "gradepre") {
      i++;
      return applyGrade(orList(), tok.v);
    }
    if (tok?.t === "(") {
      i++;
      e = expr();
      if (peek()?.t === ")") i++;
    } else if (tok?.t === "course") {
      i++;
      e = { op: "course", course: tok.v };
    } else {
      // Collect plain words until the next connective: this is a condition code can't check.
      const words: string[] = [];
      while (peek() && !["and", "or", ",", ")", "(", "course", "gradepre"].includes(peek()!.t)) {
        const w = toks[i++]!;
        words.push(w.t === "course" || w.t === "word" || w.t === "grade" ? String(w.v) : "");
      }
      if (!words.length && peek()) {
        i++; // skip a stray connective so we always make progress
        return { op: "text", text: "" };
      }
      return { op: "text", text: words.join(" ").replace(/[()]/g, "").trim() };
    }
    if (peek()?.t === "grade") e = applyGrade(e, String(toks[i++]!.v));
    // Words directly after a course, like "CS 1337 or equivalent", become separate text.
    return e;
  }

  function orList(): PrereqExpr {
    const items = [unit()];
    while (peek()?.t === "or") {
      i++;
      items.push(unit());
    }
    return simplify({ op: "or", items });
  }

  function expr(): PrereqExpr {
    const items = [orList()];
    while (peek() && (peek()!.t === "and" || peek()!.t === ",")) {
      i++;
      if (peek()?.t === "and") i++;
      if (!peek() || peek()!.t === ")") break;
      items.push(orList());
    }
    return simplify({ op: "and", items });
  }

  const result = expr();
  // Anything left over (unbalanced parens etc.) is kept as text, never dropped.
  if (i < toks.length) {
    const rest = toks
      .slice(i)
      .map((t) => (t.v !== undefined ? t.v : t.t))
      .join(" ")
      .replace(/[()]/g, "")
      .trim();
    return simplify({ op: "and", items: [result, { op: "text", text: rest }] });
  }
  return result;
}

function simplify(e: PrereqExpr): PrereqExpr {
  if (e.op !== "and" && e.op !== "or") return e;
  const items = e.items
    .map(simplify)
    .filter((x) => !(x.op === "text" && !x.text))
    .flatMap((x) => (x.op === e.op ? (x as { items: PrereqExpr[] }).items : [x]));
  if (items.length === 1) return items[0]!;
  return { op: e.op, items };
}

/** Every course mentioned anywhere in an expression. */
export function coursesIn(e: PrereqExpr | undefined): CourseId[] {
  if (!e) return [];
  if (e.op === "course") return [e.course];
  if (e.op === "text") return [];
  return e.items.flatMap(coursesIn);
}
