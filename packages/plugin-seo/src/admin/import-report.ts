/**
 * What Import's last step and its result say, worked out from the engine's
 * dry run alone: the four counts in values (set, the same as automatic,
 * kept, skipped as never served), each page's result for its title and its
 * description, and the report a person can download. Nothing here decides
 * an outcome: the engine did, per page and per value, and this only counts
 * and words what it said.
 *
 * @module admin/import-report
 */
import {
  IMPORT_TARGET_LABELS,
  IMPORT_TARGETS,
  type DryRunBody,
  type ImportReportEntry,
  type ImportTarget,
} from "../import/contract";

/** A value's result for one page, as the report's table says it. */
export type ValueResult = "set" | "same" | "kept" | "neverServed" | "none";

/** Each result's words, and the line under it. */
export const RESULT_WORDS: Readonly<
  Record<Exclude<ValueResult, "none">, { label: string; why?: string }>
> = {
  set: { label: "Will set" },
  same: { label: "Same as automatic", why: "left empty" },
  kept: { label: "Kept", why: "already typed" },
  neverServed: { label: "Skipped", why: "never served" },
};

/** `place`'s result on the page `entry` reports. */
export function resultOf(
  entry: ImportReportEntry,
  place: ImportTarget
): ValueResult {
  if (entry.set.includes(place)) return "set";
  if (entry.kept.includes(place)) return "kept";
  if (entry.same.includes(place)) return "same";
  if (entry.neverServed.includes(place)) return "neverServed";
  return "none";
}

/** The four counts the last step shows, in values, with the pages each is on. */
export interface ValueCounts {
  set: { values: number; pages: number };
  same: { values: number; pages: number };
  kept: { values: number; pages: number };
  neverServed: { values: number; pages: number; labels: string[] };
}

/** The counts, from the dry run's report of each page. */
export function valueCounts(run: DryRunBody): ValueCounts {
  const pages = run.documents.filter(entry => entry.id !== undefined);
  const tally = (
    list: (entry: ImportReportEntry) => readonly ImportTarget[]
  ) => {
    const holding = pages.filter(entry => list(entry).length > 0);
    return {
      values: holding.reduce((sum, entry) => sum + list(entry).length, 0),
      pages: holding.length,
    };
  };
  const skipped = pages.filter(entry => entry.neverServed.length > 0);
  return {
    set: tally(entry => entry.set),
    same: tally(entry => entry.same),
    kept: tally(entry => entry.kept),
    neverServed: {
      ...tally(entry => entry.neverServed),
      labels: skipped.map(entry => entry.label),
    },
  };
}

/** The places a page's entry has any result for. */
function placesOf(entry: ImportReportEntry): Set<ImportTarget> {
  return new Set([
    ...entry.set,
    ...entry.same,
    ...entry.kept,
    ...entry.neverServed,
  ]);
}

/**
 * The pages the table lists: those the import reads a title or description
 * for, or that it changes in any other place, such as hiding one from search.
 */
export function reportedPages(run: DryRunBody): ImportReportEntry[] {
  return run.documents.filter(
    entry =>
      entry.id !== undefined &&
      (entry.values.title !== undefined ||
        entry.values.description !== undefined ||
        placesOf(entry).size > 0)
  );
}

/** A place other than the title and description, with its result. */
export interface OtherChange {
  place: ImportTarget;
  label: string;
  result: Exclude<ValueResult, "none">;
}

/**
 * What the import does to a page's other places (its share image, social
 * text, official address, whether it is hidden), in the order the match
 * step offers them; the title and description have columns of their own.
 */
export function otherChanges(entry: ImportReportEntry): OtherChange[] {
  const places = placesOf(entry);
  const changes: OtherChange[] = [];
  for (const place of IMPORT_TARGETS) {
    if (place === "title" || place === "description" || !places.has(place)) {
      continue;
    }
    const result = resultOf(entry, place);
    if (result !== "none") {
      changes.push({ place, label: IMPORT_TARGET_LABELS[place], result });
    }
  }
  return changes;
}

/**
 * One cell of the downloaded report: text a spreadsheet would run as a
 * formula is marked as text first, as the admin's other exports do, since
 * titles come from outside; then quoted where it holds a separator.
 */
function cell(value: string): string {
  const formulaLike =
    /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value);
  const text = formulaLike ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A value's result in words, for the downloaded report. */
function resultWords(entry: ImportReportEntry, place: ImportTarget): string {
  const result = resultOf(entry, place);
  if (result === "none") return "";
  const words = RESULT_WORDS[result];
  return words.why === undefined
    ? words.label
    : `${words.label} (${words.why})`;
}

/**
 * The report of `run` as CSV: one row per page and per record passed over,
 * with each value the source holds, what the import does with it, and why
 * a row is skipped.
 */
export function reportCsv(run: DryRunBody): string {
  const rows = [
    [
      "Page",
      "Outcome",
      "Title on Google",
      "Title result",
      "Description on Google",
      "Description result",
      "Why",
    ],
    ...run.documents.map(entry => [
      entry.label,
      entry.outcome,
      entry.values.title ?? "",
      resultWords(entry, "title"),
      entry.values.description ?? "",
      resultWords(entry, "description"),
      entry.reason ?? "",
    ]),
  ];
  return `${rows.map(row => row.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** `n` and its noun, singular or plural. */
function counted(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * What the note on matching says about values never served: that they are
 * skipped, and why, or that they are included; none where the dry run
 * skipped none and they are not included.
 */
export function neverServedWords(
  run: DryRunBody | undefined,
  include: boolean,
  sourceLabel: string
): { title: string; text: string } | undefined {
  // Shown while included too, so the choice can be taken back.
  if (include) {
    return {
      title: "Values never served are included",
      text: "Values a page's own code sets will be imported, which changes what those pages show.",
    };
  }
  const skipped = run === undefined ? undefined : valueCounts(run).neverServed;
  if (skipped === undefined || skipped.pages === 0) return undefined;
  const [only] = skipped.labels;
  const who =
    skipped.labels.length === 1
      ? `${only ?? ""} sets its own title and description in its code`
      : `${skipped.labels.join(", ")} set their own titles and descriptions in their code`;
  return {
    title: `${counted(skipped.pages, "page's values are", "pages' values are")} never served, so they'll be skipped`,
    text: `${who}, so the values stored in ${sourceLabel} never reached the page. Importing them would change what the page shows.`,
  };
}
