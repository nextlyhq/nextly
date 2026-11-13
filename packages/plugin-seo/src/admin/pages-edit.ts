/**
 * What the Pages screen's Edit mode works out from the pages listed, each
 * content type's rows as bulk edit reads them, and what a person typed: the
 * rows and whether each can be changed here, the line under each box, and a
 * save split into the steps that each save on their own, so a save that
 * stops part-way can say which pages were saved and which were not. Pure,
 * so the screen and its tests read one answer.
 *
 * A page with an entry is saved through bulk edit's save, one content type
 * per step, every page of a step saved or none of them; a page built in code
 * through its own save, one page per step. A translation is shown, not
 * edited: bulk edit and its save work in the site's default language.
 *
 * @module admin/pages-edit
 */
import {
  BULK_SAVE_LIMIT,
  type BulkChange,
  type BulkRow,
} from "../bulk/contract";
import type {
  CodePageSeo,
  CodePageSeoInput,
  SiteAddress,
} from "../code-pages/contract";
import type { Problem } from "../problems/contract";
import { characters, DESCRIPTION_LIMIT, TITLE_LIMIT } from "../tab/problems";

import { entryTypeKey, sourceText } from "./pages-view";

/** A box of a row: the page's title or its description. */
export type EditField = "title" | "description";

/**
 * Each content type's rows as bulk edit read them, by the type's key; an
 * error's words where the read was refused, and nothing while it is read.
 */
export type TypeRows = ReadonlyMap<string, readonly BulkRow[] | Error>;

/** What holds a row's SEO, and so how it is saved, or why it isn't here. */
export type EditTarget =
  | { kind: "entry"; type: string; row: BulkRow }
  | { kind: "code"; seo: CodePageSeo }
  | { kind: "read-only"; reason: string }
  | { kind: "reading" };

/** One page as Edit mode lists it. */
export interface EditRow {
  /** The page's address, which its edits are kept under. */
  path: string;
  name: string;
  target: EditTarget;
  /** What the page holds as typed for it, empty where nothing is. */
  title: string;
  description: string;
  /** What fills each box's place with nothing typed, as its grey text. */
  autoTitle?: string;
  autoDescription?: string;
  /** Where the automatic value comes from, as the line under an empty box says it. */
  autoTitleFrom: string;
  autoDescriptionFrom: string;
}

/**
 * What a person typed, by address and box, with the version the page was
 * read at when its first edit began: a save sends that version, so a page
 * saved by someone else since, and read again here, is refused rather than
 * overwritten.
 */
export type PageEdits = Readonly<
  Record<string, Partial<Record<EditField, string>> & { rev?: string }>
>;

/**
 * Where an automatic value comes from: as the list says the served value
 * does, unless the page's own typed value is what is served, which says
 * nothing of what is beneath it.
 */
function automaticFrom(
  level: SiteAddress["sources"]["title"],
  pattern: string | undefined
): string {
  return level === "page" ? "Automatic value" : sourceText(level, pattern);
}

/** What holds the SEO of `item`, from the rows read for its type. */
function targetOf(item: SiteAddress, rows: TypeRows): EditTarget {
  const { entry, seo } = item;
  if (entry === undefined) {
    return seo === undefined
      ? { kind: "read-only", reason: "This page's SEO is set in its code." }
      : { kind: "code", seo };
  }
  if (entry.locale !== undefined) {
    return {
      kind: "read-only",
      reason: "A translation is edited on the page, in its language.",
    };
  }
  const type = entryTypeKey(entry);
  const read = rows.get(type);
  if (read === undefined) return { kind: "reading" };
  if (read instanceof Error) return { kind: "read-only", reason: read.message };
  // A row the read did not answer, or one bulk edit says the person may not
  // change (its type keeps drafts, or its rules refuse them), is shown only.
  const row = read.find(each => each.id === entry.id);
  return row?.editable === true
    ? { kind: "entry", type, row }
    : {
        kind: "read-only",
        reason:
          "You can't change this page's SEO here. Open the page to change it.",
      };
}

/** `value` under `key`, or nothing where it is undefined. */
function given<K extends string>(
  key: K,
  value: string | undefined
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

/** Each listed page as Edit mode shows it. */
export function editRowsOf(
  items: readonly SiteAddress[],
  rows: TypeRows
): EditRow[] {
  return items.map(item => {
    const target = targetOf(item, rows);
    const from = {
      autoTitleFrom: automaticFrom(item.sources.title, item.titlePattern),
      autoDescriptionFrom: automaticFrom(item.sources.description, undefined),
    };
    const base = { path: item.path, name: item.name, target, ...from };
    switch (target.kind) {
      case "entry":
        return {
          ...base,
          title: target.row.title,
          description: target.row.description,
          ...given("autoTitle", target.row.autoTitle),
          ...given("autoDescription", target.row.autoDescription),
        };
      case "code":
        return {
          ...base,
          title: target.seo.typed.title ?? "",
          description: target.seo.typed.description ?? "",
          ...given("autoTitle", target.seo.automatic.title?.value),
          ...given("autoDescription", target.seo.automatic.description?.value),
        };
      case "read-only":
      case "reading":
        // Shown as served: what the page has, typed or not.
        return {
          ...base,
          title: "",
          description: "",
          ...given("autoTitle", item.title),
          ...given("autoDescription", item.description),
        };
    }
  });
}

/** Whether a row can be typed in. */
export function editable(row: EditRow): boolean {
  return row.target.kind === "entry" || row.target.kind === "code";
}

/** A box's text: what was typed in it here, else what the page holds. */
export function boxValue(
  row: EditRow,
  field: EditField,
  edits: PageEdits
): string {
  return edits[row.path]?.[field] ?? row[field];
}

/** Whether a box holds an edit that differs from what the page holds. */
export function boxChanged(
  row: EditRow,
  field: EditField,
  edits: PageEdits
): boolean {
  const edit = edits[row.path]?.[field];
  return editable(row) && edit !== undefined && edit !== row[field];
}

/** Whether any box of a row holds a change. */
export function rowChanged(row: EditRow, edits: PageEdits): boolean {
  return (
    boxChanged(row, "title", edits) || boxChanged(row, "description", edits)
  );
}

/** The problem kinds that say a value is shared with another page. */
const SHARED_KIND: Readonly<Record<EditField, Problem["kind"]>> = {
  title: "sharedTitle",
  description: "sharedDescription",
};

/**
 * What the line under a box says: where an empty box's value comes from;
 * else its length and whether search shows it whole, or that another page
 * has the same as the problem list found it, and whether it was changed.
 */
export function boxLine(
  row: EditRow,
  field: EditField,
  edits: PageEdits,
  problems: readonly Problem[]
): { text: string; tone: "muted" | "warning" } {
  if (row.target.kind === "read-only") {
    return { text: row.target.reason, tone: "muted" };
  }
  const value = boxValue(row, field, edits);
  if (value === "") {
    return {
      text: field === "title" ? row.autoTitleFrom : row.autoDescriptionFrom,
      tone: "muted",
    };
  }
  const changed = boxChanged(row, field, edits);
  if (
    !changed &&
    problems.some(problem => problem.kind === SHARED_KIND[field])
  ) {
    return { text: "Same as another page · give it its own", tone: "warning" };
  }
  // Counted as the SEO tab and the problem list count it, in characters.
  const length = characters(value);
  const over = length > (field === "title" ? TITLE_LIMIT : DESCRIPTION_LIMIT);
  return {
    text: `${length} characters · ${over ? "Longer than search shows" : "Good"}${changed ? " · changed" : ""}`,
    tone: over ? "warning" : "muted",
  };
}

/**
 * `edits` with `value` typed into `row`'s `field`: the version the page was
 * read at kept from the first edit, and the page let go of, version and
 * all, once nothing typed differs from what it holds.
 */
export function withEdit(
  edits: PageEdits,
  row: EditRow,
  field: EditField,
  value: string
): PageEdits {
  const held = edits[row.path];
  const rev =
    held?.rev ?? (row.target.kind === "entry" ? row.target.row.rev : undefined);
  const next = { ...held, [field]: value };
  // A box typed back to what its page holds is no change.
  if (value === row[field]) delete next[field];
  const { [row.path]: _dropped, ...others } = edits;
  if (next.title === undefined && next.description === undefined) return others;
  return {
    ...others,
    [row.path]: { ...next, ...(rev === undefined ? {} : { rev }) },
  };
}

/** One step of a save: a content type's pages, or one page built in code. */
export type SaveStep =
  | { kind: "entries"; type: string; paths: string[]; changes: BulkChange[] }
  | { kind: "code"; paths: [string]; input: CodePageSeoInput };

/**
 * The steps a save of `edits` takes: the changed pages of each content type
 * together, as many to a step as one save takes, each with the version its
 * page was read at; each changed page built in code alone, its visibility
 * and share image sent as they are.
 */
export function saveSteps(
  rows: readonly EditRow[],
  edits: PageEdits
): SaveStep[] {
  const byType = new Map<string, { paths: string[]; changes: BulkChange[] }>();
  const code: SaveStep[] = [];
  for (const row of rows) {
    if (!rowChanged(row, edits)) continue;
    const { target } = row;
    if (target.kind === "code") {
      code.push(codeStep(row, target.seo, edits));
    } else if (target.kind === "entry") {
      const step = byType.get(target.type) ?? { paths: [], changes: [] };
      step.paths.push(row.path);
      step.changes.push(entryChange(row, target.row, edits));
      byType.set(target.type, step);
    }
  }
  return [...entrySteps(byType), ...code];
}

/** The save of one page built in code, its visibility sent as it is. */
function codeStep(row: EditRow, seo: CodePageSeo, edits: PageEdits): SaveStep {
  return {
    kind: "code",
    paths: [row.path],
    input: {
      path: row.path,
      title: boxValue(row, "title", edits),
      description: boxValue(row, "description", edits),
      hidden: seo.typed.hidden,
    },
  };
}

/** One entry's change: each box changed, and the version it was read at. */
function entryChange(
  row: EditRow,
  read: BulkRow,
  edits: PageEdits
): BulkChange {
  const change: BulkChange = { id: read.id };
  const rev = edits[row.path]?.rev ?? read.rev;
  if (rev !== undefined) change.rev = rev;
  if (boxChanged(row, "title", edits)) {
    change.title = boxValue(row, "title", edits);
  }
  if (boxChanged(row, "description", edits)) {
    change.description = boxValue(row, "description", edits);
  }
  return change;
}

/** Each type's changes, as many to a step as one save takes. */
function entrySteps(
  byType: ReadonlyMap<string, { paths: string[]; changes: BulkChange[] }>
): SaveStep[] {
  const steps: SaveStep[] = [];
  for (const [type, step] of byType) {
    for (let at = 0; at < step.changes.length; at += BULK_SAVE_LIMIT) {
      steps.push({
        kind: "entries",
        type,
        paths: step.paths.slice(at, at + BULK_SAVE_LIMIT),
        changes: step.changes.slice(at, at + BULK_SAVE_LIMIT),
      });
    }
  }
  return steps;
}

/** How each step of a save went. */
export type StepResult =
  | { step: SaveStep; saved: true }
  | { step: SaveStep; saved: false; message: string };

/** What a save says once every step has run. */
export interface SaveOutcome {
  /** The addresses saved. */
  saved: string[];
  /** The pages not saved, each step's with why. */
  failed: { names: string[]; message: string }[];
}

/** What every step of a save came to, the pages named as the list names them. */
export function saveOutcome(
  results: readonly StepResult[],
  rows: readonly EditRow[]
): SaveOutcome {
  const names = new Map(rows.map(row => [row.path, row.name]));
  const outcome: SaveOutcome = { saved: [], failed: [] };
  for (const result of results) {
    if (result.saved) {
      outcome.saved.push(...result.step.paths);
    } else {
      outcome.failed.push({
        names: result.step.paths.map(path => names.get(path) ?? path),
        message: result.message,
      });
    }
  }
  return outcome;
}

/** `count` pages, as a sentence says it. */
export function pagesText(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

/**
 * The edits left once `saved` were saved from `sent`, the edits as the save
 * took them: every other page's, so what was not saved stays to be saved
 * again, and a saved page's where it was typed on after the save began.
 */
export function editsAfter(
  edits: PageEdits,
  saved: readonly string[],
  sent: PageEdits
): PageEdits {
  const done = new Set(saved);
  // A page typed on while its save ran keeps what was typed since.
  return Object.fromEntries(
    Object.entries(edits).filter(
      ([path, now]) =>
        !done.has(path) ||
        now.title !== sent[path]?.title ||
        now.description !== sent[path]?.description
    )
  );
}

/** `edits` without those of the pages at `paths`. */
export function withoutEdits(
  edits: PageEdits,
  paths: readonly string[]
): PageEdits {
  const dropped = new Set(paths);
  return Object.fromEntries(
    Object.entries(edits).filter(([path]) => !dropped.has(path))
  );
}

/**
 * The content types whose rows Edit mode reads for `items`: each type of a
 * page shown with an entry in the site's language, in the order first shown.
 */
export function typesToRead(items: readonly SiteAddress[]): string[] {
  const types = new Set<string>();
  for (const { entry } of items) {
    if (entry !== undefined && entry.locale === undefined) {
      types.add(entryTypeKey(entry));
    }
  }
  return [...types];
}
