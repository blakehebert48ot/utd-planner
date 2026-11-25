import type { Section } from "../../src/nebula/client.js";
import { profKey } from "../../src/grades/professorStats.js";

/**
 * MADE-UP sections for testing and demos until the Nebula key works.
 * Professors are real people who taught these courses recently (from public
 * grade data). Times, rooms and class numbers are invented; class numbers start
 * with 99 so they can't be mistaken for real ones.
 */
const MW = ["Monday", "Wednesday"];
const TR = ["Tuesday", "Thursday"];

let n = 99000;
function sec(course: string, section: string, days: string[], start: string, end: string, prof?: [string, string], room = "ECSS 2.410"): Section {
  const [building, r] = room.split(" ");
  return {
    course,
    term: "27F",
    section,
    classNumber: String(++n),
    mode: "Face-to-Face",
    meetings: [{ days, start, end, building: building!, room: r ?? "" }],
    professors: prof ? [{ name: `${prof[0]} ${prof[1]}`, key: profKey(prof[1], prof[0]) }] : [],
  };
}

export const SAMPLE_SECTIONS: Record<string, Section[]> = {
  "CS 2336": [
    sec("CS 2336", "001", MW, "8:30am", "9:45am", ["Brian", "Ricks"]),
    sec("CS 2336", "002", MW, "11:30am", "12:45pm", ["Meghana", "Satpute"]),
    sec("CS 2336", "003", TR, "1:00pm", "2:15pm", ["Kamran", "Khan"]),
    sec("CS 2336", "004", TR, "4:00pm", "5:15pm", ["Beiyu", "Lin"]),
  ],
  "CS 2340": [
    sec("CS 2340", "001", MW, "10:00am", "11:15am", ["Nhut", "Nguyen"], "ECSW 1.315"),
    sec("CS 2340", "002", TR, "11:30am", "12:45pm", ["Wafa", "Jaffal"], "ECSW 1.315"),
    sec("CS 2340", "003", MW, "2:30pm", "3:45pm", ["Gity", "Karami"], "ECSW 1.315"),
  ],
  "ECS 2390": [
    sec("ECS 2390", "001", TR, "10:00am", "11:15am", ["Christina", "Montgomery"], "JO 4.614"),
    sec("ECS 2390", "002", MW, "1:00pm", "2:15pm", ["Jonathan", "Hartmann"], "JO 4.614"),
    sec("ECS 2390", "003", TR, "2:30pm", "3:45pm", ["Melissa", "Hernandez-Katz"], "JO 4.614"),
  ],
  "MATH 2419": [
    sec("MATH 2419", "001", MW, "10:00am", "11:15am", ["Anatoly", "Eydelzon"], "SLC 1.102"),
    sec("MATH 2419", "002", TR, "8:30am", "9:45am", ["Mohammad", "Ahsan"], "SLC 1.102"),
    sec("MATH 2419", "003", TR, "11:30am", "12:45pm", ["Nathan", "Williams"], "SLC 1.102"),
  ],
};
