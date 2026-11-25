export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export type Day = (typeof DAYS)[number];

const SHORT: Record<string, Day> = {
  m: "Monday", mon: "Monday", monday: "Monday",
  t: "Tuesday", tu: "Tuesday", tue: "Tuesday", tues: "Tuesday", tuesday: "Tuesday",
  w: "Wednesday", wed: "Wednesday", wednesday: "Wednesday",
  r: "Thursday", th: "Thursday", thu: "Thursday", thur: "Thursday", thurs: "Thursday", thursday: "Thursday",
  f: "Friday", fri: "Friday", friday: "Friday",
  s: "Saturday", sa: "Saturday", sat: "Saturday", saturday: "Saturday",
  su: "Sunday", sun: "Sunday", sunday: "Sunday",
};

export function toDay(s: string): Day | undefined {
  return SHORT[s.trim().toLowerCase()];
}

/** "1:00pm", "1:00 PM", "13:00", "8am" -> minutes after midnight. */
export function parseTime(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/);
  if (!m) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const ap = m[3]?.[0];
  if (ap === "p" && h !== 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return h * 60 + min;
}

export function formatTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}
