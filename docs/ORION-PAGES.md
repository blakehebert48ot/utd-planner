# Orion page map (for the Chrome extension)

Mapped 2026-11-24 by reading a real student's Orion while they were logged in. Read-only: nothing was changed. No personal data is recorded here.

## The big picture
- **Orion is UT Share**, the UT System's shared PeopleSoft Campus Solutions. After UTD sign-in (`idp.utdallas.edu`, Duo) the app lives at `dacs-prd.utshare.utsystem.edu/psc/DACSPRD/EMPLOYEE/SA/...`.
- UT Share also serves **UT Arlington, El Paso, Permian Basin, Rio Grande Valley, San Antonio and Tyler**. Their pages are likely built the same way, so the extension could reach other UT schools later. (Not checked.)
- Entering through `orion.utdallas.edu` is reliable. Arriving at the bare UT Share host after sign-in can land on a "Sign Out Notice" page; going to `orion.utdallas.edu` again fixes it.
- Page content sits inside a **same-origin iframe `#main_target_win0`**. Read it via `iframe.contentDocument`. The outer page holds only the left nav.
- The default homepage can be **"Applicant Center"**. The homepage dropdown (top-left) switches to **"UTD Student Center"** (page 2 of 2).

## Pages and what they hold

| Need | Where | What's there |
|---|---|---|
| Major, plan code, catalog year | Student Center > **My Academics** > *My Academic Profile* | Degree ("Bachelor of Science"), school, **University Catalog** (e.g. "2026 Fall"), table: Academic Plan code (e.g. `CS__BS`), Description, **Major Catalog** |
| Every course | My Academics > *My Course History* | Table: **Class \| Description \| Term \| Grade \| Units \| Status**. Status values seen: `In Progress`, `Transferred`, `Planned`. Expect `Taken` for completed classes (not seen yet). |
| Official degree audit | My Academics > *My Degree Audit* ("My Academic Requirements") | Click **Expand All** first. Each requirement shows `Satisfied:` / `Not Satisfied:`, a line like `Units: 6.00 required, 3.00 taken, 3.00 needed` (and sometimes `Courses: …`), then a table of courses used. Also has **View Report as PDF**, and **Search \| Plan \| Enroll \| My Academics** tabs at the top. |
| Transfer credit | My Academics > *View My Transfer Credit Report* | Not read yet |
| Shopping cart | Student Center > **Manage My Classes** > *Shopping Cart* | Mapped. See "Shopping cart" below. |
| Other enrollment pages | Manage My Classes left nav | View My Classes, Degree Planner, Schedule Planner, Add a Class, Swap Classes, Drop Classes, **Enrollment Appointment**, Class Search, Browse Course Catalog (not mapped) |

## Shopping cart (mapped 2026-11-24 with one test class, added and then deleted)

A **classic** PeopleSoft page inside **`iframe#ptifrmtgtframe`** (not `main_target_win0`). URL:
`.../psp/DACSPRD/EMPLOYEE/SA/c/SA_LEARNER_SERVICES_2.SSR_SSENRL_CART.GBL?Page=SSR_SSENRL_CART&Action=A&ACAD_CAREER=UGRD&INSTITUTION=UTDAL&STRM=<term>`. The real URL also carries the student's EMPLID: **never log or store it**.
- `STRM=2272` is 2027 Spring. Likely pattern `2 + YY + season`, but only one value has been seen, so verify before relying on it.
- The cart opens per term. Only terms open for the cart are offered (on 2026-11-24: 2026 Fall and 2027 Spring; Fall 2027 not yet).

### Adding one class (the flow the extension automates)
1. Type the 5-digit class number into **`DERIVED_REGFRM1_CLASS_NBR`** and click **`DERIVED_REGFRM1_SSR_PB_ADDTOLIST2$9$`** ("Enter").
2. **"1. Select classes to add - Related Class Sections"**: shows the lecture plus any related class. With one option it auto-attaches it (PHYS 2325 auto-adds its "Common Exam" section). With several (labs/discussions) expect a choice (not seen yet). Buttons: `DERIVED_CLS_DTL_CANCEL_PB`, **`DERIVED_CLS_DTL_NEXT_PB`**.
3. **"Enrollment Preferences"**: checkbox **`DERIVED_CLS_DTL_WAIT_LIST_OKAY$125$`** ("Wait list if class is full"), grading, units, and an "Enrollment Information" block with prereq/coreq text and core designations. **Next** (`DERIVED_CLS_DTL_NEXT_PB$280$`) **adds to the cart**.
4. Back on the cart with the message *"PHYS 2325 has been added to your Shopping Cart."*

Searching instead (Class Search > Select) leads to the same step 2. Search form: `SSR_CLSRCH_WRK_SUBJECT_SRCH$0` (select), `SSR_CLSRCH_WRK_CATALOG_NBR$1`. Results show class number, section ("002-LEC"), days/times, room, instructor, dates and open/closed status.

### Cart contents and buttons
- Row checkbox **`P_SELECT$<n>`** (ignore its hidden twin `P_SELECT$chk$<n>`). Row link **`P_CLASS_NAME$<n>`** reads "PHYS 2325-002 (21075)". Related sections appear as `P_CLASS_NAME$span$<n>` rows with no checkbox.
- **Delete** `DERIVED_REGFRM1_SSR_PB_DELETE` and **Validate** `DERIVED_REGFRM1_SSR_VIEW_STAT_RPT` act on checked rows.
- ⛔ **Enroll `DERIVED_REGFRM1_LINK_ADD_ENRL`: the extension must never click this.**
- **Validate** opens a status report: Description | Message | Status (✓ OK to Add / ✗ Potential Problem). Messages seen: *"Hold on record… will prevent enrollment"* and *"Enrollment Requisites are not met. Prerequisite: … Corequisites: …"*. The back button `DERIVED_REGFRM1_SSS_SCHED_PLANNER` is labeled "Shopping Cart". Validate is a free second check on the planner's cart: run it at the end and show the report.
- Already-enrolled classes for the term are listed below the cart as `E_CLASS_NAME$<n>`, e.g. "CS 1337-502 (25246)".

### Gotchas
- ⚠️ **After "Next", the orange Enroll button renders at the same screen position where "Next" was.** Never click by coordinates: always find elements by ID and check the button's label before clicking.
- IDs carry varying `$NNN$` suffixes. Match by prefix (`[id^="DERIVED_CLS_DTL_NEXT_PB"]`) and confirm the button's `value`.
- Cancelling mid-flow shows a **"Save Warning"** page. OK goes back; **Cancel discards**.
- `.click()` from JavaScript works on these buttons (they call `submitAction_win0`).
- Schedule Planner (`PRJCS_DERIVED_PRJCS_SCHD_PLN_PB`) opens outside the page (probably a pop-up). Not mapped, and not needed.
- Never visited on purpose: step 2 "Confirm" and "Finish Enrolling".
- Not mapped yet: Enrollment Appointment page, the multiple-lab choice screen, closed-class and waitlist behavior, the permission-number prompt.

### Select Term page (mapped 2026-11-24)
- Opening `CART_URL` without `STRM` shows **Select Term**: radios `SSR_DUMMY_RECV1$sels$<n>$$0`, one row per open term ("2026 Fall", "2027 Spring"), and **Continue** `DERIVED_SSS_SCT_SSR_PB_GO`.
- On the cart: **Change Term** `DERIVED_SSS_SCT_SSS_TERM_LINK`.

### Class search (mapped 2026-11-24, live data for the exact term)
- From the cart: radio `DERIVED_REGFRM1_SSR_CLS_SRCH_TYPE$249$` (value `06` = Class Search), then **Search** `DERIVED_REGFRM1_SSR_PB_SRCH`.
- Form: subject `SSR_CLSRCH_WRK_SUBJECT_SRCH$0` (select), match `SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$1` (default `E`), number `SSR_CLSRCH_WRK_CATALOG_NBR$1`, "Show Open Classes Only" `SSR_CLSRCH_WRK_SSR_OPEN_ONLY$3` (checked by default). **Search** `CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH`.
- No match: stays on the form with *"The search returns no results that match the criteria specified."*
- Results, per row `n`:
  - `MTG_CLASS_NBR$n` (class number)
  - `MTG_CLASSNAME$n` ("001-LEC Regular"; EXM = common exam, auto-attached)
  - `MTG_DAYTIME$n` ("MoWe 10:00AM - 11:15AM"; several lines for multiple meetings)
  - `MTG_ROOM$n`
  - `MTG_INSTR$n` (full names like "Brian Wescott Ricks"; "To be Announced")
  - `MTG_TOPIC$n` (dates)
  - status icon `#win0divDERIVED_CLSRCH_SSR_STATUS_LONG$n img[alt]` (Open / Closed / Wait List)
- Buttons: **New Search** `CLASS_SRCH_WRK2_SSR_PB_NEW_SEARCH`, **Return to Shopping Cart** link `CLASS_SRCH_WRK2_SSR_PB_CLOSE`.
- Some sections meet once a week (e.g. ECS 2390 "Tu 1:00PM - 2:15PM", room "No Meeting Room").

### Validate report (refined)
Only innermost rows with exactly three `<td>` and a status `<img>` are real; everything else is layout. A row with an empty first cell continues the previous course.

### Live end-to-end test (2026-11-24, Spring 2027, made from the extension's own code)
Hours 1:00–7:00pm with CS 2336 and ECS 2390: Select Term → two searches (6 and 25 sections) → picked CS 2336-002 (TuTh 2:30) and ECS 2390-006 (Tu 1:00) → both added (the CS exam section came along) → Validate → back on the filled cart. The test classes were then deleted.

### What the cart filler needs from the planner
Exact **class numbers** for the chosen section *and* its related sections (lab/discussion/exam), plus the student's waitlist preference. Section data (class numbers, times, instructors) has to come from Nebula/CourseBook for the target term.

## Gotchas found
- **"In Progress" also means *registered for a future term*.** Spring classes show `In Progress` in November. Use the Term column to tell current from upcoming.
- Course History includes **`Planned`** rows from Orion's own planner (a saved multi-year plan). These rows are not enrollments. Keep them separate; they're useful as "what the student or advisor already intended."
- The degree audit counts in-progress classes as "taken" in its unit totals.
- The audit lists sequence options separately (e.g. "MATH 2413 and MATH 2414" vs "MATH 2417 and MATH 2419"). A student who mixes them satisfies neither, so the extension should surface that.
- The audit accepts substitutions the catalog page doesn't list (honors physics PHYS 2421/2422). Keep these in `data/catalog/<year>/program-overrides.json`.
- `get_page_text`-style tools see nothing because of the iframe. Read the iframe's DOM directly.
