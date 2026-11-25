// Bundle the extension's TypeScript into extension/dist/ (load extension/ as an unpacked extension).
import { build } from "esbuild";

await build({
  entryPoints: { content: "extension/src/content.ts", popup: "extension/src/popup.ts" },
  outdir: "extension/dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  logLevel: "info",
});
