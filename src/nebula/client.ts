/**
 * Nebula Labs API client (https://api.utdnebula.com).
 *
 * Key: join discord.utdnebula.com and run /request-key; the bot DMs you a key.
 * Put it in .env as NEBULA_API_KEY=... (.env is gitignored). Never commit it.
 *
 * Response shapes follow Nebula's Go schema and UTD Trends' own client
 * (utd-trends/src/modules/fetchSections.ts). Verified against a live response
 * on 2026-11-24: CS 2336 returned 144 sections (19F–27S) with professor_details
 * filled in, and the 27S class numbers matched Orion's class search exactly.
 * Note: exam sections (e.g. section 701) come back as ordinary sections; tell
 * them apart by section number, since instruction_mode is "Face-to-Face" for both.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { CourseId } from "../model.js";
import { profKey } from "../grades/professorStats.js";

const BASE = "https://api.utdnebula.com/";
const CACHE_DIR = "data/raw/nebula";
const CACHE_HOURS = 24;

/** Raw section as Nebula returns it (only the fields we use). */
export interface NebulaSection {
  _id: string;
  section_number: string;
  academic_session: { name: string; start_date: string; end_date: string };
  internal_class_number: string;
  instruction_mode: string;
  meetings: {
    start_date: string;
    end_date: string;
    meeting_days: string[];
    start_time: string;
    end_time: string;
    modality: string;
    location: { building: string; room: string; map_uri: string };
  }[];
  professors: string[];
  professor_details?: { _id: string; first_name: string; last_name: string; email?: string }[];
  core_flags: string[];
}

/** What the planner needs about one section. */
export interface Section {
  course: CourseId;
  term: string; // "27F"
  section: string; // "002"
  /** The 5-digit number typed into Orion's cart. */
  classNumber: string;
  mode: string;
  meetings: { days: string[]; start: string; end: string; building: string; room: string }[];
  professors: { name: string; key: string; email?: string }[];
}

export function normalizeSection(course: CourseId, s: NebulaSection): Section {
  return {
    course,
    term: s.academic_session.name,
    section: s.section_number,
    classNumber: s.internal_class_number,
    mode: s.instruction_mode,
    meetings: (s.meetings ?? []).map((m) => ({
      days: m.meeting_days ?? [],
      start: m.start_time,
      end: m.end_time,
      building: m.location?.building ?? "",
      room: m.location?.room ?? "",
    })),
    professors: (s.professor_details ?? []).map((p) => ({
      name: `${p.first_name} ${p.last_name}`.trim(),
      key: profKey(p.last_name, p.first_name.split(/\s+/)[0] ?? ""),
      email: p.email,
    })),
  };
}

export class NebulaClient {
  constructor(private readonly apiKey = process.env.NEBULA_API_KEY) {}

  /** Every section of a course across all terms Nebula has, with professor details. */
  async courseSections(course: CourseId): Promise<Section[]> {
    const [prefix, number] = course.split(" ");
    const raw = await this.get<NebulaSection[]>("course/sections/trends", { subject_prefix: prefix!, course_number: number! });
    return (raw ?? []).map((s) => normalizeSection(course, s));
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const file = `${CACHE_DIR}/${path.replace(/\//g, "_")}__${qs.replace(/[^a-zA-Z0-9=]/g, "_")}.json`;
    try {
      const st = await stat(file);
      if (Date.now() - st.mtimeMs < CACHE_HOURS * 3600_000) return JSON.parse(await readFile(file, "utf8")) as T;
    } catch {
      // not cached
    }
    if (!this.apiKey) {
      throw new Error("No NEBULA_API_KEY. Get one with /request-key in discord.utdnebula.com, then add it to .env.");
    }
    const res = await fetch(`${BASE}${path}?${qs}`, { headers: { "x-api-key": this.apiKey, Accept: "application/json" } });
    const body = (await res.json().catch(() => ({}))) as { message?: string; data?: T };
    if (!res.ok || body.message !== "success") throw new Error(`Nebula ${path}: ${res.status} ${body.message ?? ""}`);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify(body.data));
    return body.data as T;
  }
}
