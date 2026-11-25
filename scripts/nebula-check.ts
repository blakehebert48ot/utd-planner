/**
 * Check the Nebula API key and see what section data looks like.
 *   npm run nebula:check -- "CS 2336"
 * Prints which terms have sections (so we know if upcoming terms are listed)
 * and one normalized section. Never prints the key.
 */
import { NebulaClient } from "../src/nebula/client.js";

try {
  process.loadEnvFile(".env");
} catch {
  // no .env file; NebulaClient will explain what's missing
}

const course = process.argv[2] ?? "CS 2336";
const sections = await new NebulaClient().courseSections(course).catch((e: Error) => {
  console.error(e.message);
  process.exit(1);
});
const byTerm = new Map<string, number>();
for (const s of sections) byTerm.set(s.term, (byTerm.get(s.term) ?? 0) + 1);
console.log(`${course}: ${sections.length} sections`);
console.log("terms:", [...byTerm.entries()].map(([t, n]) => `${t}(${n})`).join(" "));
const newest = [...sections].sort((a, b) => b.term.localeCompare(a.term))[0];
console.log("example (newest term):", JSON.stringify(newest, null, 2));
