/**
 * The words the history list says: who did something, to which parts, which
 * fields changed, and what retention keeps.
 *
 * Pure, so the phrasing is tested once and every row says it the same way.
 *
 * @module components/features/versions/history-story-text
 */

import type {
  DocumentEvent,
  HistoryActorKind,
  VersionMeta,
} from "@admin/services/versionApi";

import { REMOVAL_EVENT, SHARED_PART } from "./history-story";
import { versionAuthorLabel } from "./version-author";

/** A field as a comparison reports it, as much as its label needs. */
interface ReportedField {
  name: string;
  label?: string;
  kind?: string;
  reason?: string;
}

/**
 * Whether a reported field is one an editor writes. A column the system keeps
 * on every document (when it was first published, say) comes back as an
 * unknown field with the reason `system`, and is nothing an editor changed.
 */
function isAuthoredField(field: ReportedField): boolean {
  return !(field.kind === "unknown" && field.reason === "system");
}

/**
 * The labels of the fields an editor changed, in the order the comparison
 * gives them: the system's own columns left out.
 */
export function fieldLabels(fields: readonly ReportedField[]): string[] {
  return fields.filter(isAuthoredField).map(field => field.label || field.name);
}

/** How many field names a summary lists before counting the rest. */
const NAMED_FIELDS = 2;

/** Who or what made something, and its kind when one was recorded. */
export interface StoryActor {
  kind: HistoryActorKind | null;
  name: string;
}

/** A version's author, as the list names it. */
export function versionActor(
  version: Pick<VersionMeta, "author" | "createdBy">
): StoryActor {
  return {
    kind: version.author?.kind ?? null,
    name: versionAuthorLabel(version),
  };
}

/** An event's actor, as the list names it. */
export function eventActor(event: DocumentEvent): StoryActor {
  if (event.actorName) return { kind: event.actorKind, name: event.actorName };
  return {
    kind: event.actorKind,
    name: event.actorKind === "system" ? "System" : "Not recorded",
  };
}

/**
 * The parts something applied to, in words: "English, Spanish and shared
 * fields". `languageName` names a language code.
 */
export function partsText(
  parts: readonly string[],
  languageName: (code: string) => string
): string {
  const names = [
    ...parts.filter(p => p !== SHARED_PART).map(languageName),
    ...(parts.includes(SHARED_PART) ? ["shared fields"] : []),
  ];
  if (names.length === 0) return "";
  const text =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The fields a change touched: "Title", "Title and Body", "Title, Body and
 * Slug", and past three "Title, Body and 2 more".
 */
export function changeSummary(labels: readonly string[]): string {
  if (labels.length === 0) return "No fields changed";
  if (labels.length <= NAMED_FIELDS + 1) {
    return labels.length === 1
      ? labels[0]
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  }
  const rest = labels.length - NAMED_FIELDS;
  return `${labels.slice(0, NAMED_FIELDS).join(", ")} and ${rest} more`;
}

/**
 * The parts something applied to, in words, or nothing where the document has
 * no languages to tell apart.
 */
export type PartsLabel = (parts: readonly string[]) => string;

/**
 * A takeover, from the editor it displaced: "Took over from Ana". The server
 * names that editor when history is read, by name only; one it cannot name
 * (no name, or no account any more) is said to be unavailable, as an author
 * who cannot be named is, rather than guessed or left blank.
 */
function takeoverSentence(event: DocumentEvent): string {
  const from = event.payload?.fromName;
  return typeof from === "string" && from !== ""
    ? `Took over from ${from}`
    : "Took over (previous editor unavailable)";
}

/** Who or what made the changes an overwrite replaced, as words, when not a person. */
const REPLACED_KIND_WORDS: Readonly<Record<string, string>> = {
  principal: "a member",
  apiKey: "an API key",
  release: "a scheduled release",
  system: "the system",
  plugin: "a plugin",
  agent: "an agent",
};

/**
 * An overwrite, from what it replaced: "Overwrote changes by Ben". The server
 * names a person when history is read, by name only; one it cannot name, or a
 * change whose maker was never recorded, is said to be unavailable, as a
 * takeover's previous editor is. A plugin's signed-in person is a member, by
 * kind alone. An overwrite that gave no version, or the current one, replaced
 * nobody it can name, and says only that it was an overwrite.
 */
function overwriteSentence(event: DocumentEvent): string {
  const payload = event.payload ?? {};
  if (payload.given === "stale") {
    const by = replacedBy(payload);
    return by
      ? `Overwrote changes by ${by}`
      : "Overwrote changes (previous editor unavailable)";
  }
  return payload.given === "none"
    ? "Saved as an overwrite (no version given)"
    : "Saved as an overwrite";
}

/**
 * Who made the changes a stale overwrite replaced, in words: a person by the
 * name the server gave, anything else by its kind. Null when there is nobody
 * to name.
 */
function replacedBy(payload: Record<string, unknown>): string | null {
  const replaced = payload.replaced as { kind?: unknown } | null | undefined;
  const kind = typeof replaced?.kind === "string" ? replaced.kind : null;
  if (kind !== "person") return (kind && REPLACED_KIND_WORDS[kind]) || null;
  const name = payload.replacedName;
  return typeof name === "string" && name !== "" ? name : null;
}

/**
 * A field rewrite, from what it changed: "Rewrote layout on the live copy and
 * its draft". A rewrite a plugin made for a person names the plugin after
 * them ("via page-builder"); one it made on its own behalf is already the
 * plugin's row. The reason is shown as the row's note.
 */
function rewriteSentence(event: DocumentEvent): string {
  const payload = event.payload ?? {};
  const field =
    typeof payload.field === "string" && payload.field !== ""
      ? payload.field
      : "a field";
  const copies = Array.isArray(payload.copies)
    ? payload.copies.filter((copy): copy is string => typeof copy === "string")
    : [];
  const drafts = copies.filter(copy => copy.startsWith("draft")).length;
  const draftWords = drafts === 1 ? "its draft" : `${drafts} drafts`;
  // A rewrite that left the live copy as it was says so: it changed nothing
  // a visitor sees.
  const where = !copies.includes("live")
    ? `in ${draftWords} only`
    : drafts === 0
      ? "on the live copy"
      : `on the live copy and ${draftWords}`;
  const via =
    typeof payload.plugin === "string" && payload.plugin !== ""
      ? ` via ${payload.plugin}`
      : "";
  return `Rewrote ${field} ${where}${via}`;
}

/** What an event that is a row of its own says happened. */
export function eventSentence(
  event: DocumentEvent,
  partsLabel: PartsLabel
): string {
  const parts = partsLabel(event.parts);
  const to = parts ? ` ${parts}` : "";
  switch (event.kind) {
    case "published":
      return `Published${to}`;
    case "unpublished":
      return `Unpublished${to}`;
    case "draft-discarded":
      return `Discarded the draft${parts ? ` of ${parts}` : ""}`;
    case "taken-over":
      return takeoverSentence(event);
    case "overwritten":
      return overwriteSentence(event);
    case "field-rewritten":
      return rewriteSentence(event);
    default: {
      // A kind a plugin registered: its name, read as words, then what it
      // applied to, set apart since the name is not a verb we can phrase.
      const words = event.kind.replace(/-/g, " ");
      const name = words.charAt(0).toUpperCase() + words.slice(1);
      return parts ? `${name} · ${parts}` : name;
    }
  }
}

/** How many versions a removal took, from its event. */
export function removedCount(event: DocumentEvent): number | null {
  if (event.kind !== REMOVAL_EVENT) return null;
  const count = event.payload?.count;
  return typeof count === "number" ? count : null;
}

/** The one line that says what retention keeps. */
export function retentionLine(maxPerDoc: number | false): string {
  if (maxPerDoc === false) return "Every version is kept.";
  return `The newest ${maxPerDoc} versions are kept, with each language's latest published version, named versions and restores.`;
}

/**
 * A day heading: "Today", "Yesterday", or the weekday and date, with the year
 * only when it is not this one.
 */
export function dayHeading(day: string, now: Date = new Date()): string {
  const [year, month, date] = day.split("-").map(Number);
  const that = new Date(year, month - 1, date);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return that.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(that.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** The time of day something happened, as a row leads with it. */
export function timeOfDay(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
