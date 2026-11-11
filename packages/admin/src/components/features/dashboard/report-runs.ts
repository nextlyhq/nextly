/**
 * How the diagnostics report is broken into lines on screen, without changing
 * a character of it.
 *
 * Details shows the report in a narrow block that wraps, and a wrap that falls
 * inside a phrase ("24" at a line's end, "h" on the next) reads as two facts.
 * Each line is cut into runs, and a run that must stay whole is drawn
 * unbroken: a number and the word after it ("24 h", "3 locales"), with a
 * short bracketed list that follows it ("3 locales (en, es, ar)"); a name and
 * its version ("Node 24.11.0"); and a short bracketed note
 * ("(latest: 0.0.2-alpha.74)"). A " · " between two facts stays with the fact
 * before it. Everything else wraps at its spaces.
 *
 * The runs join back to the line exactly, so the text on screen, and what a
 * reader selects and copies from it, is the report as built: plain spaces,
 * no non-breaking ones.
 *
 * @module components/features/dashboard/report-runs
 */

/** A piece of a line, and whether it is drawn without a break inside it. */
export interface ReportRun {
  text: string;
  whole: boolean;
}

/**
 * The runs drawn whole, in the order they are tried at each place in a line:
 * a capitalised name and a dotted version ("Next.js 16.4.2"); a number and its
 * word, with a short bracketed list after it; a short bracketed note; and any
 * word before a " · " separator. Each keeps the separator that follows it, so a
 * wrapped line ends on "·" rather than starting with one.
 */
const WHOLE_RUN =
  /(?:[A-Z][\w.]*\s\d+\.\d[\w.+-]*|\d[\d.,]*\s[^\s·,():]+(?:\s\([^()]{1,24}\))?|\([^()]{1,28}\)|[^\s·]+(?=\s·))(?:\s·)?/g;

/** `line` cut into runs that join back to it exactly. */
export function reportRuns(line: string): ReportRun[] {
  const runs: ReportRun[] = [];
  let at = 0;
  for (const match of line.matchAll(WHOLE_RUN)) {
    const start = match.index;
    if (start > at) runs.push({ text: line.slice(at, start), whole: false });
    runs.push({ text: match[0], whole: true });
    at = start + match[0].length;
  }
  if (at < line.length) runs.push({ text: line.slice(at), whole: false });
  return runs;
}
