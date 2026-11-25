/**
 * Runs inside Orion (every frame). Only acts in the frame that holds the
 * shopping-cart pages, only while a job is running, and only through
 * perform() -> safeClick.
 */
import { type DecideContext, type Job, decide, needsStats, perform, snapshot } from "./orion.js";
import { type CompactStats, expandCourse } from "../../src/grades/compactStats.js";

/** Professor grade stats shipped with the extension (extension/data/prof-stats.json). */
async function loadContext(courses: string[]): Promise<DecideContext> {
  try {
    const res = await fetch(chrome.runtime.getURL("data/prof-stats.json"));
    const data = (await res.json()) as CompactStats;
    return { stats: Object.fromEntries(courses.map((c) => [c, expandCourse(c, data.courses[c])])) };
  } catch (e) {
    console.warn("[utd-planner] no professor stats; ranking by time only", e);
    return {};
  }
}

const JOB = "utdPlannerJob";
const CART = "utdPlannerCart";
const TERMS = "utdPlannerTerms";
const SETTLE_MS = 900; // let Orion finish drawing; also keeps the pace human-like

let actedOnSignature = "";
let timer: ReturnType<typeof setTimeout> | undefined;

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void tick().catch((e) => console.warn("[utd-planner]", e)), SETTLE_MS);
}

async function tick() {
  const page = snapshot(document);
  if (page.kind === "other") return;

  if (page.kind === "cart") {
    await chrome.storage.local.set({ [CART]: { term: page.term, at: Date.now(), rows: page.cartRows } });
  }
  if (page.kind === "termSelect") {
    await chrome.storage.local.set({ [TERMS]: { at: Date.now(), terms: page.terms.map((t) => t.label) } });
  }

  // Act at most once per distinct page state, so repeated DOM updates can't double-click.
  const signature = `${page.kind}|${page.messages.join("|")}|${page.cartRows.map((r) => r.classNumber).join(",")}|${location.href}`;
  const { [JOB]: job } = (await chrome.storage.local.get(JOB)) as { [JOB]?: Job };
  if (!job || job.status !== "running") return;
  if (signature === actedOnSignature) return;

  const ctx = needsStats(page, job) ? await loadContext(job.courses) : {};
  const { job: next, action } = decide(page, job, ctx);

  // Save BEFORE clicking: the click reloads the frame and ends this script.
  await chrome.storage.local.set({ [JOB]: next });
  if (action.do === "none" || action.do === "wait") return;
  actedOnSignature = signature;

  const err = perform(action, document);
  if (err) await chrome.storage.local.set({ [JOB]: { ...next, status: "error", note: err } });
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes[JOB]) {
    const job = changes[JOB].newValue as Job | undefined;
    const before = changes[JOB].oldValue as Job | undefined;
    // A fresh start or a Resume from the popup should be able to act on the current page.
    if (job?.status === "running" && before?.status !== "running") actedOnSignature = "";
    schedule();
  }
});
new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
schedule();
