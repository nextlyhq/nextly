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

import { SHARED_PART_ALONE, type ChangedParts } from "./changed-parts";
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
 *
 * `translated: false` classifies a document whose own fields are stored on
 * its shared row alone (it keeps no translations of its own): only its
 * components, kept per language whatever their parent, are a language's.
 */
export async function partKeysOf(
  fields: readonly PartField[],
  options: { translated?: boolean } = {}
): Promise<PartKeys> {
  const reached: readonly unknown[] = addressableFields(fields);
  const named = reached.filter(isNamedPartField);
  const language = await perLanguageFieldNames(
    named,
    new Set(
      options.translated === false
        ? []
        : resolveLocalizedFieldNames(named, true)
    ),
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
 * The parts a language's promote carries: its own draft, and the shared draft
 * only when the promote publishes. An unpublish puts nothing live, so the
 * shared changes stay pending for every language still published.
 */
export function partsPromoted(
  parts: PartDrafts,
  publishes: boolean
): PartDrafts {
  return publishes ? parts : { language: parts.language };
}

/** Whether a save that set the keys `touched` changed `part`'s. */
function touchesPart(
  touched: ReadonlySet<string>,
  part: ReadonlySet<string>
): boolean {
  return [...touched].some(key => part.has(key));
}

/**
 * The parts a write in `locale` that set the keys `touched` changed, as its
 * version records them: the language where the write set one of the
 * language's keys (a translated value or a component) or, `statusWritten`,
 * the language's own status, so a publish by status alone still names its
 * language; and the shared part where it set a shared key. A write that set
 * only shared values names no language, though the language's values are in
 * the snapshot it records.
 *
 * A write under no language is a write of a document kept as one part, which
 * is its shared part.
 */
export function partsWritten(write: {
  locale: string | null;
  touched: ReadonlySet<string>;
  keys: PartKeys;
  statusWritten?: boolean;
}): ChangedParts {
  if (write.locale === null) return SHARED_PART_ALONE;
  const language =
    write.statusWritten === true ||
    touchesPart(write.touched, write.keys.language);
  return {
    locales: language ? [write.locale] : [],
    shared: touchesPart(write.touched, write.keys.shared),
  };
}

/**
 * The parts a working draft kept under `slot` holds, which its row records.
 * The shared draft holds the shared part. Kept by part, a language's draft
 * holds that language alone; otherwise it holds the whole document in that
 * language, its shared values included.
 */
export function draftSlotParts(slot: string | null): ChangedParts {
  if (slot === SHARED_DRAFT_SLOT) return SHARED_PART_ALONE;
  return { locales: [slot], shared: !draftsKeptByPart() };
}

/**
 * The translated keys a held save names to its history when it changed the
 * shared part, else `null`. The shared draft it changed goes live with any
 * language's publish, so every language's review is judged on the shared
 * values the save holds, as an in-place save's is.
 */
export function translatedWhenSharedChanged(
  touched: ReadonlySet<string>,
  keys: PartKeys
): string[] | null {
  return touchesPart(touched, keys.shared) ? [...keys.language] : null;
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
    touchesPart(input.touched, part);
  // Each row records the part it holds (`draftSlotParts`).
  if (input.existing.shared || touches(input.keys.shared)) {
    await repo.upsertWorkingDraft({
      ref: input.ref,
      locale: SHARED_DRAFT_SLOT,
      snapshot: pick(input.document, input.keys.shared),
      createdBy: input.createdBy,
      parts: draftSlotParts(SHARED_DRAFT_SLOT),
    });
  }
  if (input.existing.language || touches(input.keys.language)) {
    await repo.upsertWorkingDraft({
      ref: input.ref,
      locale: input.locale,
      snapshot: pick(input.document, input.keys.language),
      createdBy: input.createdBy,
      parts: draftSlotParts(input.locale),
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
