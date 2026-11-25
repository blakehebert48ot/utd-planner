# UTD Planner

Plans a UT Dallas student's next semester from the official catalog, ranks professors with public grade data, and fills their Orion shopping cart. The student clicks "Finish Enrolling" themselves. The full plan is in `../PLANNER-BUILD-PLAN.md`.

## Commands
- `npm run build:rules`: download catalog pages (cached in `data/raw/`, 1.5s between requests) and regenerate `data/catalog/<year>/`
- `npm run audit:demo [-- sophomore]`: print an audit and next-term plan for a sample student
- `npm run fetch:grades`: download UTD grade CSVs (17F onward) from Nebula's public `api-tools` repo (MIT) into `data/grades/sections.json` (gitignored, about 11 MB)
- `npm run profs -- "CS 2336" [--fewest-drops]`: rank professors for a course from grade data
- `npm run schedule:demo -- data/students/me.json --earliest 10:00am --latest 4:00pm --gaps none [--off Friday] [--fewer-days] [--prof easiest|fewestDrops|ignore]`: full pipeline (plan, professors, Plans A/B/C, cart numbers). Uses **sample sections** until Nebula works.
- `npm run nebula:check -- "CS 2336"`: test the Nebula key (from `.env`) and list which terms have sections
- `npm run build:ext`: build the Chrome extension into `extension/dist/`. Load `extension/` unpacked at chrome://extensions (Developer mode).
- `npm test` / `npm run typecheck`

## Layout
- `src/model.ts`: all data shapes (rules, courses, student record). Start here.
- `src/catalog/`: catalog HTML into data. `parseProgram.ts` (degree page into rules), `parseCourses.ts` (course listings and the prerequisite grammar).
- `src/engine/`: `audit.ts` (what's done or left), `nextTerm.ts` (what to take next), `catalogIndex.ts` (lookups and cross-listed equivalents).
- `data/catalog/<year>/`: generated JSON, committed. `programs/<id>.json` has `verified` and `needsReview`.
- `src/grades/`: grade CSV parsing (`GRADE_ORDER` = A+ … F, W, Nebula's order) and professor stats and ranking.
- `src/schedule/`: schedule builder. Hard rules (time window, days off, no overlaps) are never broken; professors, gaps and campus days are scored. If nothing fits it drops the lowest-priority course and reports it. `tests/fixtures/sampleSections.ts` holds made-up sections (class numbers 99xxx) with real professor names.
- `extension/`: Chrome MV3 cart filler. `src/orion.ts` holds page detection, the pure `decide()` state machine and `safeClick` (allow-list: Enter, Next, Validate only, checked by ID prefix AND label). `src/content.ts` runs in Orion frames and saves job state to `chrome.storage.local` before each click, because Orion reloads the frame. `src/popup.ts` is the UI. Only host permission: `dacs-prd.utshare.utsystem.edu`.
- `src/nebula/client.ts`: Nebula API client (sections with class numbers). Key in `.env` as `NEBULA_API_KEY`; responses cached in `data/raw/nebula/`. Verified live 2026-11-24. Nebula already had the upcoming term (27S) matching Orion, but not 27F yet. Use it for planning *before* a term's cart opens; the extension uses Orion's live class search when filling.
- `tests/`: vitest. `tests/fixtures/students.ts` holds made-up students only.

## Rules that matter
- **AI explains, code decides.** Whether a requirement is met or a prereq is satisfied is decided only by code in `src/engine/`. AI may help *produce* rules from catalog text, but a human checks them before `verified: true`.
- Never drop catalog text we can't parse. Keep it as `{type: "manual"}` / `{op: "text"}` or in `needsReview`, and show it to the student.
- A program's rules are trusted only after they're compared against a real UTD degree audit. Then set `verified: true`. `build:rules` resets it if the catalog changed.
- Courses can count toward both a core block and a major block (UTD lists them in both). "N hours from a set" picks never reuse a course already used in the same domain.
- The catalog's schedule letters (S/Y/R/F/P/T/U after "(3-0)") are **unverified**. Don't use them to decide when a course is offered; use real past section data.
- Student data is sensitive: never commit real records (`data/students/` is gitignored). Send servers only what's needed, and prefer running the engine in the browser.
- Orion: the extension only reads pages the student has open and adds classes to the cart. It never enrolls, never stores passwords, and never runs at registration time to grab seats.
- In Orion, find buttons by element ID and check their label before clicking. Never click by screen position: Enroll (`DERIVED_REGFRM1_LINK_ADD_ENRL`) appears where "Next" just was. See `docs/ORION-PAGES.md`.
- Rate My Professors: link to RMP pages (`ratemyprofessors.com/search/professors/1273?q=<name>`). Don't scrape or copy ratings/reviews. UTD Trends calls RMP's private GraphQL with a fake browser identity; we don't copy that.
- Grade data shows how a professor *grades*, not how well they *teach*. Say so wherever rankings appear. Pull small samples toward the course average (`adjustedGpa`), and only compare professors actually teaching the target term.
- Overlap to know about: Nebula's **Skedge** extension already shows grades and RMP inside UTD's Schedule Planner. Our edge is degree requirements, the plan, and filling the cart.

## Status
- Done: CS BS 2026 rules, **verified** block by block against a real UTD degree audit (2026-11-24, see `verification` in the rules file). Course and prereq parsing (678 courses, 19 subjects). Audit with residency and GPA checks, mixed-sequence warnings. Next-term ranking with corequisite handling. 21 tests.
- Orion page map: `docs/ORION-PAGES.md`.
- `npm run audit:demo -- data/students/me.json` runs on a private local record (gitignored).
- Shopping cart flow mapped (add by class number, Validate, Delete), including element IDs.
- Grade data: 55,297 sections over 26 terms (17F–26S), professor ranking, 29 tests.
- Schedule builder done (Plans A/B/C with teacher cards and cart numbers), 39 tests.
- Waiting on the Nebula key: the bot didn't respond on 2026-11-24 at 1:33 AM, and requests are reviewed by hand. When it arrives: `npm run nebula:check`, confirm the response shape, see whether upcoming-term sections are listed, and handle linked sections (labs and exams, which have their own class numbers).
- Chrome extension v0.2 works end to end on live Orion. The student sets hours at school (required) and classes; the extension searches each class in Orion's own class search (live sections, no Nebula needed), picks sections inside the hours (`src/schedule/fromOrion.ts`: grade-ranked, with a fallback to the closest section plus a notice), fills the cart, validates, and returns to the cart. Professor stats ship in `extension/data/prof-stats.json` (`npm run build:ext-data`).
- Next: fill in "Classes to take" automatically from the student's Orion record (Course History + Academic Profile) and the requirements engine, so the hours are the only input.
