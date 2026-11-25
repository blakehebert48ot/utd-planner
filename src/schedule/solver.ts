import type { CourseId } from "../model.js";
import type { Section } from "../nebula/client.js";
import type { ProfessorStats } from "../grades/professorStats.js";
import { type Day, DAYS, formatTime, parseTime, toDay } from "./time.js";

/** What the student told us they want. */
export interface SchedulePrefs {
  /** No class may start before this ("10:00am"). */
  earliest?: string;
  /** No class may end after this ("4:00pm"). */
  latest?: string;
  /** Days with no classes at all. */
  daysOff?: Day[];
  /** "none": back-to-back please. "some": a break is fine, long gaps aren't. "dontCare". */
  gaps?: "none" | "some" | "dontCare";
  /** Prefer fewer days on campus. */
  fewerDays?: boolean;
  /** How to rank professors. "ignore" leaves only time preferences. */
  professor?: "easiest" | "fewestDrops" | "ignore";
  /** How many alternative schedules to return. */
  options?: number;
}

/** One course to schedule, in priority order (first = most important to fit). */
export interface CourseRequest {
  course: CourseId;
  sections: Section[];
  /** Grade-based stats for professors who've taught this course, keyed by professor key. */
  professorStats?: Map<string, ProfessorStats>;
}

export interface Block {
  day: Day;
  start: number;
  end: number;
  course: CourseId;
  section: Section;
}

export interface ScheduleOption {
  rank: number;
  sections: Section[];
  /** Cart input: one 5-digit class number per section. */
  classNumbers: string[];
  score: number;
  /** Plain-language reasons this option ranks where it does. */
  reasons: string[];
  warnings: string[];
  week: Record<Day, Block[]>;
  /** Per section: the professor card shown to the student. */
  teachers: { course: CourseId; section: string; name: string; stats?: ProfessorStats }[];
}

export interface ScheduleResult {
  options: ScheduleOption[];
  /** Courses that could not fit any schedule under the hard rules, with why. */
  dropped: { course: CourseId; why: string }[];
  /** Sections thrown out before searching, per course, with why (time window, day off, no times). */
  filtered: { course: CourseId; section: string; why: string }[];
}

const PASSING_TIME = 15; // minutes between classes that don't count as a gap

export function meetingBlocks(s: Section): { day: Day; start: number; end: number }[] {
  const out: { day: Day; start: number; end: number }[] = [];
  for (const m of s.meetings) {
    const start = parseTime(m.start);
    const end = parseTime(m.end);
    if (start === undefined || end === undefined) continue;
    for (const d of m.days) {
      const day = toDay(d);
      if (day) out.push({ day, start, end });
    }
  }
  return out;
}

function overlaps(a: { day: Day; start: number; end: number }[], b: { day: Day; start: number; end: number }[]): boolean {
  return a.some((x) => b.some((y) => x.day === y.day && x.start < y.end && y.start < x.end));
}

/**
 * Find the best few schedules. Hard rules (window, days off, no overlaps) are
 * never broken; everything else is a score. If some course can't fit at all,
 * the lowest-priority course is dropped and reported rather than silently
 * ignored.
 */
export function buildSchedules(requests: CourseRequest[], prefs: SchedulePrefs = {}): ScheduleResult {
  const earliest = parseTime(prefs.earliest);
  const latest = parseTime(prefs.latest);
  const daysOff = new Set(prefs.daysOff ?? []);
  const filtered: ScheduleResult["filtered"] = [];

  // 1. Throw out sections that break a hard rule on their own.
  const candidates = requests.map((r) => ({
    ...r,
    sections: r.sections.filter((s) => {
      const blocks = meetingBlocks(s);
      const why =
        blocks.some((b) => daysOff.has(b.day))
          ? "meets on a day you want off"
          : earliest !== undefined && blocks.some((b) => b.start < earliest)
            ? `starts before ${prefs.earliest}`
            : latest !== undefined && blocks.some((b) => b.end > latest)
              ? `ends after ${prefs.latest}`
              : undefined;
      if (why) filtered.push({ course: r.course, section: s.section, why });
      return !why;
    }),
  }));

  // 2. Drop courses that have no section left, lowest priority first if needed.
  const dropped: ScheduleResult["dropped"] = [];
  let active = candidates.filter((c) => {
    if (c.sections.length) return true;
    dropped.push({ course: c.course, why: "no section fits your time window and days off" });
    return false;
  });

  let found = search(active, prefs);
  while (!found.length && active.length > 1) {
    const removed = active[active.length - 1]!;
    dropped.push({ course: removed.course, why: "every section clashes with your higher-priority classes" });
    active = active.slice(0, -1);
    found = search(active, prefs);
  }
  return { options: found, dropped, filtered };
}

function search(requests: (CourseRequest & { sections: Section[] })[], prefs: SchedulePrefs): ScheduleOption[] {
  const keep = prefs.options ?? 3;
  // Courses with the fewest choices first: fails fast and prunes early.
  const order = [...requests].sort((a, b) => a.sections.length - b.sections.length);
  const best: { score: number; picks: Section[] }[] = [];
  const picks: Section[] = [];
  const blocks: { day: Day; start: number; end: number }[][] = [];
  let explored = 0;

  const visit = (i: number) => {
    if (++explored > 200_000) return; // safety valve for huge inputs
    if (i === order.length) {
      const score = scoreOf(order, picks, prefs).score;
      best.push({ score, picks: [...picks] });
      best.sort((a, b) => b.score - a.score);
      if (best.length > keep) best.pop();
      return;
    }
    for (const s of order[i]!.sections) {
      const b = meetingBlocks(s);
      if (blocks.some((x) => overlaps(x, b))) continue;
      picks.push(s);
      blocks.push(b);
      visit(i + 1);
      picks.pop();
      blocks.pop();
    }
  };
  visit(0);

  return best.map((b, idx) => {
    const { score, reasons, warnings, teachers } = scoreOf(order, b.picks, prefs);
    // Present sections in the student's priority order, not search order.
    const byCourse = new Map(b.picks.map((s) => [s.course, s]));
    const sections = requests.map((r) => byCourse.get(r.course)!).filter(Boolean);
    const priority = (c: CourseId) => requests.findIndex((r) => r.course === c);
    return {
      rank: idx + 1,
      sections,
      classNumbers: sections.map((s) => s.classNumber),
      score: Math.round(score * 10) / 10,
      reasons,
      warnings,
      week: weekOf(sections),
      teachers: [...teachers].sort((a, b) => priority(a.course) - priority(b.course)),
    };
  });
}

function scoreOf(order: CourseRequest[], picks: Section[], prefs: SchedulePrefs) {
  let score = 0;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const teachers: ScheduleOption["teachers"] = [];

  // Professors: compare against the other professors offered for the same course this term.
  for (const [i, s] of picks.entries()) {
    const req = order[i]!;
    const stats = s.professors.map((p) => req.professorStats?.get(p.key)).find(Boolean);
    const name = s.professors.map((p) => p.name).join(", ") || "Staff / TBA";
    teachers.push({ course: s.course, section: s.section, name, stats });
    if (prefs.professor === "ignore") continue;
    if (!stats) {
      warnings.push(`${s.course}: no grade history for ${name}`);
      continue;
    }
    const offered = req.sections
      .flatMap((x) => x.professors.map((p) => req.professorStats?.get(p.key)))
      .filter((x): x is ProfessorStats => Boolean(x));
    const value = (p: ProfessorStats) => (prefs.professor === "fewestDrops" ? -p.wRate : p.adjustedGpa);
    const vals = offered.map(value);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const rel = hi > lo ? (value(stats) - lo) / (hi - lo) : 0.5;
    score += rel * 10;
    if (rel >= 0.99 && offered.length > 1) {
      const what = prefs.professor === "fewestDrops" ? "fewest withdrawals" : "best-graded professor";
      reasons.push(`${s.course}: ${what} offered (${stats.name})`);
    }
  }

  // Gaps and days on campus.
  const week = weekOf(picks);
  let gapMin = 0;
  let longest = 0;
  let campusDays = 0;
  for (const d of DAYS) {
    const day = week[d];
    if (!day.length) continue;
    campusDays++;
    for (let k = 1; k < day.length; k++) {
      const g = day[k]!.start - day[k - 1]!.end;
      if (g > PASSING_TIME) {
        gapMin += g;
        longest = Math.max(longest, g);
      }
    }
  }
  const gaps = prefs.gaps ?? "some";
  if (gaps === "none") score -= gapMin / 15;
  else if (gaps === "some") score -= Math.max(0, longest - 120) / 15;
  if (gaps !== "dontCare") {
    if (gapMin === 0) reasons.push("no gaps between classes");
    else if (longest >= 120) warnings.push(`longest gap is ${Math.round(longest / 60 * 10) / 10} hours`);
  }
  if (prefs.fewerDays) score -= campusDays * 3;
  reasons.push(`on campus ${campusDays} day${campusDays === 1 ? "" : "s"} a week`);

  const noTimes = picks.filter((s) => !meetingBlocks(s).length);
  for (const s of noTimes) warnings.push(`${s.course} ${s.section} has no meeting times (online or TBA)`);

  return { score, reasons, warnings, teachers };
}

export function weekOf(sections: Section[]): Record<Day, Block[]> {
  const week = Object.fromEntries(DAYS.map((d) => [d, [] as Block[]])) as Record<Day, Block[]>;
  for (const s of sections) for (const b of meetingBlocks(s)) week[b.day].push({ ...b, course: s.course, section: s });
  for (const d of DAYS) week[d].sort((a, b) => a.start - b.start);
  return week;
}

/** "Mon 10:00am–11:15am CS 2336 (ECSS 2.410)" lines for a quick text view. */
export function describeWeek(week: Record<Day, Block[]>): string[] {
  return DAYS.filter((d) => week[d].length).map(
    (d) =>
      `${d.slice(0, 3)}  ` +
      week[d]
        .map((b) => {
          const m = b.section.meetings[0];
          const where = m?.building ? ` @ ${m.building} ${m.room}` : "";
          return `${formatTime(b.start)}–${formatTime(b.end)} ${b.course}${where}`;
        })
        .join("  |  "),
  );
}
