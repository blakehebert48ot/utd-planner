/**
 * Turn Orion class-search rows into Sections, then pick a schedule inside the
 * student's hours. If a class has nothing inside those hours, still pick the
 * closest section and say so (the student asked: fill the cart anyway, but
 * tell me).
 */
import type { CourseId } from "../model.js";
import type { Section } from "../nebula/client.js";
import { type ProfessorStats, profKey } from "../grades/professorStats.js";
import { buildSchedules, meetingBlocks } from "./solver.js";
import { formatTime, parseTime } from "./time.js";

/** One row of Orion's class search results. */
export interface OrionSection {
  classNumber: string;
  section: string; // "001"
  component: string; // "LEC", "EXM", "LAB"
  meetings: { days: string[]; start: string; end: string; room: string }[];
  instructors: string[];
  status: string; // "Open", "Closed", "Wait List"
}

const DAY_CODES: Record<string, string> = { Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday", Sa: "Saturday", Su: "Sunday" };

/** "MoWe 10:00AM - 11:15AM" -> days + times. "TBA" -> no times. */
export function parseDayTime(s: string): { days: string[]; start: string; end: string } | undefined {
  const m = s.trim().match(/^([A-Za-z]+)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)$/i);
  if (!m) return undefined;
  const days = (m[1]!.match(/Mo|Tu|We|Th|Fr|Sa|Su/g) ?? []).map((d) => DAY_CODES[d]!);
  return days.length ? { days, start: m[2]!.replace(/\s+/g, ""), end: m[3]!.replace(/\s+/g, "") } : undefined;
}

/** Parse "001-LEC\nRegular" -> section "001", component "LEC". */
export function parseClassName(s: string): { section: string; component: string } {
  const m = s.match(/(\w+)-([A-Z]{2,4})/);
  return { section: m?.[1] ?? s.trim(), component: m?.[2] ?? "" };
}

/** Name variants so "Carlos Arreche Aguayo" (Orion) finds "Arreche Aguayo, Carlos" (grade data). */
export function nameKeys(fullName: string): string[] {
  const t = fullName.replace(/,/g, " ").trim().split(/\s+/);
  if (t.length < 2) return [];
  const first = t[0]!;
  return [...new Set([profKey(t[t.length - 1]!, first), profKey(t.slice(1).join(" "), first), profKey(t.slice(-2).join(" "), first)])];
}

const REAL_INSTRUCTOR = (n: string) => n && !/to be announced|staff|tba/i.test(n);

export function toSection(course: CourseId, term: string, r: OrionSection): Section {
  return {
    course,
    term,
    section: r.section,
    classNumber: r.classNumber,
    mode: r.component,
    meetings: r.meetings.map((m) => {
      const [building = "", room = ""] = m.room.split(/\s+/);
      return { days: m.days, start: m.start, end: m.end, building, room };
    }),
    professors: r.instructors.filter(REAL_INSTRUCTOR).map((name) => ({ name, key: nameKeys(name)[0] ?? "" })),
  };
}

export interface PickedClass {
  course: CourseId;
  section: Section;
  outsideHours: boolean;
  teacher?: ProfessorStats;
}

export interface SchedulePick {
  picked: PickedClass[];
  /** Plain-language notes for the student (things outside their hours, no sections, exams). */
  notices: string[];
}

export interface HoursPrefs {
  earliest: string; // "1:00pm"
  latest: string; // "7:00pm"
  professor?: "easiest" | "fewestDrops" | "ignore";
}

/**
 * @param found  course -> Orion search rows (all components)
 * @param stats  course -> professor stats, looked up by any of nameKeys()
 */
export function pickSchedule(
  courses: CourseId[],
  found: Record<CourseId, OrionSection[]>,
  term: string,
  hours: HoursPrefs,
  stats: Record<CourseId, Map<string, ProfessorStats>> = {},
): SchedulePick {
  const notices: string[] = [];
  const startMin = parseTime(hours.earliest)!;
  const endMin = parseTime(hours.latest)!;

  // Choices are lectures (or whatever the main component is); exams/labs ride along automatically.
  const requests = courses.flatMap((course) => {
    const rows = found[course] ?? [];
    if (!rows.length) {
      notices.push(`${course}: no open sections in Orion for ${term}. Not added.`);
      return [];
    }
    const main = rows.some((r) => r.component === "LEC") ? "LEC" : rows[0]!.component;
    for (const ex of rows.filter((r) => r.component === "EXM")) {
      const when = ex.meetings.map((m) => `${m.days.map((d) => d.slice(0, 3)).join("/")} ${m.start}–${m.end}`)[0];
      if (when) notices.push(`${course} has required common exams (${when}). Orion adds that section automatically.`);
    }
    const profMap = new Map<string, ProfessorStats>();
    const courseStats = stats[course];
    const sections = rows
      .filter((r) => r.component === main)
      .map((r) => {
        const s = toSection(course, term, r);
        // Point each professor at whichever name variant has grade data.
        s.professors = s.professors.map((p) => {
          const key = nameKeys(p.name).find((k) => courseStats?.has(k)) ?? p.key;
          const st = courseStats?.get(key);
          if (st) profMap.set(key, st);
          return { ...p, key };
        });
        return s;
      });
    return [{ course, sections, professorStats: profMap }];
  });

  const inHours = buildSchedules(requests, { earliest: hours.earliest, latest: hours.latest, gaps: "some", professor: hours.professor ?? "easiest", options: 1 });
  const best = inHours.options[0];
  const picked: PickedClass[] = (best?.sections ?? []).map((s) => ({
    course: s.course,
    section: s,
    outsideHours: false,
    teacher: best?.teachers.find((t) => t.course === s.course)?.stats,
  }));

  // Fallback: anything that didn't fit inside the hours gets the closest section that
  // doesn't clash with what's already picked.
  const missing = requests.filter((r) => !picked.some((p) => p.course === r.course));
  for (const r of missing) {
    const taken = picked.flatMap((p) => meetingBlocks(p.section));
    const options = r.sections
      .filter((s) => !meetingBlocks(s).some((b) => taken.some((t) => t.day === b.day && b.start < t.end && t.start < b.end)))
      .map((s) => ({ s, outside: minutesOutside(s, startMin, endMin) }))
      .sort((a, b) => a.outside - b.outside);
    const choice = options[0];
    if (!choice) {
      notices.push(`${r.course}: every section clashes with your other classes. Not added.`);
      continue;
    }
    const st = choice.s.professors.map((p) => r.professorStats?.get(p.key)).find(Boolean);
    picked.push({ course: r.course, section: choice.s, outsideHours: true, teacher: st });
    notices.push(`${r.course}: no open section fits ${formatTime(startMin)}–${formatTime(endMin)}. Added the closest one instead: ${describe(choice.s)}.`);
  }

  // Keep the student's priority order.
  picked.sort((a, b) => courses.indexOf(a.course) - courses.indexOf(b.course));
  return { picked, notices };
}

function minutesOutside(s: Section, start: number, end: number): number {
  return meetingBlocks(s).reduce((n, b) => n + Math.max(0, start - b.start) + Math.max(0, b.end - end), 0);
}

export function describe(s: Section): string {
  const blocks = meetingBlocks(s);
  if (!blocks.length) return `section ${s.section} (online/TBA)`;
  const days = [...new Set(blocks.map((b) => b.day.slice(0, 3)))].join("/");
  return `section ${s.section}, ${days} ${formatTime(blocks[0]!.start)}–${formatTime(blocks[0]!.end)}`;
}
