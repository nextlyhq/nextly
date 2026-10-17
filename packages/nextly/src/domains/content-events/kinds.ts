/**
 * The kinds of content event, registered by the core features that write
 * them.
 *
 * A kind declares its name, how history labels it ("Published by release
 * {release}"), and the fields its payload carries. The history code reads only
 * this, so a feature adds a kind without the history code changing. Plugins do
 * not register kinds: writing one needs a writer that joins the plugin's own
 * transaction, which belongs with the plugin SDK.
 *
 * @module domains/content-events/kinds
 * @experimental
 */

import type { ZodType } from "zod";

import { NextlyError } from "../../errors";

/**
 * A registered kind.
 *
 * @experimental
 */
export interface ContentEventKind {
  /** Its name in the record: kebab-case, unique, at most 64 characters. */
  name: string;
  /**
   * How history labels an event of this kind. `{field}` is replaced by that
   * payload field, and `{actor}` by who acted (the name recorded with it).
   */
  label: string;
  /** The payload's shape. An event of a kind without one carries none. */
  payload?: ZodType<Record<string, unknown>>;
  /**
   * Whether an event of this kind records its subject's deletion. A deleted
   * subject's events are kept for the activity log's window from it, then
   * removed with it.
   */
  endsSubject?: boolean;
}

const KIND_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_KIND_LENGTH = 64;

const kinds = new Map<string, ContentEventKind>();

/**
 * Register a kind. Called once per kind as its feature loads.
 *
 * Refuses a name that is not kebab-case or is too long for its column, and a
 * name already taken by a different kind: two features writing one name
 * differently would make history read either. Registering the same kind again
 * (same name, label and ending flag) is accepted and takes its payload schema
 * from the new registration: a module reloaded in development builds a new,
 * equivalent schema object.
 *
 * @experimental
 */
export function registerContentEventKind(kind: ContentEventKind): void {
  if (!KIND_NAME.test(kind.name) || kind.name.length > MAX_KIND_LENGTH) {
    throw NextlyError.invalidInput({
      message: `Content event kind "${kind.name}" must be kebab-case and at most ${MAX_KIND_LENGTH} characters, such as "published".`,
      logContext: { name: kind.name },
    });
  }
  const existing = kinds.get(kind.name);
  if (
    existing &&
    existing.label === kind.label &&
    Boolean(existing.endsSubject) === Boolean(kind.endsSubject)
  ) {
    kinds.set(kind.name, kind);
    return;
  }
  if (existing) {
    throw NextlyError.invalidInput({
      message: `A content event kind is already registered as "${kind.name}"; choose another name.`,
      logContext: { name: kind.name },
    });
  }
  kinds.set(kind.name, kind);
}

/** The registered kind of this name, or undefined. */
export function contentEventKind(name: string): ContentEventKind | undefined {
  return kinds.get(name);
}

/** Every registered kind's name. */
export function contentEventKindNames(): string[] {
  return [...kinds.keys()];
}

/** Forget every registered kind. Test seam. */
export function resetContentEventKinds(): void {
  kinds.clear();
}

/** What a label is filled from. */
export interface LabelSource {
  kind: string;
  actorName: string | null;
  payload: Record<string, unknown> | null;
}

/**
 * An event's label, from its kind's template. A placeholder with no plain
 * value (a payload field the event lacks, or an actor with no recorded name)
 * is left as written, so a gap shows rather than reading as something it is not.
 * An event whose kind is no longer registered reads as its kind's name.
 */
export function renderContentEvent(event: LabelSource): string {
  const kind = kinds.get(event.kind);
  if (!kind) return event.kind;
  return kind.label.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, field: string) => {
    const value: unknown =
      field === "actor" ? event.actorName : event.payload?.[field];
    // Only a plain value fills a placeholder; a list or object stays out of
    // a one-line label.
    return typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
      ? String(value)
      : whole;
  });
}
