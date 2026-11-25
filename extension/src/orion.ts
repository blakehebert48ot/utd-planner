/**
 * Everything the extension knows about Orion's enrollment pages.
 * Mapped by hand on 2026-11-24; see docs/ORION-PAGES.md.
 *
 * SAFETY: the extension may only click the buttons in ALLOWED below. Every
 * click goes through safeClick(), which checks the element's ID prefix AND its
 * visible label. Enroll / Finish Enrolling / Delete / Drop can never pass.
 */
import type { ProfessorStats } from "../../src/grades/professorStats.js";
import { type OrionSection, describe as describeSection, parseClassName, parseDayTime, pickSchedule } from "../../src/schedule/fromOrion.js";
import { formatTime, parseTime } from "../../src/schedule/time.js";

export const ALLOWED = [
  { idPrefix: "DERIVED_REGFRM1_SSR_PB_ADDTOLIST2", label: "Enter" },
  { idPrefix: "DERIVED_CLS_DTL_NEXT_PB", label: "Next" },
  { idPrefix: "DERIVED_REGFRM1_SSR_VIEW_STAT_RPT", label: "Validate" },
  { idPrefix: "DERIVED_SSS_SCT_SSR_PB_GO", label: "Continue" }, // Select Term page
  { idPrefix: "DERIVED_SSS_SCT_SSS_TERM_LINK", label: "Change Term" }, // cart page
  { idPrefix: "DERIVED_REGFRM1_SSS_SCHED_PLANNER", label: "Shopping Cart" }, // back from Validate report
  { idPrefix: "DERIVED_REGFRM1_SSR_PB_SRCH", label: "Search" }, // cart -> class search
  { idPrefix: "CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH", label: "Search" }, // run a class search
  { idPrefix: "CLASS_SRCH_WRK2_SSR_PB_NEW_SEARCH", label: "New Search" },
  { idPrefix: "CLASS_SRCH_WRK2_SSR_PB_CLOSE", label: "Return to Shopping Cart" },
] as const;

/** Orion's cart, with no term picked: it shows Select Term (or the only open term). */
export const CART_URL =
  "https://dacs-prd.utshare.utsystem.edu/psp/DACSPRD/EMPLOYEE/SA/c/SA_LEARNER_SERVICES_2.SSR_SSENRL_CART.GBL?Page=SSR_SSENRL_CART&Action=A";

const FORBIDDEN = /ENRL|ENROLL|SUBMIT|FINISH|DROP|SWAP|DELETE/i;

export function isAllowedButton(id: string, label: string): boolean {
  if (FORBIDDEN.test(id) || /enroll|finish|submit|drop|swap|delete/i.test(label)) return false;
  return ALLOWED.some((a) => id.startsWith(a.idPrefix) && label.trim() === a.label);
}

/** Click only if the element is one of the allowed buttons. Returns whether it clicked. */
export function safeClick(el: Element | null | undefined): boolean {
  if (!el) return false;
  const id = el.id ?? "";
  const label = (el as HTMLInputElement).value ?? el.textContent ?? "";
  if (!isAllowedButton(id, label)) return false;
  (el as HTMLElement).click();
  return true;
}

/** Radio buttons we may click: a term on Select Term, or "Class Search" (06) on the cart. */
export function safeChooseRadio(el: Element | null | undefined): boolean {
  const r = el as HTMLInputElement | null | undefined;
  if (!r || r.type !== "radio") return false;
  const ok = r.id.startsWith("SSR_DUMMY_RECV1$sels$") || (r.id.startsWith("DERIVED_REGFRM1_SSR_CLS_SRCH_TYPE") && r.value === "06");
  if (!ok) return false;
  if (!r.checked) r.click();
  return true;
}
/** Kept for older call sites/tests. */
export const safeChooseTerm = (el: Element | null | undefined) => {
  if (!el || !el.id.startsWith("SSR_DUMMY_RECV1$sels$")) return false;
  return safeChooseRadio(el);
};

// ---------------------------------------------------------------------------
// Page detection
// ---------------------------------------------------------------------------

export type PageKind = "termSelect" | "cart" | "related" | "prefs" | "report" | "searchCriteria" | "searchResults" | "saveWarning" | "other";

export interface CartRow {
  classNumber: string;
  label: string; // "PHYS 2325-002 (21075)"
}

export interface PageSnapshot {
  kind: PageKind;
  /** "2027 Spring" on the cart page. */
  term?: string;
  messages: string[];
  cartRows: CartRow[];
  /** Related-sections page offers a choice (labs/discussions) instead of auto-adding. */
  needsChoice: boolean;
  report: { description: string; message: string; ok: boolean }[];
  terms: { label: string; radioId: string }[];
  /** Class search results. */
  sections: OrionSection[];
  /** Class search said nothing matched. */
  noResults: boolean;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
/** Text split into lines at <br>s (innerText in Chrome; textContent with real newlines in tests). */
const lines = (el: Element | null | undefined): string[] =>
  (((el as HTMLElement | null)?.innerText as string | undefined) || el?.textContent || "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

export function snapshot(doc: Document): PageSnapshot {
  const body = text(doc.body);
  const messages = [
    ...new Set(
      [...doc.querySelectorAll(".SSSMSGSUCCESSFRAME, .SSSMSGALERTFRAME, .SSSMSGINFOFRAME, .PSERRORTEXT, [id^='DERIVED_SASSMSG_ERROR_TEXT']")]
        .map((m) => text(m))
        .filter(Boolean),
    ),
  ];
  const base: Omit<PageSnapshot, "kind"> = { messages, cartRows: [], needsChoice: false, report: [], terms: [], sections: [], noResults: false };

  if (/Save Warning/i.test(body) && /unsaved data/i.test(body)) return { ...base, kind: "saveWarning" };

  if (doc.getElementById("DERIVED_SSS_SCT_SSR_PB_GO")) {
    const terms = [...doc.querySelectorAll<HTMLInputElement>("input[type='radio'][id^='SSR_DUMMY_RECV1$sels$']")].map((r) => ({
      radioId: r.id,
      label: text(r.closest("tr")).match(/\d{4} (?:Spring|Summer|Fall)/)?.[0] ?? "",
    }));
    return { ...base, kind: "termSelect", terms: terms.filter((t) => t.label) };
  }

  if (doc.getElementById("DERIVED_REGFRM1_SSS_SCHED_PLANNER") && /status report for enrollment/i.test(body)) {
    // Only innermost rows with exactly three cells and a status icon; Orion nests layout tables.
    const report: PageSnapshot["report"] = [];
    let lastDescription = "";
    for (const tr of doc.querySelectorAll("tr")) {
      if (tr.querySelector("table")) continue;
      const cells = [...tr.children].filter((c) => c.tagName === "TD");
      if (cells.length !== 3) continue;
      const icon = cells[2]!.querySelector("img");
      if (!icon) continue;
      const message = text(cells[1]);
      if (!message || /^Message$/i.test(message)) continue;
      const description = text(cells[0]) || lastDescription;
      lastDescription = description;
      const alt = `${icon.getAttribute("alt") ?? ""} ${icon.getAttribute("src") ?? ""}`;
      const ok = !/error|problem|fail/i.test(alt) && !/not met|hold|conflict|error|closed|unable|cannot|denied/i.test(message);
      report.push({ description, message, ok });
    }
    return { ...base, kind: "report", report };
  }

  if (doc.getElementById("SSR_CLSRCH_WRK_SUBJECT_SRCH$0")) {
    return { ...base, kind: "searchCriteria", noResults: /search returns no results/i.test(body) };
  }

  const nbrs = [...doc.querySelectorAll("[id^='MTG_CLASS_NBR$']")].filter((e) => /^MTG_CLASS_NBR\$\d+$/.test(e.id));
  if (nbrs.length) {
    const sections: OrionSection[] = nbrs.map((a) => {
      const n = a.id.split("$")[1]!;
      const { section, component } = parseClassName(text(doc.getElementById(`MTG_CLASSNAME$${n}`)));
      const times = lines(doc.getElementById(`MTG_DAYTIME$${n}`));
      const rooms = lines(doc.getElementById(`MTG_ROOM$${n}`));
      const meetings = times
        .map((t, i) => {
          const p = parseDayTime(t);
          return p ? { ...p, room: rooms[i] ?? rooms[0] ?? "" } : undefined;
        })
        .filter((m): m is NonNullable<typeof m> => Boolean(m));
      // Same meeting repeated per room/instructor line: keep one.
      const seen = new Set<string>();
      const unique = meetings.filter((m) => {
        const k = `${m.days.join()}|${m.start}|${m.end}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const instructors = [...new Set(lines(doc.getElementById(`MTG_INSTR$${n}`)).map((s) => s.replace(/,$/, "").trim()))];
      const status = doc.querySelector(`[id='win0divDERIVED_CLSRCH_SSR_STATUS_LONG$${n}'] img`)?.getAttribute("alt") ?? "";
      return { classNumber: text(a), section, component, meetings: unique, instructors, status };
    });
    return { ...base, kind: "searchResults", sections };
  }

  const next = doc.querySelector("[id^='DERIVED_CLS_DTL_NEXT_PB']");
  if (next && /Related Class Sections/i.test(body)) {
    const needsChoice = doc.querySelectorAll("input[type='radio']").length > 0;
    return { ...base, kind: "related", needsChoice };
  }
  if (next && /Enrollment Preferences/i.test(body)) return { ...base, kind: "prefs" };

  if (doc.getElementById("DERIVED_REGFRM1_CLASS_NBR")) {
    const cartRows: CartRow[] = [...doc.querySelectorAll("a[id^='P_CLASS_NAME$']")]
      .filter((a) => /^P_CLASS_NAME\$\d+$/.test(a.id))
      .map((a) => ({ label: text(a), classNumber: text(a).match(/\((\d{5})\)/)?.[1] ?? "" }));
    const term = body.match(/(\d{4} (?:Spring|Summer|Fall)) \| Undergraduate/)?.[1];
    return { ...base, kind: "cart", cartRows, term };
  }
  return { ...base, kind: "other" };
}

// ---------------------------------------------------------------------------
// The job. Orion reloads the frame after every click, so all state lives in
// chrome.storage. Two phases: "search" (look up each course's real sections,
// then pick a schedule inside the student's hours) and "fill" (add the picked
// class numbers to the cart, validate, return to the cart).
// ---------------------------------------------------------------------------

export type JobStatus = "running" | "paused" | "done" | "stopped" | "error";
export type Step =
  | "idle"
  | "selectingTerm"
  | "changingTerm"
  | "openingSearch"
  | "searching"
  | "newSearch"
  | "entered"
  | "relatedNext"
  | "prefsNext"
  | "validating"
  | "returning"
  | "resumed";

export interface Picked {
  course: string;
  classNumber: string;
  section: string;
  when: string;
  outsideHours: boolean;
  teacher?: string;
  summary?: string;
  rmp?: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  phase: "search" | "fill";
  /** Fill phase: class numbers to add. */
  queue: string[];
  index: number;
  step: Step;
  waitlist: boolean;
  results: { classNumber: string; ok: boolean; message: string }[];
  report: PageSnapshot["report"];
  note?: string;
  lastKey?: string;
  repeats: number;
  /** "2027 Spring" */
  term?: string;
  /** Search phase: courses to look up, e.g. "CS 2336". */
  courses: string[];
  courseIndex: number;
  found: Record<string, OrionSection[]>;
  hours?: { earliest: string; latest: string };
  professor?: "easiest" | "fewestDrops" | "ignore";
  picked: Picked[];
  notices: string[];
}

export type Action =
  | { do: "chooseTerm"; radioId: string }
  | { do: "changeTerm" }
  | { do: "openSearch" }
  | { do: "searchCourse"; subject: string; number: string }
  | { do: "newSearch" }
  | { do: "returnToCart" }
  | { do: "enterClass"; classNumber: string }
  | { do: "clickNext"; setWaitlist?: boolean }
  | { do: "validate"; select: string[] }
  | { do: "backToCart" }
  | { do: "wait" }
  | { do: "none" };

/** Extra data decide() may need: professor stats by course (loaded only when picking). */
export interface DecideContext {
  stats?: Record<string, Map<string, ProfessorStats>>;
}

const baseJob = (): Omit<Job, "phase" | "queue" | "term" | "waitlist"> => ({
  id: String(Date.now()),
  status: "running",
  index: 0,
  step: "idle",
  results: [],
  report: [],
  repeats: 0,
  courses: [],
  courseIndex: 0,
  found: {},
  picked: [],
  notices: [],
});

/** Fill-only job: add these class numbers. */
export function newJob(classNumbers: string[], waitlist: boolean, term?: string): Job {
  return { ...baseJob(), phase: "fill", queue: [...new Set(classNumbers.filter((c) => /^\d{5}$/.test(c)))], waitlist, term };
}

/** Full job: find sections for these courses inside the student's hours, then fill. */
export function newPlanJob(
  courses: string[],
  hours: { earliest: string; latest: string },
  opts: { term?: string; waitlist?: boolean; professor?: Job["professor"] } = {},
): Job {
  return {
    ...baseJob(),
    phase: "search",
    queue: [],
    courses: [...new Set(courses)],
    hours,
    term: opts.term,
    waitlist: opts.waitlist ?? false,
    professor: opts.professor ?? "easiest",
  };
}

/** "CS 2336, math2419" -> ["CS 2336", "MATH 2419"] */
export function parseCourses(s: string): string[] {
  return [...new Set([...s.matchAll(/\b([A-Za-z]{2,4})\s*(\d[0-9Vv]\d{2})\b/g)].map((m) => `${m[1]!.toUpperCase()} ${m[2]!.toUpperCase()}`))];
}

/** The next few terms, soonest first, as Orion labels them. */
export function upcomingTerms(now = new Date()): string[] {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 8) return [`${y + 1} Spring`, `${y + 1} Summer`, `${y + 1} Fall`, `${y} Fall`];
  if (m >= 5) return [`${y} Fall`, `${y} Summer`, `${y + 1} Spring`];
  return [`${y} Summer`, `${y} Fall`, `${y} Spring`];
}

/** Carry out an action. Every click goes through safeClick / safeChooseRadio. Returns an error note, or undefined. */
export function perform(action: Action, doc: Document): string | undefined {
  const no = (what: string) => `The ${what} button didn't look right, so nothing was clicked.`;
  switch (action.do) {
    case "chooseTerm":
      if (!safeChooseRadio(doc.getElementById(action.radioId))) return "Couldn't pick the term.";
      return safeClick(doc.getElementById("DERIVED_SSS_SCT_SSR_PB_GO")) ? undefined : no("Continue");
    case "changeTerm":
      return safeClick(doc.getElementById("DERIVED_SSS_SCT_SSS_TERM_LINK")) ? undefined : no("Change Term");
    case "openSearch": {
      const radio = [...doc.querySelectorAll<HTMLInputElement>("input[type='radio'][id^='DERIVED_REGFRM1_SSR_CLS_SRCH_TYPE']")].find((r) => r.value === "06");
      if (radio) safeChooseRadio(radio);
      return safeClick(doc.getElementById("DERIVED_REGFRM1_SSR_PB_SRCH")) ? undefined : no("Search");
    }
    case "searchCourse": {
      const subj = doc.getElementById("SSR_CLSRCH_WRK_SUBJECT_SRCH$0") as HTMLSelectElement | null;
      const num = doc.getElementById("SSR_CLSRCH_WRK_CATALOG_NBR$1") as HTMLInputElement | null;
      if (!subj || !num) return "Couldn't find the class search form.";
      if (![...subj.options].some((o) => o.value === action.subject)) return `Orion has no subject "${action.subject}".`;
      subj.value = action.subject;
      subj.dispatchEvent(new Event("change", { bubbles: true }));
      num.value = action.number;
      num.dispatchEvent(new Event("change", { bubbles: true }));
      return safeClick(doc.getElementById("CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH")) ? undefined : no("Search");
    }
    case "newSearch":
      return safeClick(doc.getElementById("CLASS_SRCH_WRK2_SSR_PB_NEW_SEARCH")) ? undefined : no("New Search");
    case "returnToCart":
      return safeClick(doc.getElementById("CLASS_SRCH_WRK2_SSR_PB_CLOSE")) ? undefined : no("Return to Shopping Cart");
    case "backToCart":
      return safeClick(doc.getElementById("DERIVED_REGFRM1_SSS_SCHED_PLANNER")) ? undefined : "Couldn't find the button back to the cart. Your classes are in the cart.";
    case "enterClass": {
      const input = doc.getElementById("DERIVED_REGFRM1_CLASS_NBR") as HTMLInputElement | null;
      if (!input) return "Couldn't find the class number box.";
      input.value = action.classNumber;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return safeClick(doc.querySelector("[id^='DERIVED_REGFRM1_SSR_PB_ADDTOLIST2']")) ? undefined : no("Enter");
    }
    case "clickNext": {
      if (action.setWaitlist !== undefined) {
        const box = doc.querySelector("[id^='DERIVED_CLS_DTL_WAIT_LIST_OKAY']") as HTMLInputElement | null;
        if (box && box.checked !== action.setWaitlist) box.click();
      }
      return safeClick(doc.querySelector("[id^='DERIVED_CLS_DTL_NEXT_PB']")) ? undefined : no("Next");
    }
    case "validate": {
      for (const a of doc.querySelectorAll("a[id^='P_CLASS_NAME$']")) {
        const n = a.id.match(/^P_CLASS_NAME\$(\d+)$/)?.[1];
        if (n === undefined) continue;
        const box = doc.getElementById(`P_SELECT$${n}`) as HTMLInputElement | null;
        const num = (a.textContent ?? "").match(/\((\d{5})\)/)?.[1];
        if (box && num && action.select.includes(num) && !box.checked) box.click();
      }
      return safeClick(doc.getElementById("DERIVED_REGFRM1_SSR_VIEW_STAT_RPT")) ? undefined : no("Validate");
    }
    default:
      return;
  }
}

/** Does decide() need professor stats for this page? (Only when it's about to pick the schedule.) */
export function needsStats(page: PageSnapshot, job: Job): boolean {
  return job.phase === "search" && (page.kind === "searchResults" || page.kind === "searchCriteria") && job.courseIndex >= job.courses.length - 1;
}

/** Search phase is over: pick sections inside the hours (with fallback) and switch to filling. */
function finishSearch(j: Job, ctx: DecideContext): { job: Job; action: Action } {
  const hours = j.hours ?? { earliest: "0:00", latest: "23:59" };
  const open = Object.fromEntries(
    Object.entries(j.found).map(([c, rows]) => [c, rows.filter((r) => r.status !== "Closed" || j.waitlist)]),
  );
  const pick = pickSchedule(j.courses, open, j.term ?? "this term", { ...hours, professor: j.professor }, ctx.stats ?? {});
  j.picked = pick.picked.map((p) => ({
    course: p.course,
    classNumber: p.section.classNumber,
    section: p.section.section,
    when: describeSection(p.section),
    outsideHours: p.outsideHours,
    teacher: p.section.professors.map((x) => x.name).join(", ") || "Staff / TBA",
    summary: p.teacher?.summary,
    rmp: p.teacher?.rmpSearchUrl,
  }));
  j.notices = pick.notices;
  j.queue = j.picked.map((p) => p.classNumber);
  j.phase = "fill";
  j.index = 0;
  j.step = "idle";
  if (!j.queue.length) return { job: { ...j, status: "done", note: "Couldn't find any sections to add. See the notes below." }, action: { do: "none" } };
  return { job: j, action: { do: "returnToCart" } };
}

/** Human-readable hours, e.g. "1:00pm–7:00pm". */
export function hoursLabel(h: { earliest: string; latest: string }): string {
  const a = parseTime(h.earliest);
  const b = parseTime(h.latest);
  return a !== undefined && b !== undefined ? `${formatTime(a)}–${formatTime(b)}` : `${h.earliest}–${h.latest}`;
}

/**
 * Pure decision: given the page we're looking at and the job, what's next?
 */
export function decide(page: PageSnapshot, job: Job, ctx: DecideContext = {}): { job: Job; action: Action } {
  if (job.status !== "running") return { job, action: { do: "none" } };
  const j: Job = { ...job, results: [...job.results], found: { ...job.found } };
  const current = j.queue[j.index];
  const recordAndAdvance = (ok: boolean, message: string) => {
    if (current) j.results.push({ classNumber: current, ok, message });
    j.index++;
    j.step = "idle";
  };

  // Loop protection: the same situation 3 times in a row means we're stuck.
  const key = `${page.kind}|${j.phase}|${j.step}|${j.index}|${j.courseIndex}`;
  j.repeats = key === j.lastKey ? j.repeats + 1 : 0;
  j.lastKey = key;
  if (j.repeats >= 3) return { job: { ...j, status: "error", note: `Stuck on the ${page.kind} page. Stopped so nothing unexpected happens.` }, action: { do: "none" } };

  switch (page.kind) {
    case "saveWarning":
      return { job: { ...j, status: "paused", note: "Orion is asking about unsaved changes. Choose there, then press Resume." }, action: { do: "none" } };

    case "termSelect": {
      const want = j.term;
      const row = want ? page.terms.find((t) => t.label === want) : page.terms[0];
      if (!row) {
        const open = page.terms.map((t) => t.label).join(", ") || "none";
        return { job: { ...j, status: "error", note: `The ${want} cart isn't open in Orion yet. Open right now: ${open}.` }, action: { do: "none" } };
      }
      j.term = row.label;
      j.step = "selectingTerm";
      return { job: j, action: { do: "chooseTerm", radioId: row.radioId } };
    }

    case "searchCriteria": {
      if (j.phase !== "search") return { job: j, action: { do: "returnToCart" } };
      if (page.noResults && j.step === "searching") {
        j.found[j.courses[j.courseIndex]!] = [];
        j.courseIndex++;
      }
      const course = j.courses[j.courseIndex];
      if (!course) return finishSearch(j, ctx);
      const [subject, number] = course.split(" ");
      j.step = "searching";
      return { job: j, action: { do: "searchCourse", subject: subject!, number: number! } };
    }

    case "searchResults": {
      if (j.phase !== "search") return { job: j, action: { do: "returnToCart" } };
      j.found[j.courses[j.courseIndex]!] = page.sections;
      j.courseIndex++;
      if (j.courseIndex < j.courses.length) {
        j.step = "newSearch";
        return { job: j, action: { do: "newSearch" } };
      }
      return finishSearch(j, ctx);
    }

    case "related":
      if (page.needsChoice) {
        return {
          job: { ...j, status: "paused", note: `Class ${current} has lab or discussion options. Pick one in Orion, click Next yourself, then press Resume.` },
          action: { do: "none" },
        };
      }
      j.step = "relatedNext";
      return { job: j, action: { do: "clickNext" } };

    case "prefs":
      j.step = "prefsNext";
      return { job: j, action: { do: "clickNext", setWaitlist: j.waitlist } };

    case "report":
      j.report = page.report;
      j.step = "returning";
      return { job: j, action: { do: "backToCart" } };

    case "cart": {
      if (j.step === "returning") {
        const extra = j.notices.length ? " Some classes needed attention; see the notes." : "";
        return { job: { ...j, status: "done", note: `Done. Your cart is filled.${extra} Check Orion's Validate report, then enroll yourself on your date.` }, action: { do: "none" } };
      }
      if (j.term && page.term && page.term !== j.term) {
        if (j.index === 0 && ["idle", "selectingTerm", "changingTerm"].includes(j.step)) {
          j.step = "changingTerm";
          return { job: j, action: { do: "changeTerm" } };
        }
        return { job: { ...j, status: "error", note: `Orion switched to the ${page.term} cart partway through. Stopped.` }, action: { do: "none" } };
      }
      j.term ??= page.term;
      if (j.step === "selectingTerm" || j.step === "changingTerm") j.step = "idle";

      if (j.phase === "search") {
        j.step = "openingSearch";
        return { job: j, action: { do: "openSearch" } };
      }

      if (j.step === "prefsNext" || j.step === "resumed") {
        const added = page.messages.find((m) => /has been added to your Shopping Cart/i.test(m));
        recordAndAdvance(Boolean(added), added ?? page.messages[0] ?? "No confirmation shown; check the cart.");
      } else if (j.step === "entered" || j.step === "relatedNext") {
        recordAndAdvance(false, page.messages[0] ?? "Orion didn't accept this class number.");
      } else if (j.step === "validating") {
        return { job: { ...j, status: "error", note: "Validate didn't open its report." }, action: { do: "none" } };
      }

      const next = j.queue[j.index];
      if (next) {
        j.step = "entered";
        return { job: j, action: { do: "enterClass", classNumber: next } };
      }
      const added = j.results.filter((r) => r.ok).map((r) => r.classNumber);
      if (!added.length) return { job: { ...j, status: "done", note: "Nothing was added, so there's nothing to validate." }, action: { do: "none" } };
      j.step = "validating";
      return { job: j, action: { do: "validate", select: added } };
    }

    default:
      return { job: j, action: { do: "wait" } };
  }
}
