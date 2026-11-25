// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  type Job,
  type PageSnapshot,
  decide,
  isAllowedButton,
  newJob,
  newPlanJob,
  parseCourses,
  safeChooseTerm,
  safeClick,
  snapshot,
  upcomingTerms,
} from "../extension/src/orion.js";

/** Minimal copies of Orion's pages, using the element IDs seen on 2026-11-24. */
const PAGES = {
  termSelect: `
    <h1>Select Term</h1><p>Select a term then select Continue.</p>
    <table>
      <tr><td><input type="radio" id="SSR_DUMMY_RECV1$sels$0$$0" name="SSR_DUMMY_RECV1$sels$0" value="0"></td><td>2026 Fall</td><td>Undergraduate</td></tr>
      <tr><td><input type="radio" id="SSR_DUMMY_RECV1$sels$1$$0" name="SSR_DUMMY_RECV1$sels$0" value="1"></td><td>2027 Spring</td><td>Undergraduate</td></tr>
    </table>
    <input type="button" id="DERIVED_SSS_SCT_SSR_PB_GO" value="Continue">`,
  cartFall: `
    <p>2026 Fall | Undergraduate | University of Texas at Dallas</p>
    <input type="button" id="DERIVED_SSS_SCT_SSS_TERM_LINK" value="Change Term">
    <input type="text" id="DERIVED_REGFRM1_CLASS_NBR">`,
  cartEmpty: `
    <p>2027 Spring | Undergraduate | University of Texas at Dallas</p>
    <input type="text" id="DERIVED_REGFRM1_CLASS_NBR">
    <input type="button" id="DERIVED_REGFRM1_SSR_PB_ADDTOLIST2$9$" value="Enter">
    <p>Your enrollment shopping cart is empty.</p>`,
  cartAdded: `
    <div class="SSSMSGSUCCESSFRAME">PHYS 2325 has been added to your Shopping Cart.</div>
    <p>2027 Spring | Undergraduate | University of Texas at Dallas</p>
    <input type="text" id="DERIVED_REGFRM1_CLASS_NBR">
    <input type="button" id="DERIVED_REGFRM1_SSR_PB_ADDTOLIST2$9$" value="Enter">
    <table>
      <tr><td><input type="hidden" id="P_SELECT$chk$0"><input type="checkbox" id="P_SELECT$0"></td>
          <td><span id="P_CLASS_NAME$span$0"><a id="P_CLASS_NAME$0">PHYS 2325-002 (21075)</a></span></td></tr>
      <tr><td></td><td><span id="P_CLASS_NAME$span$1">PHYS 2325-702 (21140)</span></td></tr>
    </table>
    <input type="button" id="DERIVED_REGFRM1_SSR_PB_DELETE" value="Delete">
    <input type="button" id="DERIVED_REGFRM1_SSR_VIEW_STAT_RPT" value="Validate">
    <input type="button" id="DERIVED_REGFRM1_LINK_ADD_ENRL" value="Enroll">`,
  cartError: `
    <div class="SSSMSGALERTFRAME">Class 12345 is not offered this term.</div>
    <input type="text" id="DERIVED_REGFRM1_CLASS_NBR">`,
  relatedAuto: `
    <h1>1. Select classes to add - Related Class Sections</h1>
    <p>You will automatically be enrolled in the following related class:</p>
    <input type="button" id="DERIVED_CLS_DTL_CANCEL_PB" value="Cancel">
    <input type="button" id="DERIVED_CLS_DTL_NEXT_PB" value="Next">`,
  relatedChoice: `
    <h1>1. Select classes to add - Related Class Sections</h1>
    <input type="radio" name="lab" value="1"><input type="radio" name="lab" value="2">
    <input type="button" id="DERIVED_CLS_DTL_NEXT_PB" value="Next">`,
  prefs: `
    <h1>1. Select classes to add - Enrollment Preferences</h1>
    <input type="checkbox" id="DERIVED_CLS_DTL_WAIT_LIST_OKAY$125$">
    <input type="button" id="DERIVED_CLS_DTL_CANCEL_PB$278$" value="Cancel">
    <input type="button" id="DERIVED_CLS_DTL_NEXT_PB$280$" value="Next">`,
  report: `
    <p>View the following status report for enrollment confirmations and errors</p>
    <table><tr><td>Search</td><td>Plan</td><td><table><tr><td>layout</td></tr></table></td></tr></table>
    <table>
      <tr><td>Description</td><td>Message</td><td>Status</td></tr>
      <tr><td>PHYS 2325</td><td>Hold on record. There is currently a hold that will prevent enrollment.</td><td><img alt="Error"></td></tr>
      <tr><td></td><td>Enrollment Requisites are not met.</td><td><img alt="Error"></td></tr>
    </table>
    <input type="button" id="DERIVED_REGFRM1_SSS_SCHED_PLANNER" value="Shopping Cart">`,
  searchCriteria: `
    <select id="SSR_CLSRCH_WRK_SUBJECT_SRCH$0"><option value="">-</option><option value="CS">CS</option><option value="MATH">MATH</option></select>
    <input type="text" id="SSR_CLSRCH_WRK_CATALOG_NBR$1">
    <input type="button" id="CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH" value="Search">
    <a id="CLASS_SRCH_WRK2_SSR_PB_CLOSE">Return to Shopping Cart</a>`,
  searchNoResults: `
    <div class="SSSMSGALERTFRAME">The search returns no results that match the criteria specified.</div>
    <select id="SSR_CLSRCH_WRK_SUBJECT_SRCH$0"><option value="CS">CS</option></select>
    <input type="text" id="SSR_CLSRCH_WRK_CATALOG_NBR$1">
    <input type="button" id="CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH" value="Search">
    <a id="CLASS_SRCH_WRK2_SSR_PB_CLOSE">Return to Shopping Cart</a>`,
  searchResults: `
    <p>6 class section(s) found</p>
    <a id="MTG_CLASS_NBR$0">25655</a><a id="MTG_CLASSNAME$0">002-LEC
Regular</a><span id="MTG_DAYTIME$0">TuTh 2:30PM - 3:45PM</span><span id="MTG_ROOM$0">ECSS 2.201</span><span id="MTG_INSTR$0">Sruthi Chappidi</span>
    <div id="win0divDERIVED_CLSRCH_SSR_STATUS_LONG$0"><img alt="Open"></div>
    <a id="MTG_CLASS_NBR$1">25980</a><a id="MTG_CLASSNAME$1">701-EXM
Regular</a><span id="MTG_DAYTIME$1">Fr 4:00PM - 6:00PM
Fr 4:00PM - 6:00PM</span><span id="MTG_ROOM$1">ECSW 1.315
HH 2.402</span><span id="MTG_INSTR$1">Brian Wescott Ricks,
To be Announced</span>
    <div id="win0divDERIVED_CLSRCH_SSR_STATUS_LONG$1"><img alt="Open"></div>
    <input type="button" id="CLASS_SRCH_WRK2_SSR_PB_NEW_SEARCH" value="New Search">
    <a id="CLASS_SRCH_WRK2_SSR_PB_CLOSE">Return to Shopping Cart</a>`,
  saveWarning: `<h1>Save Warning</h1><p>You have unsaved data for this transaction.</p>`,
};

function load(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe("safety", () => {
  it("only allows Enter, Next and Validate", () => {
    expect(isAllowedButton("DERIVED_REGFRM1_SSR_PB_ADDTOLIST2$9$", "Enter")).toBe(true);
    expect(isAllowedButton("DERIVED_CLS_DTL_NEXT_PB$280$", "Next")).toBe(true);
    expect(isAllowedButton("DERIVED_REGFRM1_SSR_VIEW_STAT_RPT", "Validate")).toBe(true);
    expect(isAllowedButton("DERIVED_REGFRM1_LINK_ADD_ENRL", "Enroll")).toBe(false);
    expect(isAllowedButton("DERIVED_REGFRM1_SSR_PB_DELETE", "Delete")).toBe(false);
    expect(isAllowedButton("DERIVED_CLS_DTL_CANCEL_PB", "Cancel")).toBe(false);
  });

  it("refuses an allowed ID with the wrong label, or an allowed label on a wrong ID", () => {
    expect(isAllowedButton("DERIVED_CLS_DTL_NEXT_PB", "Finish Enrolling")).toBe(false);
    expect(isAllowedButton("DERIVED_SSR_FL_SSR_ENROLL", "Next")).toBe(false);
    expect(isAllowedButton("SOMETHING_ELSE", "Next")).toBe(false);
  });

  it("allows the navigation buttons it needs, by ID and label", () => {
    expect(isAllowedButton("DERIVED_SSS_SCT_SSR_PB_GO", "Continue")).toBe(true);
    expect(isAllowedButton("DERIVED_SSS_SCT_SSS_TERM_LINK", "Change Term")).toBe(true);
    expect(isAllowedButton("DERIVED_REGFRM1_SSS_SCHED_PLANNER", "Shopping Cart")).toBe(true);
    expect(isAllowedButton("DERIVED_SSS_SCT_SSR_PB_GO", "Enroll")).toBe(false);
  });

  it("only picks term radio buttons, nothing else", () => {
    const doc = load(PAGES.termSelect + '<input type="radio" id="OTHER_RADIO">');
    expect(safeChooseTerm(doc.getElementById("SSR_DUMMY_RECV1$sels$1$$0"))).toBe(true);
    expect(safeChooseTerm(doc.getElementById("OTHER_RADIO"))).toBe(false);
    expect(safeChooseTerm(doc.getElementById("DERIVED_SSS_SCT_SSR_PB_GO"))).toBe(false);
  });

  it("never clicks the Enroll button, even if asked directly", () => {
    const doc = load(PAGES.cartAdded);
    const enroll = doc.getElementById("DERIVED_REGFRM1_LINK_ADD_ENRL")!;
    const spy = vi.fn();
    enroll.addEventListener("click", spy);
    expect(safeClick(enroll)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("page detection", () => {
  it("recognizes the cart, its term and its rows (ignoring hidden twins and related rows)", () => {
    const s = snapshot(load(PAGES.cartAdded));
    expect(s).toMatchObject({ kind: "cart", term: "2027 Spring" });
    expect(s.cartRows).toEqual([{ label: "PHYS 2325-002 (21075)", classNumber: "21075" }]);
    expect(s.messages).toEqual(["PHYS 2325 has been added to your Shopping Cart."]);
  });

  it("tells auto-added related sections apart from ones that need a choice", () => {
    expect(snapshot(load(PAGES.relatedAuto))).toMatchObject({ kind: "related", needsChoice: false });
    expect(snapshot(load(PAGES.relatedChoice))).toMatchObject({ kind: "related", needsChoice: true });
  });

  it("recognizes preferences, the Validate report and the save warning", () => {
    expect(snapshot(load(PAGES.prefs)).kind).toBe("prefs");
    expect(snapshot(load(PAGES.saveWarning)).kind).toBe("saveWarning");
    const r = snapshot(load(PAGES.report));
    expect(r.kind).toBe("report");
    // Layout tables are ignored; a continuation row keeps its course name.
    expect(r.report).toEqual([
      { description: "PHYS 2325", message: "Hold on record. There is currently a hold that will prevent enrollment.", ok: false },
      { description: "PHYS 2325", message: "Enrollment Requisites are not met.", ok: false },
    ]);
  });

  it("reads class search results, including multi-line exam sections", () => {
    const s = snapshot(load(PAGES.searchResults));
    expect(s.kind).toBe("searchResults");
    expect(s.sections).toEqual([
      { classNumber: "25655", section: "002", component: "LEC", meetings: [{ days: ["Tuesday", "Thursday"], start: "2:30PM", end: "3:45PM", room: "ECSS 2.201" }], instructors: ["Sruthi Chappidi"], status: "Open" },
      { classNumber: "25980", section: "701", component: "EXM", meetings: [{ days: ["Friday"], start: "4:00PM", end: "6:00PM", room: "ECSW 1.315" }], instructors: ["Brian Wescott Ricks", "To be Announced"], status: "Open" },
    ]);
  });

  it("tells a search form from a no-results search", () => {
    expect(snapshot(load(PAGES.searchCriteria))).toMatchObject({ kind: "searchCriteria", noResults: false });
    expect(snapshot(load(PAGES.searchNoResults))).toMatchObject({ kind: "searchCriteria", noResults: true });
  });

  it("does nothing on unrelated pages", () => {
    expect(snapshot(load("<h1>Homepage</h1>")).kind).toBe("other");
  });

  it("reads the open terms on the Select Term page", () => {
    expect(snapshot(load(PAGES.termSelect))).toMatchObject({
      kind: "termSelect",
      terms: [
        { label: "2026 Fall", radioId: "SSR_DUMMY_RECV1$sels$0$$0" },
        { label: "2027 Spring", radioId: "SSR_DUMMY_RECV1$sels$1$$0" },
      ],
    });
  });
});

describe("getting to the right cart", () => {
  const page = (html: string): PageSnapshot => snapshot(load(html));

  it("picks the requested term on Select Term", () => {
    const r = decide(page(PAGES.termSelect), newJob(["21075"], false, "2027 Spring"));
    expect(r.action).toEqual({ do: "chooseTerm", radioId: "SSR_DUMMY_RECV1$sels$1$$0" });
  });

  it("explains when the requested term's cart isn't open yet", () => {
    const r = decide(page(PAGES.termSelect), newJob(["21075"], false, "2027 Fall"));
    expect(r.job.status).toBe("error");
    expect(r.job.note).toMatch(/2027 Fall cart isn't open.*2026 Fall, 2027 Spring/);
  });

  it("switches terms if Orion opens a different term's cart", () => {
    const r = decide(page(PAGES.cartFall), newJob(["21075"], false, "2027 Spring"));
    expect(r.action).toEqual({ do: "changeTerm" });
  });

  it("suggests the next semesters by date", () => {
    expect(upcomingTerms(new Date(2026, 10, 24))[0]).toBe("2027 Spring");
    expect(upcomingTerms(new Date(2027, 2, 1))[0]).toBe("2027 Summer");
  });
});

describe("filling the cart, step by step", () => {
  const page = (html: string): PageSnapshot => snapshot(load(html));

  it("goes from Select Term to a filled cart: adds, records a rejection, validates, returns", () => {
    const job: Job = newJob(["21075", "12345"], true, "2027 Spring");

    let r = decide(page(PAGES.termSelect), job);
    expect(r.action.do).toBe("chooseTerm");
    r = decide(page(PAGES.cartEmpty), r.job);
    expect(r.action).toEqual({ do: "enterClass", classNumber: "21075" });
    r = decide(page(PAGES.relatedAuto), r.job);
    expect(r.action).toEqual({ do: "clickNext" });
    r = decide(page(PAGES.prefs), r.job);
    expect(r.action).toEqual({ do: "clickNext", setWaitlist: true });
    r = decide(page(PAGES.cartAdded), r.job);
    expect(r.job.results).toEqual([{ classNumber: "21075", ok: true, message: "PHYS 2325 has been added to your Shopping Cart." }]);
    expect(r.action).toEqual({ do: "enterClass", classNumber: "12345" });

    // Orion rejects the second number and stays on the cart.
    r = decide(page(PAGES.cartError), r.job);
    expect(r.job.results[1]).toEqual({ classNumber: "12345", ok: false, message: "Class 12345 is not offered this term." });
    expect(r.action).toEqual({ do: "validate", select: ["21075"] });

    r = decide(page(PAGES.report), r.job);
    expect(r.job.report[0]?.ok).toBe(false);
    expect(r.action).toEqual({ do: "backToCart" });

    // Back on the filled cart: finished.
    r = decide(page(PAGES.cartAdded), r.job);
    expect(r.job.status).toBe("done");
    expect(r.job.results.map((x) => x.ok)).toEqual([true, false]);
    expect(r.action).toEqual({ do: "none" });
  });

  it("plans from the hours: searches each class, picks sections, then fills", () => {
    let r = decide(page(PAGES.termSelect), newPlanJob(["CS 2336", "CS 9999"], { earliest: "13:00", latest: "19:00" }, { term: "2027 Spring" }));
    expect(r.action.do).toBe("chooseTerm");
    r = decide(page(PAGES.cartEmpty), r.job);
    expect(r.action).toEqual({ do: "openSearch" });
    r = decide(page(PAGES.searchCriteria), r.job);
    expect(r.action).toEqual({ do: "searchCourse", subject: "CS", number: "2336" });
    r = decide(page(PAGES.searchResults), r.job);
    expect(r.action).toEqual({ do: "newSearch" });
    r = decide(page(PAGES.searchCriteria), r.job);
    expect(r.action).toEqual({ do: "searchCourse", subject: "CS", number: "9999" });
    // Last course: no results -> pick the schedule and head back to the cart.
    r = decide(page(PAGES.searchNoResults), r.job);
    expect(r.action).toEqual({ do: "returnToCart" });
    expect(r.job.phase).toBe("fill");
    expect(r.job.queue).toEqual(["25655"]);
    expect(r.job.picked[0]).toMatchObject({ course: "CS 2336", classNumber: "25655", outsideHours: false, teacher: "Sruthi Chappidi" });
    expect(r.job.notices.join(" ")).toMatch(/CS 9999: no open sections/);
    // Back on the cart: start adding.
    r = decide(page(PAGES.cartEmpty), r.job);
    expect(r.action).toEqual({ do: "enterClass", classNumber: "25655" });
  });

  it("allows the search buttons, by ID and label", () => {
    expect(isAllowedButton("DERIVED_REGFRM1_SSR_PB_SRCH", "Search")).toBe(true);
    expect(isAllowedButton("CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH", "Search")).toBe(true);
    expect(isAllowedButton("CLASS_SRCH_WRK2_SSR_PB_NEW_SEARCH", "New Search")).toBe(true);
    expect(isAllowedButton("CLASS_SRCH_WRK2_SSR_PB_CLOSE", "Return to Shopping Cart")).toBe(true);
  });

  it("reads course lists however they're typed", () => {
    expect(parseCourses("CS 2336, cs2340\nECS 2390 math 2419")).toEqual(["CS 2336", "CS 2340", "ECS 2390", "MATH 2419"]);
  });

  it("pauses for the student when a lab or discussion has to be chosen", () => {
    let r = decide(page(PAGES.cartEmpty), newJob(["21075"], false));
    r = decide(page(PAGES.relatedChoice), r.job);
    expect(r.job.status).toBe("paused");
    expect(r.action).toEqual({ do: "none" });
  });

  it("pauses on Orion's unsaved-changes warning", () => {
    expect(decide(page(PAGES.saveWarning), newJob(["21075"], false)).job.status).toBe("paused");
  });

  it("stops itself if it sees the same step three times in a row", () => {
    let job = newJob(["21075"], false);
    job = { ...job, step: "relatedNext" };
    let last = decide(page(PAGES.relatedAuto), job);
    for (let i = 0; i < 3; i++) last = decide(page(PAGES.relatedAuto), last.job);
    expect(last.job.status).toBe("error");
    expect(last.action).toEqual({ do: "none" });
  });

  it("ignores anything that isn't a 5-digit class number", () => {
    expect(newJob(["21075", "2107", "abc", "21075"], false).queue).toEqual(["21075"]);
  });

  it("does nothing once stopped", () => {
    expect(decide(page(PAGES.cartEmpty), { ...newJob(["21075"], false), status: "stopped" }).action).toEqual({ do: "none" });
  });
});
