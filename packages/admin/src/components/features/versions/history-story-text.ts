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
