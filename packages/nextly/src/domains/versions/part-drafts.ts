/**
 * A document's pending changes, kept by part, under per-language storage.
 *
 * A document has a shared part (its shared fields) and one part per language
 * (that language's translatable fields), each with a published state and a
 * draft. The published shared part is the main row and a language's published
 * part is its `_locales` row; the drafts live in `nextly_versions` as working
 * drafts:
 * - the SHARED draft is the one keyed by no language, and holds shared values
 *   only. That it exists is what "shared changes pending" means;
 * - a LANGUAGE's draft is keyed by its code, and holds that language's
 *   translatable values and components only.
 *
 * So an edit to a shared field reaches every language from one draft, and an
 * edit to one language's text reaches no other. Every write, read and promote
 * that holds or shows a pending change keeps the whole-document shape it
 * always had: it reads one document assembled from the live one and both
 * drafts ({@link combinedDraft}), and a write splits the document it built
 * back into the two drafts ({@link storePartDrafts}). Which field belongs to
 * which part is answered here alone ({@link partKeysOf}).
 *
 * Only under per-language storage ({@link draftsKeptByPart}): without it a
 * document keeps one draft per slot holding the whole document, as before.
 *
 * @module domains/versions/part-drafts
 */

import { addressableFields } from "../../shared/addressable-fields";
import { SYSTEM_TEXT_FIELD_NAMES } from "../collections/system-text-fields";
import { resolveLocalizedFieldNames } from "../i18n/classify-fields";
import { perLanguageFieldNames } from "../i18n/per-language-fields";
import { perLanguageStorageEnabled } from "../i18n/per-language-storage";

import type {
  VersionRef,
  VersionRow,
  VersionsRepository,
} from "./versions-repository";

/** The slot of a document's shared draft: no language. */
export const SHARED_DRAFT_SLOT = null;

/**
 * Whether drafts are kept by part. The site's per-language storage choice,
 * not an entity's own `localized`: with it off every path runs as before.
 */
export function draftsKeptByPart(): boolean {
  return perLanguageStorageEnabled();
}

/** Which of a document's top-level keys each part holds. */
export interface PartKeys {
  /** Translatable fields, and every component field. */
  readonly language: ReadonlySet<string>;
  /** Every other declared field. */
  readonly shared: ReadonlySet<string>;
}

/** What {@link partKeysOf} reads of a field. */
interface PartField {
  readonly type: string;
  readonly name?: string;
  readonly localized?: boolean;
  readonly virtual?: boolean;
  readonly options?: unknown;
}

/** Whether a field `addressableFields` reached is one stored under a name. */
function isNamedPartField(
  field: unknown
): field is PartField & { name: string } {
  if (typeof field !== "object" || field === null) return false;
  const { name } = field as { name?: unknown };
  return typeof name === "string" && name.length > 0;
}

/**
 * Which keys of a document with `fields` belong to a language and which are
 * shared. Under per-language storage every entity keeps its translatable
 * values per language, so they are classified as an entity that stores per
 * language; every component is kept per language too, so a component field
 * belongs to the language whatever its own fields are.
 *
 * The parts follow storage: the same classification the companion table is
 * built from (`resolveLocalizedFieldNames`), so a held value is promoted to
 * where it is stored. A named group or repeater is stored whole on the shared
 * row, a component inside it included, so its key is shared.
 *
 * The keys are the fields addressable at the document's top level: an unnamed
 * group stores its children there, so each child is classified as a top-level
 * field is, and none is left out of both drafts.
 */
export async function partKeysOf(
  fields: readonly PartField[]
): Promise<PartKeys> {
  const reached: readonly unknown[] = addressableFields(fields);
  const named = reached.filter(isNamedPartField);
  const language = await perLanguageFieldNames(
    named,
    new Set(resolveLocalizedFieldNames(named, true)),
    () => Promise.resolve(true)
  );
  // The system `title` and `slug` are stored on the shared row and left out
  // of the stored field list; a declared one is classified as declared.
  const declared = new Set(named.map(field => field.name));
  const system = SYSTEM_TEXT_FIELD_NAMES.filter(name => !declared.has(name));
  return {
    language,
    shared: new Set([
      ...named.map(field => field.name).filter(name => !language.has(name)),
      ...system,
    ]),
  };
}

/** A part draft's stored values, as an object. */
function valuesOf(row: VersionRow | undefined): Record<string, unknown> {
  if (!row) return {};
  const snapshot =
    typeof row.snapshot === "string"
      ? (JSON.parse(row.snapshot) as unknown)
      : row.snapshot;
  return typeof snapshot === "object" && snapshot !== null
    ? (snapshot as Record<string, unknown>)
    : {};
}

/** The drafts a document holds for one language: its shared one and that language's. */
export interface PartDrafts {
  readonly shared?: VersionRow;
  readonly language?: VersionRow;
}

/** Whether either part holds a pending change. */
export function holdsPendingChange(parts: PartDrafts): boolean {
  return parts.shared !== undefined || parts.language !== undefined;
}

/**
 * The shared draft and `locale`'s draft of a document, read one after the
 * other on the caller's handle, so a transaction reads both on its connection.
 */
export async function findPartDrafts(
  repo: VersionsRepository,
  ref: VersionRef,
  locale: string | null
): Promise<PartDrafts> {
  const shared = await repo.findWorkingDraft(ref, SHARED_DRAFT_SLOT);
  const language =
    locale === SHARED_DRAFT_SLOT
      ? undefined
      : await repo.findWorkingDraft(ref, locale);
  return { shared, language };
}

/**
 * The document the drafts describe in one language: `base` with the shared
 * draft's values laid over it, then the language draft's. A draft holds only
 * its part's keys, so neither can overwrite the other's.
 *
 * Pass the live document as `base` for a whole document, or `{}` for only
 * what the drafts change: a promote writes no more than that.
 */
export function combinedDraft(
  base: Record<string, unknown>,
  parts: PartDrafts
): Record<string, unknown> {
  return {
    ...base,
    ...valuesOf(parts.shared),
    ...valuesOf(parts.language),
  };
}

/** `document`'s values of the keys in `keys`. */
function pick(
  document: Record<string, unknown>,
  keys: ReadonlySet<string>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(document).filter(([key]) => keys.has(key))
  );
}

/**
 * Store `document`, the whole document after a held save in `locale`, as its
 * two drafts, on the caller's handle: its shared values in the shared draft
 * and its language values in `locale`'s draft.
 *
 * A part's draft is written only once a save has changed that part: when it
 * already holds a draft, or when this save touched one of its keys. So an edit
 * to a translatable field starts no shared draft, and an edit to a shared
 * field starts no language's.
 */
export async function storePartDrafts(
  repo: VersionsRepository,
  input: {
    ref: VersionRef;
    locale: string;
    document: Record<string, unknown>;
    touched: ReadonlySet<string>;
    keys: PartKeys;
    existing: PartDrafts;
    createdBy?: string | null;
  }
): Promise<void> {
  const touches = (part: ReadonlySet<string>) =>
    [...input.touched].some(key => part.has(key));
  if (input.existing.shared || touches(input.keys.shared)) {
    await repo.upsertWorkingDraft({
      ref: input.ref,
      locale: SHARED_DRAFT_SLOT,
      snapshot: pick(input.document, input.keys.shared),
      createdBy: input.createdBy,
    });
  }
  if (input.existing.language || touches(input.keys.language)) {
    await repo.upsertWorkingDraft({
      ref: input.ref,
      locale: input.locale,
      snapshot: pick(input.document, input.keys.language),
      createdBy: input.createdBy,
    });
  }
}

/**
 * The shared fields a pending change is judged on for being out of date, out
 * of the document's `shared` ones. Kept by part, a language's draft holds no
 * shared value but its copy of a translated component's shared parts
 * (`byHand`), so those alone are judged, against the base the draft began
 * from; otherwise the change carries every shared value, and every one is.
 * The one answer every path that publishes a pending change judges with.
 */
export function sharedFieldsJudged(
  shared: readonly string[],
  byHand: ReadonlySet<string>
): string[] {
  return draftsKeptByPart()
    ? shared.filter(name => byHand.has(name))
    : [...shared];
}
