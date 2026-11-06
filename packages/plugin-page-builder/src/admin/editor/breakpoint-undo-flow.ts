/**
 * Every sentence Settings shows while undoing a breakpoint removal: the row
 * that offers it, its confirmation, its progress, and its outcome, with each
 * document it could not put every value back into and why.
 *
 * Pure, so each sentence is tested apart from React; the steps
 * (`breakpoint-undo-step`) only draw them.
 *
 * @module admin/editor/breakpoint-undo-flow
 * @experimental
 */
import type {
  SiteBreakpointRemovalStatus,
  SiteBreakpointUndoSkipped,
  SiteBreakpointUndoable,
} from "../../library-contract";

import { count, joinNames, type StatusWords } from "./breakpoint-removal-flow";

/** "1 value" or "3 values". */
function values(n: number): string {
  return `${n} ${n === 1 ? "value" : "values"}`;
}

/** "1 value was" or "3 values were". */
function valuesWere(n: number): string {
  return `${values(n)} ${n === 1 ? "was" : "were"}`;
}

/** A day as the person reads it, in their own time zone: 6 December. */
function dayOf(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
}

/** The line a finished removal's row adds while it can still be undone. */
export function undoableHint(
  undoable: Pick<SiteBreakpointUndoable, "until">
): string {
  return `You can undo this until ${dayOf(undoable.until)}.`;
}

/**
 * The row a removal Settings finds still undoable shows when nothing else is
 * said of it: when it was made, and until when it can be undone.
 */
export function undoableWords(undoable: SiteBreakpointUndoable): StatusWords {
  const names = joinNames(undoable.labels);
  const one = undoable.labels.length === 1;
  return {
    title: `${names} ${one ? "was" : "were"} removed on ${dayOf(undoable.removedAt)}`,
    hint: undoableHint(undoable),
  };
}

/** What the confirmation of an undo says, and its button. */
export interface UndoConfirmWords {
  readonly title: string;
  readonly body: string;
  readonly hint: string;
  readonly confirm: string;
}

/** The confirmation an undo asks for before anything changes. */
export function undoConfirmWords(labels: readonly string[]): UndoConfirmWords {
  const names = joinNames(labels);
  const one = labels.length === 1;
  return {
    title: `Put ${names} back?`,
    body: `${names} ${one ? "is" : "are"} added back to the site's breakpoints as ${one ? "it was" : "they were"}, and the styles the removal took out go back on every page, component, pattern and shared style. Anything set for ${names} since the removal stays as it is.`,
    hint: "Only the newest removal can be undone, and only once.",
    confirm: `Put ${names} back`,
  };
}

/** What an undo says while its walk puts values back. */
export function undoingWords(labels: readonly string[]): {
  readonly title: string;
  readonly body: string;
  readonly hint: string;
} {
  const names = joinNames(labels);
  const one = labels.length === 1;
  return {
    title: `Putting ${names}'s styles back`,
    body: `${names} ${one ? "is" : "are"} back in the site's breakpoints. ${one ? "Its" : "Their"} styles are being put back on each page, component and pattern.`,
    hint: "On a large site this takes a few minutes. You can close Settings; it carries on in the background.",
  };
}

/** The row Settings shows for an undo it finds still going. */
export function undoResumedWords(labels: readonly string[]): StatusWords {
  return {
    title: `${joinNames(labels)}'s styles are still being put back`,
    hint: "Breakpoints can be changed again once it has finished.",
  };
}

/** One document an undo could not put every value back into, as listed. */
export interface SkippedLine {
  /** What the document is called; plain words where it has no name. */
  readonly name: string;
  /** Where it opens, for one that still exists and has a name. */
  readonly href?: string;
  /** Why its values stayed out, the count first. */
  readonly why: string;
}

/** What a document is, by where it is stored, for a sentence about it. */
function documentWord(entry: SiteBreakpointUndoSkipped): string {
  if (entry.kind === "single") return "page";
  const words: Readonly<Record<string, string>> = {
    pages: "page",
    components: "component",
    patterns: "pattern",
    layouts: "Layout",
  };
  return words[entry.slug] ?? "entry";
}

/** Why a document's values stayed out, the count first. */
function whyOf(entry: SiteBreakpointUndoSkipped, names: string): string {
  const n = entry.values;
  const sharedStyle = entry.sharedStyles === true;
  switch (entry.reason) {
    case "changed":
      return `${values(n)} set again for ${names} after the removal`;
    case "block-deleted":
      return `${valuesWere(n)} on ${sharedStyle ? "a shared style" : "a block"} deleted after the removal`;
    case "gone":
      return `${valuesWere(n)} on this ${documentWord(entry)}, deleted after the removal`;
    case "draft-gone":
      return `${valuesWere(n)} in a draft published or discarded after the removal`;
    case "unreadable":
      return `${values(n)} couldn't be checked: it can't be read`;
  }
}

/** Where a document opens in the admin. */
function hrefOf(entry: SiteBreakpointUndoSkipped): string | undefined {
  if (entry.kind === "single") {
    return entry.sharedStyles === true
      ? undefined
      : `/admin/singles/${encodeURIComponent(entry.slug)}`;
  }
  return entry.id === undefined
    ? undefined
    : `/admin/collections/${encodeURIComponent(entry.slug)}/${encodeURIComponent(entry.id)}`;
}

/**
 * One listed document: linked by its name while it exists and the person may
 * open it; a deleted one, or one they may not read, in plain words.
 */
export function skippedLine(
  entry: SiteBreakpointUndoSkipped,
  labels: readonly string[]
): SkippedLine {
  const names = joinNames(labels);
  const why = whyOf(entry, names);
  // Marked by the server, which knows the slug the shared styles' Single is
  // registered under; the slug alone is never taken for it.
  if (entry.sharedStyles === true) {
    return { name: "Shared styles", why };
  }
  const word = documentWord(entry);
  if (entry.reason === "gone") return { name: `A deleted ${word}`, why };
  if (entry.name === undefined)
    return { name: `A ${word} you can't open`, why };
  const href = hrefOf(entry);
  return { name: entry.name, ...(href === undefined ? {} : { href }), why };
}

/** What a finished undo says: back, or back except what changed since. */
export function undoneWords(
  labels: readonly string[],
  skipped: readonly SiteBreakpointUndoSkipped[] | undefined
): StatusWords & { readonly lines: readonly SkippedLine[] } {
  const names = joinNames(labels);
  const one = labels.length === 1;
  const total = (skipped ?? []).reduce((sum, entry) => sum + entry.values, 0);
  if (total === 0) {
    return {
      title: `${names} ${one ? "is" : "are"} back, with ${one ? "its" : "their"} styles`,
      hint: "Everything the removal took out was put back.",
      lines: [],
    };
  }
  return {
    title: `${names} ${one ? "is" : "are"} back, except ${values(total)} that changed after the removal`,
    hint: "These kept what was set after the removal, so nothing anyone did since was overwritten:",
    lines: (skipped ?? []).map(entry => skippedLine(entry, labels)),
  };
}

/**
 * What a finished undo says while it holds pages it can't write yet: back,
 * except there, and what puts their styles back. Never "all back" while the
 * site still owes them.
 */
export function undoLeftWords(
  status: Pick<
    SiteBreakpointRemovalStatus,
    "labels" | "left" | "waitingOnDrafts"
  >
): StatusWords {
  const names = joinNames(status.labels);
  const one = status.labels.length === 1;
  const is = one ? "is" : "are";
  // Drafts wait on pages, components, patterns and Layouts alike, so the
  // row speaks of live versions, as the removal's own row does.
  if (status.waitingOnDrafts) {
    return {
      title: `${names} ${is} back, except on ${count(status.left, "live version", "live versions")}`,
      hint: `${status.left === 1 ? "It has a draft" : "Each has a draft"} waiting to be published, and gets ${names}'s styles back once that draft is published or discarded.`,
    };
  }
  return {
    title: `${names} ${is} back, except on ${count(status.left, "entry it couldn't change yet", "entries it couldn't change yet")}`,
    hint: `${status.left === 1 ? "It gets" : "They get"} ${names}'s styles back once ${status.left === 1 ? "it" : "they"} can be changed.`,
  };
}

/** What a refused undo says: the server's reason, and that nothing changed. */
export function undoRefusedWords(
  labels: readonly string[],
  reason: string
): { readonly title: string; readonly body: string } {
  return {
    title: `${joinNames(labels)} can't be put back`,
    body: `${reason} Nothing was changed.`,
  };
}
