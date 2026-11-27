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

import { isServicesRegistered } from "../../di/service-access";
import { addressableFields } from "../../shared/addressable-fields";
import { SYSTEM_TEXT_FIELD_NAMES } from "../collections/system-text-fields";
import { extractFieldGroupReferences } from "../field-groups/storage/field-group-field-type";
import { resolveLocalizedFieldNames } from "../i18n/classify-fields";
import { perLanguageFieldNames } from "../i18n/per-language-fields";
import { perLanguageStorageEnabled } from "../i18n/per-language-storage";
import {
  assembleSharedStructure,
  componentStructureShape,
  type ComponentFieldsOf,
  overlayOver,
  placesComponent,
  sameShare,
  sameStructure,
  sharedStructureShape,
  splitSharedStructure,
  type SharedStructureShape,
  type StructuredField,
} from "../i18n/shared-structure";

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
  /**
   * The fields both parts hold a share of: a repeater or group keeping one structure across
   * languages, by name, with what it translates inside. Its structure (rows, their ids and order,
   * its shared values) is the shared part's; the text inside, keyed by row id, is each language's.
   * In neither set above.
   */
  readonly structured: ReadonlyMap<string, SharedStructureShape>;
}

/** What {@link partKeysOf} reads of a field: a container's own fields included. */
type PartField = StructuredField;

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
 * A repeater or group of a translated document that translates values inside
 * keeps one structure across languages, and is held by both parts
 * (`structured`): its structure by the shared part, its text by each language.
 * So does a component field: its instances, their order and their shared
 * values are the shared part's, their text each language's by instance id; a
 * component holding no text at all is the shared part's alone. Its fields are
 * read from the components registry (`components`, else the running site's),
 * the same answer every path that stores, reads or publishes a draft gets. A
 * component whose fields cannot be read stays whole in the language part.
 *
 * `translated: false` classifies a document whose own fields are stored on
 * its shared row alone (it keeps no translations of its own): only its
 * components, kept per language whatever their parent, are a language's.
 */
export async function partKeysOf(
  fields: readonly PartField[],
  options: {
    translated?: boolean;
    /** Each component's fields, by slug; the running site's registry when left out. */
    components?: ComponentFieldsOf;
    /**
     * The caller's transaction handle (`tx.getDrizzle()`), for a caller holding one: the registry
     * is read on it, never on a second connection that cannot see its writes.
     */
    executor?: unknown;
  } = {}
): Promise<PartKeys> {
  const reached: readonly unknown[] = addressableFields(fields);
  const named = reached.filter(isNamedPartField);
  const componentFields = named.filter(field => {
    const { single, many } = extractFieldGroupReferences(field);
    return single !== undefined || many !== undefined;
  });
  // The fields that need a component's fields to be read: a component field, and a repeater or
  // group placing one inside its rows.
  const needingComponents = named.filter(
    field => componentFields.includes(field) || placesComponent(field)
  );
  const componentsOf =
    options.translated === false || needingComponents.length === 0
      ? undefined
      : (options.components ??
        (await registryComponents(needingComponents, options.executor)));
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
  // The same shape the storage splits the field's value by, so a held value
  // is split where its live one is stored.
  const structured = new Map<string, SharedStructureShape>();
  // A component whose fields were read and hold no text: the shared part's alone.
  const sharedComponents = new Set<string>();
  if (options.translated !== false) {
    for (const field of named) {
      if (componentsOf && componentFields.includes(field)) {
        if (!componentReadable(field, componentsOf)) continue;
        const shape = componentStructureShape(field, componentsOf);
        if (shape) structured.set(field.name, shape);
        else sharedComponents.add(field.name);
        continue;
      }
      if (language.has(field.name)) continue;
      const shape = sharedStructureShape(field, componentsOf);
      if (shape) structured.set(field.name, shape);
    }
  }
  for (const name of [...structured.keys(), ...sharedComponents]) {
    language.delete(name);
  }
  return {
    language,
    shared: new Set([
      ...named
        .map(field => field.name)
        .filter(name => !language.has(name) && !structured.has(name)),
      ...system,
    ]),
    structured,
  };
}

/**
 * The running site's components, by slug, for the component fields of a document: read from its
 * registry once the site's services are up, every component they place in turn. Nothing before,
 * as in a unit run with no site: each component then stays whole in the language part.
 */
async function registryComponents(
  fields: readonly PartField[],
  executor: unknown
): Promise<ComponentFieldsOf | undefined> {
  if (!isServicesRegistered()) return undefined;
  const { resolveComponentSchemas } = await import("./restore-version");
  const schemas = await resolveComponentSchemas(
    fields as Parameters<typeof resolveComponentSchemas>[0],
    executor
  );
  return slug => {
    const schema = schemas.get(slug);
    return schema?.resolved === false ? undefined : schema?.fields;
  };
}

/** Whether every component `field` places has fields to read. */
function componentReadable(
  field: PartField,
  componentsOf: ComponentFieldsOf
): boolean {
  const { single, many } = extractFieldGroupReferences(field);
  const slugs = many ?? (single === undefined ? [] : [single]);
  return (
    slugs.length > 0 && slugs.every(slug => componentsOf(slug) !== undefined)
  );
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

/** A save's document before and after it, which a held share is judged by. */
export interface SaveValues {
  /** The document the save replaced: its pending change over the live one, or the live one. */
  readonly before: Record<string, unknown>;
  /** The document after the save. */
  readonly after: Record<string, unknown>;
}

/**
 * Which shares of the structured fields a save set it changed: the shared part where a
 * structure changed (a row added, removed or moved, or a shared value inside), the language
 * where the text inside did. Judged on the values, since one key holds both: a save that sets the
 * field in one language sends both shares, and changed only one. Without the values, each field
 * set counts as changing both.
 */
function structuredSharesChanged(
  touched: ReadonlySet<string>,
  keys: PartKeys,
  values: SaveValues | undefined
): { shared: boolean; language: boolean } {
  let shared = false;
  let language = false;
  for (const [name, shape] of keys.structured) {
    if (!touched.has(name)) continue;
    if (!values) return { shared: true, language: true };
    const before = splitSharedStructure(values.before[name], shape);
    const after = splitSharedStructure(values.after[name], shape);
    // A structure coming to be, or going, is a change of the shared part (`sameStructure`).
    shared ||= !sameStructure(before.structure, after.structure);
    language ||= !sameShare(before.overlay ?? {}, after.overlay ?? {});
  }
  return { shared, language };
}

/**
 * The parts a write in `locale` that set the keys `touched` changed, as its
 * version records them: the language where the write set one of the
 * language's keys (a translated value or a component) or, `statusWritten`,
 * the language's own status, so a publish by status alone still names its
 * language; and the shared part where it set a shared key or,
 * `documentStatusWritten`, the document's own status, which every language
 * shows. A write that set only shared values names no language, though the
 * language's values are in the snapshot it records.
 *
 * A structured field the write set changed the shared part where its structure
 * changed and the language where its text did (`values`, the document before
 * and after the write).
 *
 * A write under no language is a write of a document kept as one part, which
 * is its shared part.
 */
export function partsWritten(write: {
  locale: string | null;
  touched: ReadonlySet<string>;
  keys: PartKeys;
  values?: SaveValues;
  statusWritten?: boolean;
  documentStatusWritten?: boolean;
}): ChangedParts {
  if (write.locale === null) return SHARED_PART_ALONE;
  const structured = structuredSharesChanged(
    write.touched,
    write.keys,
    write.values
  );
  const language =
    write.statusWritten === true ||
    structured.language ||
    touchesPart(write.touched, write.keys.language);
  return {
    locales: language ? [write.locale] : [],
    shared:
      write.documentStatusWritten === true ||
      structured.shared ||
      touchesPart(write.touched, write.keys.shared),
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
  keys: PartKeys,
  values?: SaveValues
): string[] | null {
  return touchesPart(touched, keys.shared) ||
    structuredSharesChanged(touched, keys, values).shared
    ? [...keys.language, ...keys.structured.keys()]
    : null;
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
 * `live`, the document in one language, as its editors are shown it: with the
 * pending change it holds in that language laid over it, where it holds one.
 * Asked only where a read shows that change (`resolveDraftOverlay`), in the
 * language slot that rule names; the caller asks it first.
 */
export async function withPendingChange(
  repo: VersionsRepository,
  ref: VersionRef,
  locale: string | null,
  live: Record<string, unknown>,
  fields: readonly PartField[],
  executor?: unknown
): Promise<Record<string, unknown>> {
  if (!draftsKeptByPart() || locale === SHARED_DRAFT_SLOT) {
    const draft = await repo.findWorkingDraft(ref, locale);
    return draft ? { ...live, ...valuesOf(draft) } : live;
  }
  const parts = await findPartDrafts(repo, ref, locale);
  if (!holdsPendingChange(parts)) return live;
  const keys = await partKeysOf(fields, { executor });
  return combinedDraft(live, parts, { keys, live });
}

/** Where {@link combinedDraft} finds what a structured field's drafts leave out. */
export interface StructureSource {
  /** The document's part keys, whose `structured` fields the drafts hold a share of. */
  readonly keys: PartKeys;
  /** The live document in the drafts' language. */
  readonly live: Record<string, unknown>;
}

/**
 * The document the drafts describe in one language: `base` with the shared
 * draft's values laid over it, then the language draft's. A draft holds only
 * its part's keys, so neither can overwrite the other's.
 *
 * A structured field either draft holds is put back together: the shared
 * draft's structure, else the live one, with each row's text from the
 * language draft, else as live (`source`). So a reorder held in the shared
 * draft keeps each language's text on its rows, and a translation held in a
 * language's draft is laid on the live structure, never on a copy of its own.
 *
 * Pass the live document as `base` for a whole document, or `{}` for only
 * what the drafts change: a promote writes no more than that. A reader with
 * no live document to hand passes `{}` as `source.live`: a structured field
 * only a language's draft holds is then left out.
 */
export function combinedDraft(
  base: Record<string, unknown>,
  parts: PartDrafts,
  source: StructureSource
): Record<string, unknown> {
  const shared = valuesOf(parts.shared);
  const language = valuesOf(parts.language);
  const combined: Record<string, unknown> = {
    ...base,
    ...shared,
    ...language,
  };
  for (const [name, shape] of source.keys.structured) {
    const inShared = Object.hasOwn(shared, name);
    const inLanguage = Object.hasOwn(language, name);
    if (!inShared && !inLanguage) continue;
    const live = splitSharedStructure(source.live[name], shape);
    const structure = inShared ? shared[name] : live.structure;
    // A language's text with no structure to lay it on is no value of the
    // field: left out, so a reader shows the field as stored.
    if (structure === undefined) {
      delete combined[name];
      continue;
    }
    // The language's held text over its live text: a text the draft holds,
    // a cleared one included, is the draft's; any other is as live.
    combined[name] = assembleSharedStructure(
      structure,
      [
        inLanguage
          ? overlayOver(language[name], live.overlay, shape)
          : live.overlay,
      ],
      shape
    );
  }
  return combined;
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
 * `document`'s share of its structured fields for one part: each field's
 * structure for the shared part, its text keyed by row id for a language's. A
 * value the field cannot split (none, or cleared) is the structure's alone.
 */
function structuredShares(
  document: Record<string, unknown>,
  keys: PartKeys,
  share: "structure" | "overlay"
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, shape] of keys.structured) {
    if (!Object.hasOwn(document, name)) continue;
    const split = splitSharedStructure(document[name], shape);
    if (share === "structure") out[name] = split.structure;
    else if (split.overlay !== undefined) out[name] = split.overlay;
  }
  return out;
}

/**
 * Store `document`, the whole document after a held save in `locale`, as its
 * two drafts, on the caller's handle: its shared values in the shared draft
 * and its language values in `locale`'s draft. A structured field is split
 * between them: its structure in the shared draft, its text in the language's.
 *
 * A part's draft is written only once a save has changed that part: when it
 * already holds a draft, or when this save touched one of its keys, or changed
 * its share of a structured field (judged against `before`, the document the
 * save replaced). So an edit to a translatable field, inside a row or not,
 * starts no shared draft, and an edit to a shared field or to a structure
 * starts no language's.
 */
export async function storePartDrafts(
  repo: VersionsRepository,
  input: {
    ref: VersionRef;
    locale: string;
    document: Record<string, unknown>;
    before: Record<string, unknown>;
    touched: ReadonlySet<string>;
    keys: PartKeys;
    existing: PartDrafts;
    createdBy?: string | null;
  }
): Promise<void> {
  const touches = (part: ReadonlySet<string>) =>
    touchesPart(input.touched, part);
  const structured = structuredSharesChanged(input.touched, input.keys, {
    before: input.before,
    after: input.document,
  });
  // Each row records the part it holds (`draftSlotParts`).
  if (
    input.existing.shared ||
    structured.shared ||
    touches(input.keys.shared)
  ) {
    await repo.upsertWorkingDraft({
      ref: input.ref,
      locale: SHARED_DRAFT_SLOT,
      snapshot: {
        ...pick(input.document, input.keys.shared),
        ...structuredShares(input.document, input.keys, "structure"),
      },
      createdBy: input.createdBy,
      parts: draftSlotParts(SHARED_DRAFT_SLOT),
    });
  }
  if (
    input.existing.language ||
    structured.language ||
    touches(input.keys.language)
  ) {
    await repo.upsertWorkingDraft({
      ref: input.ref,
      locale: input.locale,
      snapshot: {
        ...pick(input.document, input.keys.language),
        ...structuredShares(input.document, input.keys, "overlay"),
      },
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
