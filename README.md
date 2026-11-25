# UTD Planner

**Tell it when you can be on campus. It fills your UT Dallas shopping cart with the right classes, in the right time slots, with the best-graded professors, and never enrolls you.**

Every semester, UTD students juggle the degree catalog, UTD Grades, Rate My Professors and Orion's finicky Schedule Planner for hours. UTD Planner does the whole loop in about a minute, inside Orion, as a Chrome extension.

```
  You: "I can be at school 1pm–7pm"          (plus the classes you need)
        │
        ▼
  Search each class in Orion's live class search   ── real sections, this exact semester
        │
        ▼
  Pick sections inside your hours                  ── no clashes, best-graded professors,
        │                                             closest option + a warning if nothing fits
        ▼
  Add them to your cart → run Orion's Validate     ── holds, prerequisites, conflicts
        │
        ▼
  Land on your filled cart. You click "Finish Enrolling" on your date.
```

## What's in here

| Piece | What it does |
|---|---|
| **Catalog → rules** (`src/catalog/`) | Parses UTD's online catalog into machine-checkable degree requirements and a prerequisite logic tree for 678 courses (e.g. `(CS 2305 or MATH 3315) with a C or better, and …`). |
| **Degree audit engine** (`src/engine/audit.ts`) | Shows what's done, in progress and still needed. CS 2026 rules were checked block by block against a real UTD degree audit. |
| **Next-semester planner** (`src/engine/nextTerm.ts`) | Ranks remaining courses by how many later courses they unlock, enforces prerequisites and corequisites, and flags mixed sequences (e.g. Calc I from one track, Calc II from another). |
| **Professor stats** (`src/grades/`) | 55,297 class sections of public grade data (2017–2026). Average GPA, % A's, % D/F, withdrawal rate, with small samples pulled toward the course average. |
| **Schedule builder** (`src/schedule/`) | Constraint search over sections: hard time window and days off, no overlaps, then scores professors, gaps and days on campus. Returns Plans A/B/C. |
| **Chrome extension** (`extension/`) | Drives Orion's Select Term → Class Search → Add to Cart → Validate pages and returns to the filled cart. |

## Safety by design

The extension acts inside a real student account, so it's deliberately limited:

- **It can't enroll you.** Clicks go through an allow-list of 10 buttons (Search, Enter, Next, Continue, Validate, return links). Each is checked by **element ID and visible label**, and Enroll / Drop / Delete / Swap are explicitly refused. Tests prove it won't click Enroll even when asked directly.
- **It never clicks by screen position.** Orion draws its Enroll button exactly where "Next" was a moment earlier, so position-based clicking could enroll someone by accident.
- **It never stores passwords.** It runs only inside the student's own signed-in Orion tab, on one host.
- **It stops itself** if it sees the same step three times, and pauses for the student when Orion needs a human choice (e.g. picking a lab section).
- **It's honest about gaps.** Anything it can't fit or can't check (instructor consent, "or equivalent") is shown to the student instead of guessed.

## Data, and what it doesn't do

- **Grades:** public-records grade distributions published by [Nebula Labs](https://github.com/UTDNebula/api-tools) (MIT).
- **Sections:** read live from Orion's class search for the exact term. Optionally also from the [Nebula API](https://api.utdnebula.com) for planning ahead.
- **Rate My Professors:** linked, not scraped. Grade data shows how a professor *grades*, not how well they *teach*, and the app says so.
- **Student records** stay on the student's machine and are never committed.

## Try it

```bash
npm install
npm test                        # 72 tests
npm run build:rules             # catalog -> data/catalog/2026/
npm run fetch:grades            # public grade CSVs -> data/grades/
npm run profs -- "CS 2336"      # rank professors for a course
npm run schedule:demo -- --earliest 10:00am --latest 4:00pm --gaps none

npm run build:ext-data && npm run build:ext
# Chrome → chrome://extensions → Developer mode → Load unpacked → extension/
```

## Status

- ✅ CS (2026 catalog) rules verified against a real degree audit
- ✅ End-to-end run on live Orion: hours in, filled cart out (test classes removed afterwards)
- 🚧 Auto-filling "classes to take" from the student's Orion record, so hours are the only input
- 🚧 Other majors (built from the catalog, not yet verified against real audits)

Not affiliated with UT Dallas or Nebula Labs. Always confirm your plan with your academic advisor.

Built with [Claude Code](https://claude.com/claude-code).
