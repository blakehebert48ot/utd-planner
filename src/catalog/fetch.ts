import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const BASE = "https://catalog.utdallas.edu";
const USER_AGENT = "utd-planner (student project; polite cached fetcher)";
/** Wait between live requests so we never hammer UTD's servers. */
const DELAY_MS = 1500;

let lastFetch = 0;

/**
 * Fetch a catalog page, caching it under data/raw/catalog-<year>/.
 * Cached pages are reused, so re-running the build makes no network calls.
 */
export async function fetchCatalogPage(year: number, path: string, rawDir = "data/raw"): Promise<string> {
  const file = join(rawDir, `catalog-${year}`, path.replace(/\//g, "_") + ".html");
  try {
    return await readFile(file, "utf8");
  } catch {
    // not cached yet
  }
  const wait = lastFetch + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();

  const url = `${BASE}/${year}/undergraduate/${path}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const html = await res.text();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
  return html;
}

export function programUrl(year: number, school: string, slug: string): string {
  return `${BASE}/${year}/undergraduate/programs/${school}/${slug}`;
}
