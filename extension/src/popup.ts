import { CART_URL, type Job, hoursLabel, newPlanJob, parseCourses, upcomingTerms } from "./orion.js";

const JOB = "utdPlannerJob";
const TERMS = "utdPlannerTerms";
const ORION_HOST = "dacs-prd.utshare.utsystem.edu";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Remember the form between popup openings (per-browser convenience only). */
const FIELDS = ["from", "to", "courses", "term", "prof", "waitlist"] as const;
function saveForm() {
  try {
    const v = Object.fromEntries(FIELDS.map((f) => [f, f === "waitlist" ? String($<HTMLInputElement>(f).checked) : $<HTMLInputElement>(f).value]));
    localStorage.setItem("form", JSON.stringify(v));
  } catch {
    // storage unavailable: fine
  }
}
function restoreForm() {
  try {
    const v = JSON.parse(localStorage.getItem("form") ?? "{}") as Record<string, string>;
    for (const f of FIELDS) {
      if (v[f] === undefined) continue;
      if (f === "waitlist") $<HTMLInputElement>(f).checked = v[f] === "true";
      else $<HTMLInputElement>(f).value = v[f]!;
    }
  } catch {
    // ignore
  }
}

async function fillTerms() {
  const { [TERMS]: seen } = (await chrome.storage.local.get(TERMS)) as { [TERMS]?: { terms: string[] } };
  const terms = [...new Set([...upcomingTerms(), ...(seen?.terms ?? [])])];
  $<HTMLSelectElement>("term").innerHTML = terms.map((t) => `<option>${t}</option>`).join("");
}

function formReady(): string | undefined {
  const from = $<HTMLInputElement>("from").value;
  const to = $<HTMLInputElement>("to").value;
  if (!from || !to) return "Set the hours you can be at school first.";
  if (from >= to) return "The end time has to be after the start time.";
  if (!parseCourses($<HTMLTextAreaElement>("courses").value).length) return "Add the classes you want to take.";
  return undefined;
}

async function render() {
  const { [JOB]: job } = (await chrome.storage.local.get(JOB)) as { [JOB]?: Job };
  const running = job?.status === "running";
  const paused = job?.status === "paused";
  const problem = formReady();
  $<HTMLButtonElement>("fill").disabled = running || Boolean(problem);
  $<HTMLButtonElement>("fill").title = problem ?? "";
  $("hoursHint").textContent = problem && !$<HTMLInputElement>("from").value ? problem : "Every class will start and end inside these hours when possible.";
  $<HTMLButtonElement>("stop").hidden = !(running || paused);
  $<HTMLButtonElement>("resume").hidden = !paused;

  if (!job) {
    $("status").innerHTML = "";
    $("results").innerHTML = "";
    return;
  }

  const phaseText =
    job.phase === "search" ? `Looking up ${job.courses[job.courseIndex] ?? "sections"} (${Math.min(job.courseIndex + 1, job.courses.length)}/${job.courses.length})…` : "Filling your cart…";
  const label: Record<Job["status"], string> = { running: `⏳ ${phaseText}`, paused: "⏸ Paused", done: "✅ Finished", stopped: "⏹ Stopped", error: "⚠️ Stopped" };
  $("status").innerHTML =
    `<b>${label[job.status]}</b> ${job.term ? `· ${escape(job.term)}` : ""} ${job.hours ? `· ${escape(hoursLabel(job.hours))}` : ""}` +
    `${job.note ? `<div class="note">${escape(job.note)}</div>` : ""}`;

  const notices = job.notices.map((n) => `<div class="notice">⚠️ ${escape(n)}</div>`).join("");
  const picks = job.picked
    .map((p) => {
      const r = job.results.find((x) => x.classNumber === p.classNumber);
      const icon = r ? (r.ok ? "✅" : "❌") : job.phase === "fill" && job.queue[job.index] === p.classNumber && running ? "⏳" : "•";
      return `<div class="pick ${p.outsideHours ? "out" : ""}">${icon} <b>${escape(p.course)}</b> · ${escape(p.when)} <span class="dim">(#${p.classNumber})</span>
        <div>${escape(p.teacher ?? "")}${p.rmp ? ` · <a href="${escape(p.rmp)}" target="_blank">Rate My Professors</a>` : ""}</div>
        ${p.summary ? `<div class="dim">${escape(p.summary)}</div>` : ""}
        ${r && !r.ok ? `<div class="dim">Orion: ${escape(r.message)}</div>` : ""}</div>`;
    })
    .join("");
  const report = job.report.length
    ? `<h3>Orion's Validate check</h3><ul>${job.report.map((r) => `<li>${r.ok ? "✅" : "⚠️"} <b>${escape(r.description)}</b>: ${escape(r.message)}</li>`).join("")}</ul>`
    : "";
  $("results").innerHTML = `${notices}${picks ? `<h3>Your schedule</h3>${picks}` : ""}${report}`;
}

/** Use the current Orion tab, else the most recent one, else a new tab. */
async function goToCart() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onOrion = (t?: chrome.tabs.Tab) => Boolean(t?.url && new URL(t.url).host === ORION_HOST);
  let tab = onOrion(active) ? active : undefined;
  if (!tab) tab = (await chrome.tabs.query({ url: `https://${ORION_HOST}/*` })).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  if (tab?.id !== undefined) await chrome.tabs.update(tab.id, { url: CART_URL, active: true });
  else await chrome.tabs.create({ url: CART_URL });
}

$("fill").addEventListener("click", async () => {
  if (formReady()) return;
  saveForm();
  const job = newPlanJob(
    parseCourses($<HTMLTextAreaElement>("courses").value),
    { earliest: $<HTMLInputElement>("from").value, latest: $<HTMLInputElement>("to").value },
    { term: $<HTMLSelectElement>("term").value, waitlist: $<HTMLInputElement>("waitlist").checked, professor: $<HTMLSelectElement>("prof").value as Job["professor"] },
  );
  await chrome.storage.local.set({ [JOB]: job });
  await goToCart();
});
$("stop").addEventListener("click", async () => {
  const { [JOB]: job } = (await chrome.storage.local.get(JOB)) as { [JOB]?: Job };
  if (job) await chrome.storage.local.set({ [JOB]: { ...job, status: "stopped", note: "Stopped by you. Anything already added stays in your cart." } });
});
$("resume").addEventListener("click", async () => {
  const { [JOB]: job } = (await chrome.storage.local.get(JOB)) as { [JOB]?: Job };
  if (job) await chrome.storage.local.set({ [JOB]: { ...job, status: "running", step: "resumed", repeats: 0, note: undefined } });
});
for (const f of FIELDS) $(f).addEventListener("input", () => (saveForm(), void render()));
chrome.storage.onChanged.addListener(() => void render());
void fillTerms().then(() => (restoreForm(), render()));
