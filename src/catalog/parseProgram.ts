import * as cheerio from "cheerio";
import type { CourseId, CourseSet, DegreeRules, Domain, Requirement, RequirementBlock } from "../model.js";
import { normalizeCourseId } from "./parseCourses.js";

/**
 * One requirement line from a catalog program page. UTD's catalog tags every
 * line with a class: cat-reqa (section), cat-reqg (group), cat-reqi (course),
 * cat-reqp (note), plus an indent level (xind-N) and catreq-cont for "or"/"and"
 * continuation lines.
 */
export interface CatalogLine {
  kind: "section" | "group" | "item" | "note";
  indent: number;
  continuation: boolean;
  text: string;
  courses: CourseId[];
  footnotes: number[];
  /** Core curriculum area code if the line links to one (e.g. "010"). */
  coreArea?: string;
}

export interface ProgramPage {
  name: string;
  totalHours?: number;
  lines: CatalogLine[];
  footnotes: Record<number, string>;
}

const KIND: Record<string, CatalogLine["kind"]> = {
  "cat-reqa": "section",
  "cat-reqg": "group",
  "cat-reqi": "item",
  "cat-reqp": "note",
};

export function parseProgramPage(html: string): ProgramPage {
  const $ = cheerio.load(html);
  // The <title> is "Computer Science (BS) - UT Dallas 2026 Undergraduate Catalog - ...".
  const name = $("title").text().split(" - ")[0]!.replace(/\s+/g, " ").trim();
  const lines: CatalogLine[] = [];
  const start = $("#degree-requirements");
  const els = start.length ? start.add(start.nextAll("p")) : $("p[class*='cat-req']");

  els.each((_, el) => {
    const cls = $(el).attr("class") ?? "";
    const kindKey = Object.keys(KIND).find((k) => cls.split(/\s+/).includes(k));
    if (!kindKey) return;
    const footnotes = $(el)
      .find("sup")
      .map((_, s) => Number($(s).text()))
      .get()
      .filter((n) => !Number.isNaN(n));
    const courses = $(el)
      .find("a")
      .map((_, a) => normalizeCourseId($(a).text()))
      .get()
      .filter((c): c is string => Boolean(c));
    const areaHref = $(el).find("a[href*='core-curriculum#']").attr("href");
    const coreArea = areaHref?.match(/#(\d{3})/)?.[1];
    const clone = $(el).clone();
    clone.find("sup").remove();
    lines.push({
      kind: KIND[kindKey]!,
      indent: Number(cls.match(/xind-(\d+)/)?.[1] ?? 0),
      continuation: cls.includes("catreq-cont"),
      text: clone.text().replace(/\s+/g, " ").trim(),
      courses,
      footnotes,
      coreArea,
    });
  });

  const footnotes: Record<number, string> = {};
  $("[id^='footnote-']").each((_, el) => {
    const n = Number(($(el).attr("id") ?? "").replace("footnote-", ""));
    const t = $(el).text().replace(/\s+/g, " ").trim().replace(/^\d+\.\s*/, "");
    if (!Number.isNaN(n) && t) footnotes[n] = t;
  });

  const totalMatch = $.text().match(/(\d{3}) semester credit hours/);
  return { name, totalHours: totalMatch ? Number(totalMatch[1]) : undefined, lines, footnotes };
}

// ---------------------------------------------------------------------------
// Lines -> rules
// ---------------------------------------------------------------------------

/** Lines that mark the end of the degree requirements (minors, certificates follow). */
const STOP_RE = /^(Students majoring in .* cannot add a minor|A minor in |A certificate in |Note: Students that complete the minor)/;

interface Entry {
  req: Requirement;
}

interface BuildOptions {
  programId: string;
  catalogYear: number;
  sourceUrl: string;
  /** Core area names -> codes, from the core curriculum page (e.g. "Government/Political Science" -> "070"). */
  coreAreaCodes: Record<string, string>;
}

export function buildRules(page: ProgramPage, opts: BuildOptions): DegreeRules {
  const blocks: RequirementBlock[] = [];
  const needsReview: string[] = [];
  let domain: Domain = "core";
  let upperDivisionHours = 0;

  let block: RequirementBlock | undefined;
  let entries: Entry[] = [];
  // "Choose one of the following sequences" state
  let seqOptions: Requirement[][] | undefined;
  // "pick N hours from this list" state (items indented under a note)
  let pickList: { noteIndent: number; set: CourseSet } | undefined;
  // a "Select any N hours from <X> Core" line seen in this block
  let coreSelect: Requirement | undefined;

  const finishBlock = () => {
    if (!block) return;
    if (seqOptions) entries.push({ req: { type: "oneOf", options: seqOptions.map(toAll) } });
    seqOptions = undefined;
    if (pickList) {
      block.requirement = { type: "hours", hours: block.statedHours ?? 0, from: pickList.set };
    } else if (entries.length) {
      block.requirement = toAll(entries.map((e) => e.req));
      if (coreSelect) block.alternative = coreSelect;
    } else if (coreSelect) {
      block.requirement = coreSelect;
    } else if (block.title.match(/free electives/i)) {
      // Free electives are whatever is left after everything else: checked by total hours.
      block.requirement = { type: "manual", text: "Free electives: covered by reaching the degree's total credit hours." };
    } else {
      needsReview.push(`Block "${block.title}" produced no rules.`);
    }
    pickList = undefined;
    coreSelect = undefined;
    entries = [];
    blocks.push(block);
    block = undefined;
  };

  const noteOn = (line: CatalogLine) => {
    for (const n of line.footnotes) {
      const t = page.footnotes[n];
      if (t && block && !block.notes.includes(t)) block.notes.push(t);
    }
  };

  for (const line of page.lines) {
    if (line.kind === "note" && STOP_RE.test(line.text)) break;

    if (line.kind === "section") {
      finishBlock();
      if (/core curriculum/i.test(line.text)) domain = "core";
      else if (/major requirements|elective requirements/i.test(line.text)) domain = "major";
      continue;
    }

    if (line.kind === "group") {
      finishBlock();
      const hours = line.text.match(/(\d+) semester credit hours?/);
      block = {
        id: slug(line.text.split(":")[0]!),
        title: line.text.split(":")[0]!.trim(),
        domain,
        statedHours: hours ? Number(hours[1]) : undefined,
        requirement: { type: "all", items: [] },
        notes: [],
      };
      continue;
    }

    if (!block) {
      // Section-level notes (before any group), e.g. "Curriculum Requirements can be fulfilled by other approved courses."
      if (line.text) needsReview.push(`Section note (not a rule): ${line.text}`);
      continue;
    }

    noteOn(line);

    if (line.kind === "note") {
      const t = line.text;
      const sel = t.match(/^(Or )?select any (\d+) semester credit hours? from (.+?) Core courses?/i);
      if (sel) {
        const area = line.coreArea ?? opts.coreAreaCodes[sel[3]!.trim()];
        if (!area) needsReview.push(`Unknown core area in: ${t}`);
        coreSelect = { type: "hours", hours: Number(sel[2]), from: { coreArea: area } };
        continue;
      }
      if (/choose one of the following sequences/i.test(t)) {
        seqOptions = [];
        continue;
      }
      if (seqOptions && /^or$/i.test(t)) continue;
      const upper = t.match(/total (\d+) upper-division semester credit hours/);
      if (upper) {
        upperDivisionHours = Number(upper[1]);
        continue;
      }
      const any = t.match(/^Any other organized ([A-Z]{2,4}) (\d)000-level course/);
      if (any && pickList) {
        const n = Number(any[2]) * 1000;
        (pickList.set.patterns ??= []).push({ subject: any[1]!, minNumber: n, maxNumber: n + 999 });
        continue;
      }
      if (/approved by the student's academic advisor|The following/i.test(t) && !entries.length) {
        pickList = { noteIndent: line.indent, set: { courses: [] } };
        block.notes.push(t);
        continue;
      }
      // Anything else is kept verbatim and flagged so a human decides.
      block.notes.push(t);
      if (/\b(must|select|choose|any|required|only)\b/i.test(t)) needsReview.push(`[${block.title}] ${t}`);
      continue;
    }

    // line.kind === "item"
    const first = line.courses[0];
    if (pickList && line.indent > pickList.noteIndent && first) {
      pickList.set.courses!.push(first);
      continue;
    }

    if (seqOptions) {
      if (/^[IVX]+\.\s/.test(line.text) && first) {
        seqOptions.push([{ type: "course", course: first }]);
        continue;
      }
      if (line.continuation && /^and\b/i.test(line.text) && first && seqOptions.length) {
        seqOptions[seqOptions.length - 1]!.push({ type: "course", course: first });
        continue;
      }
      // An ordinary item ends the sequence list.
      entries.push({ req: { type: "oneOf", options: seqOptions.map(toAll) } });
      seqOptions = undefined;
    }

    if (line.continuation && /^or\b/i.test(line.text) && first && entries.length) {
      const prev = entries[entries.length - 1]!.req;
      if (prev.type === "course") (prev.alternatives ??= []).push(first);
      else needsReview.push(`[${block.title}] "or" line after a non-course: ${line.text}`);
      continue;
    }

    if (line.continuation && /^and a (\d+) semester credit hour (.+?) Core course/i.test(line.text)) {
      const m = line.text.match(/^and a (\d+) semester credit hour (.+?) Core course/i)!;
      const area = opts.coreAreaCodes[m[2]!.trim()];
      if (!area) needsReview.push(`Unknown core area in: ${line.text}`);
      entries.push({ req: { type: "hours", hours: Number(m[1]), from: { coreArea: area } } });
      continue;
    }

    if (first) {
      entries.push({ req: { type: "course", course: first } });
    } else {
      needsReview.push(`[${block.title}] Item with no course link: ${line.text}`);
      entries.push({ req: { type: "manual", text: line.text } });
    }
  }
  finishBlock();

  return {
    programId: opts.programId,
    programName: page.name,
    catalogYear: opts.catalogYear,
    sourceUrl: opts.sourceUrl,
    totalHours: page.totalHours ?? 120,
    upperDivisionHours,
    blocks,
    needsReview,
    verified: false,
  };
}

function toAll(items: Requirement[]): Requirement {
  return items.length === 1 ? items[0]! : { type: "all", items };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ---------------------------------------------------------------------------
// Core curriculum page
// ---------------------------------------------------------------------------

export interface CoreArea {
  code: string;
  name: string;
  hours: number;
  courses: CourseId[];
  /** Courses marked with * that may also count as Component Area Option. */
  caoEligible: CourseId[];
}

export function parseCoreCurriculum(html: string): CoreArea[] {
  const $ = cheerio.load(html);
  const areas: CoreArea[] = [];
  let current: CoreArea | undefined;
  $("h3, p").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (el.tagName === "h3") {
      const m = t.match(/^(0\d0) (.+?) \((\d+) semester credit hours?\)/);
      current = m ? { code: m[1]!, name: m[2]!, hours: Number(m[3]), courses: [], caoEligible: [] } : undefined;
      if (current) areas.push(current);
      return;
    }
    if (!current || !($(el).attr("class") ?? "").includes("cat-reqi")) return;
    const id = normalizeCourseId($(el).find("a").first().text() || t);
    if (!id) return;
    current.courses.push(id);
    if (/\*\s*$/.test(t)) current.caoEligible.push(id);
  });
  return areas;
}
