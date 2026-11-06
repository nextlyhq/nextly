/**
 * The rewrite's dependencies on a real site: which documents hold blocks, how
 * each is read, how each is written, and who may write it.
 *
 * Read as the SYSTEM, because a host the person running the rewrite cannot see
 * still renders the component. Written as that PERSON, through the identity
 * their request resolved, so a host they may not update (or, for a live row,
 * publish) is refused by the same rules their own save would meet; what the
 * write expects to find is judged as the system's, which read it. A run no
 * person started writes as the system instead (see `WriteIdentity`).
 *
 * @module host-rewrite/site
 */
import {
  NextlyError,
  readStoredFields,
  updateIfUnchanged,
  type PluginConditionalWriteIdentity,
  type PluginStoredDocument,
  type PluginStoredFields,
  type PluginStoredIdentity,
  type PluginStoredLifecycle,
  type PluginStoredValue,
} from "@nextlyhq/plugin-sdk";

import {
  blocksFieldReach,
  type FieldGroupDefinitions,
} from "../class-usage-blocks-fields";
import { documentVersionOf, withVersionFrom } from "../document-version";
import {
  layoutPageReader,
  type LayoutGuardDirectApi,
} from "../layout-component-guard";
import { layoutReferencesOf } from "../layout-component-usage";

import { documentKeyOf, type HostAddress, type LeftHost } from "./contract";
import type {
  HostCandidate,
  HostDocument,
  HostRead,
  HostReader,
  HostSource,
  HostWriter,
  ReadValue,
  WriteResult,
} from "./rewrite";

/** How many document ids one page of the walk lists. */
const IDS_PER_PAGE = 100;

/** The Direct API calls the rewrite makes, named structurally. */
export interface RewriteDirectApi extends LayoutGuardDirectApi {
  findSingle(args: {
    slug: string;
    createIfMissing: false;
    draft?: boolean;
    status?: "all" | "published";
    locale?: string;
    fallbackLocale?: false;
    depth?: number;
    overrideAccess?: boolean;
  }): Promise<unknown>;
  update(args: {
    collection: string;
    id: string;
    data: Record<string, unknown>;
    locale?: string;
    depth?: number;
    overrideAccess?: boolean;
  }): Promise<unknown>;
  updateSingle(args: {
    slug: string;
    data: Record<string, unknown>;
    locale?: string;
    depth?: number;
    overrideAccess?: boolean;
  }): Promise<unknown>;
  /** The field-group registry's definitions, a page at a time, as the system. */
  fieldGroups: {
    find(args: { limit?: number; offset?: number }): Promise<{
      items: readonly { slug: string; fields?: unknown }[];
      meta: { hasNext: boolean };
    }>;
  };
}

/**
 * The identity a write runs as: the caller's request, as it resolved it, or
 * the system, for a run no person started (removing a component's retired
 * field values, which no reader is ever shown and every write already drops).
 * The conditional write's own identity, so either is judged by core.
 */
export type WriteIdentity = PluginStoredIdentity;

/** The system, as the stored read and the conditional write take it. */
const THE_SYSTEM = { overrideAccess: true } as const;

/** What the rewrite needs from the installed plugin and the person running it. */
export interface RewriteSite {
  /** The booted Direct API. */
  readonly nextly: () => Promise<RewriteDirectApi>;
  /** Every registered collection's slug, or `undefined` when unreadable. */
  readonly collectionSlugs: () => Promise<readonly string[] | undefined>;
  /** A collection's registry record (its fields and localization). */
  readonly resolveCollection: (slug: string) => Promise<unknown>;
  /** Every Single holding blocks, with its fields, or `undefined` when unreadable. */
  readonly singles: () => Promise<readonly SingleToWalk[] | undefined>;
  /** The site's configured languages. */
  readonly locales: () => readonly string[];
  /** The site's default language. */
  readonly defaultLocale: () => string | undefined;
  /** The RESOLVED slug Layouts are stored under. */
  readonly layouts: string;
  /**
   * The site's field groups, by slug, read once per walk: those the registry
   * holds (made in the admin or declared in code), and those declared in code
   * it does not hold yet. A document whose only reference is to a group
   * holding no blocks field holds no copy, and is no host; a slug neither
   * knows answers `undefined`, and its reference may hold one. Absent, every
   * field group reference may hold one.
   */
  readonly fieldGroups?: () => Promise<FieldGroupDefinitions>;
  /** The documents the usage index says place the component; a hint only. */
  readonly hints: () => Promise<
    readonly { readonly slug: string; readonly id: string }[]
  >;
  /** The component being converted, for the Layout scan. */
  readonly componentId: string;
  /**
   * Who the writes are made as: resolved from the caller's own request, or the
   * system for a run no person started.
   */
  readonly identity: () => Promise<WriteIdentity>;
}

/** A Single as the walk reads it. */
export interface SingleToWalk {
  readonly slug: string;
  readonly fields?: unknown;
  /** The Single's localization master switch. */
  readonly localized?: boolean;
  /**
   * Whether which of its fields store per language is unknown: its fields'
   * own flags were not available. Every field is then read in every language.
   */
  readonly languagesUnknown?: boolean;
}

/**
 * A Single as the walk reads it, from what the registry lists and, for one
 * declared in code, its declaration.
 *
 * The registry's listing carries neither a Single's localization switch nor a
 * field's own `localized` flag. A Single declared in code takes both from its
 * declaration, fields included. A Single made in the admin has none, so on a
 * site with languages every one of its fields is read in every language: a
 * shared value is read once per language and converted once, rather than a
 * translation being missed.
 */
export function singleToWalk(
  listed: { readonly slug: string; readonly fields?: unknown },
  declaration: { fields?: unknown; localized?: unknown } | undefined,
  localizedSite: boolean
): SingleToWalk {
  if (declaration !== undefined) {
    return {
      slug: listed.slug,
      fields: declaration.fields ?? listed.fields,
      localized: declaration.localized === true,
    };
  }
  return {
    ...listed,
    localized: localizedSite,
    languagesUnknown: localizedSite,
  };
}

/** Where the walk is: a group (collections, then Singles), a slug, an id. */
interface Cursor {
  readonly group: 0 | 1;
  readonly slug: string;
  readonly id?: string;
}

/** A stored cursor, read strictly: anything unreadable starts the walk over. */
function cursorFrom(text: string | null): Cursor | null {
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as Partial<Cursor>;
    if (
      (parsed.group === 0 || parsed.group === 1) &&
      typeof parsed.slug === "string"
    ) {
      return {
        group: parsed.group,
        slug: parsed.slug,
        ...(typeof parsed.id === "string" ? { id: parsed.id } : {}),
      };
    }
  } catch {
    // Read as no cursor: the walk starts again, which skips nothing.
  }
  return null;
}

/** What walking every document holding blocks needs of the site. */
export type DocumentSite = Pick<
  RewriteSite,
  | "nextly"
  | "collectionSlugs"
  | "resolveCollection"
  | "singles"
  | "locales"
  | "fieldGroups"
>;

/** A collection's registry record, resolved once per walk. */
function collectionResolver(
  site: Pick<RewriteSite, "resolveCollection">
): (slug: string) => Promise<unknown> {
  const reaches = new Map<string, Promise<unknown>>();
  return slug => {
    let held = reaches.get(slug);
    if (held === undefined) {
      held = site.resolveCollection(slug);
      reaches.set(slug, held);
    }
    return held;
  };
}

/**
 * Every document on the site holding blocks, with its hosts, after `cursor`:
 * each collection's entries, then each Single. The walk every reader of the
 * site's blocks shares, a rewrite's and a count's alike, so none of them
 * reaches documents another misses.
 */
export function siteDocuments(
  site: DocumentSite
): (cursor: string | null) => AsyncGenerator<HostDocument> {
  const once = withGroupsOnce(site);
  const collection = collectionResolver(once);
  return cursor => walkDocuments(once, collection, cursorFrom(cursor));
}

/**
 * The site with its field groups read once, however many documents ask: the
 * registry is listed once per walk rather than once per document.
 */
function withGroupsOnce<T extends Pick<RewriteSite, "fieldGroups">>(
  site: T
): T {
  const read = site.fieldGroups;
  if (read === undefined) return site;
  let held: Promise<FieldGroupDefinitions> | undefined;
  return {
    ...site,
    fieldGroups: () => {
      held ??= read();
      return held;
    },
  };
}

/** The walk over every document, and where it resumes, with one resolver. */
function walkWith(
  site: DocumentSite,
  collection: (slug: string) => Promise<unknown>
): Pick<HostSource, "documents" | "cursorOf"> {
  return {
    documents: cursor => walkDocuments(site, collection, cursorFrom(cursor)),
    cursorOf: document => JSON.stringify(cursorOfDocument(document)),
  };
}

/** The walk's hosts on a real site. */
export function siteHostSource(given: RewriteSite): HostSource {
  const site = withGroupsOnce(given);
  const collection = collectionResolver(site);
  return {
    ...walkWith(site, collection),
    hinted: () => hintedDocuments(site, collection),
    outside: () => layoutsNaming(site),
  };
}

/**
 * Every document on the site, for a run that has no component to hint at and
 * nothing outside the walk: a Layout is a document like any other to it.
 */
export function siteWalkSource(given: DocumentSite): HostSource {
  const site = withGroupsOnce(given);
  return {
    ...walkWith(site, collectionResolver(site)),
    hinted: () => Promise.resolve([]),
    outside: () => Promise.resolve([]),
  };
}

/**
 * The documents the usage index names, to visit first. A hint and nothing
 * more: an index that cannot be read, or a row naming a collection that has
 * since been removed or renamed, is skipped rather than stopping the run,
 * because the walk over the live registry that follows reaches every document
 * anyway. Only a failure of that walk stops a run.
 */
async function hintedDocuments(
  site: RewriteSite,
  collection: (slug: string) => Promise<unknown>
): Promise<HostDocument[]> {
  let hints: readonly { readonly slug: string; readonly id: string }[];
  try {
    hints = await site.hints();
  } catch {
    return [];
  }
  const found: HostDocument[] = [];
  for (const hint of hints) {
    let declaration: unknown;
    try {
      declaration = await collection(hint.slug);
    } catch {
      continue;
    }
    const at = { kind: "collection" as const, slug: hint.slug, id: hint.id };
    const hosts = hostsOf(
      at,
      declaration,
      site.locales(),
      await site.fieldGroups?.()
    );
    if (hosts.length > 0) found.push({ key: documentKeyOf(at), hosts });
  }
  return found;
}

/** Where a document sits in the walk. */
function cursorOfDocument(document: HostDocument): Cursor {
  const host = document.hosts[0]?.host;
  if (host === undefined) return { group: 1, slug: "" };
  return host.kind === "single"
    ? { group: 1, slug: host.slug }
    : { group: 0, slug: host.slug, id: host.id ?? "" };
}

/** Every document holding blocks: each collection's entries, then each Single. */
async function* walkDocuments(
  site: DocumentSite,
  collection: (slug: string) => Promise<unknown>,
  cursor: Cursor | null
): AsyncGenerator<HostDocument> {
  if (cursor === null || cursor.group === 0) {
    yield* collectionDocuments(site, collection, cursor);
  }
  yield* singleDocuments(site, cursor?.group === 1 ? cursor.slug : undefined);
}

/** Each collection's entries, by slug and then id, from the cursor on. */
async function* collectionDocuments(
  site: DocumentSite,
  collection: (slug: string) => Promise<unknown>,
  cursor: Cursor | null
): AsyncGenerator<HostDocument> {
  const slugs = await site.collectionSlugs();
  if (slugs === undefined) throw unlisted("collections");
  for (const slug of [...slugs].sort()) {
    if (cursor !== null && slug < cursor.slug) continue;
    const after = slug === cursor?.slug ? cursor.id : undefined;
    yield* entriesOf(site, slug, await collection(slug), after);
  }
}

/** Each Single holding blocks, by slug, after `after` when given. */
async function* singleDocuments(
  site: DocumentSite,
  after: string | undefined
): AsyncGenerator<HostDocument> {
  const singles = await site.singles();
  if (singles === undefined) throw unlisted("Singles");
  const groups = await site.fieldGroups?.();
  const sorted = [...singles].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  for (const single of sorted) {
    if (after !== undefined && single.slug <= after) continue;
    const at = { kind: "single" as const, slug: single.slug };
    const hosts = hostsOf(at, single, site.locales(), groups);
    if (hosts.length > 0) yield { key: documentKeyOf(at), hosts };
  }
}

/** The refusal when the population itself cannot be listed. */
function unlisted(what: string): NextlyError {
  return NextlyError.internal({
    logContext: { reason: "host-rewrite-unlisted", what },
  });
}

/** One collection's entries, by id, after `after`. */
async function* entriesOf(
  site: DocumentSite,
  slug: string,
  declaration: unknown,
  after: string | undefined
): AsyncGenerator<HostDocument> {
  const groups = await site.fieldGroups?.();
  if (
    hostsOf({ kind: "collection", slug, id: "" }, declaration, [], groups)
      .length === 0
  ) {
    return;
  }
  const nextly = await site.nextly();
  let last = after;
  for (;;) {
    const listed = await nextly.find({
      collection: slug,
      limit: IDS_PER_PAGE,
      page: 1,
      sort: "id",
      ...(last === undefined ? {} : { where: { id: { greater_than: last } } }),
      depth: 0,
      overrideAccess: true,
    });
    for (const row of listed.items) {
      const id = (row as { id?: unknown } | null)?.id;
      if (typeof id !== "string" && typeof id !== "number")
        throw unlisted(slug);
      last = String(id);
      const at = { kind: "collection" as const, slug, id: last };
      yield {
        key: documentKeyOf(at),
        hosts: hostsOf(at, declaration, site.locales(), groups),
      };
    }
    if (!listed.meta.hasNext) return;
  }
}

/**
 * A document's hosts: every blocks field in every language it stores.
 *
 * A top-level field stores per language exactly when its own flag and the
 * declaration's switch say so, as core classifies it. Anything deeper (a
 * field under a named group, or one only a scan of the row reaches, behind a
 * repeater or a field group) is walked in EVERY configured language: core
 * stores a localized field group's values per language even under a parent
 * that is not translated, and which of them it localizes is not on a surface
 * a plugin can read. Those hosts are only read and judged, never written, so
 * reading a shared value once per language costs reads and nothing else.
 */
function hostsOf(
  at: Pick<HostAddress, "kind" | "slug" | "id">,
  declaration: unknown,
  locales: readonly string[],
  fieldGroup: FieldGroupDefinitions | undefined
): HostCandidate[] {
  const reach = blocksFieldReach(
    declaration as { fields?: unknown; localized?: unknown },
    undefined,
    fieldGroup
  );
  // Every field in every language when which ones are translated is unknown.
  const everyField =
    (declaration as { languagesUnknown?: unknown } | null)?.languagesUnknown ===
    true;
  const languages = (localized: boolean): (string | undefined)[] =>
    (everyField || localized) && locales.length > 0
      ? [...locales]
      : [undefined];
  return [
    ...reach.fields.flatMap(field =>
      fieldHosts(at, field, languages, everyField)
    ),
    ...(reach.unreachable
      ? scanHosts(
          at,
          languages,
          reach.fields.map(field => field.path)
        )
      : []),
  ];
}

/** The languages a host is read in, given whether it stores per language. */
type Languages = (localized: boolean) => (string | undefined)[];

/** One reached field's hosts: written at the top level, read anywhere deeper. */
function fieldHosts(
  at: Pick<HostAddress, "kind" | "slug" | "id">,
  field: {
    readonly path: readonly string[];
    readonly descriptor: { readonly localized: boolean };
  },
  languages: Languages,
  /** Whether the declaration's per-language fields are unknown. */
  everyField: boolean
): HostCandidate[] {
  const hosts: HostCandidate[] = [];
  const topLevel = field.path.length === 1;
  // Only a top-level field the declaration says is translated is known to be
  // stored per language; any other read per language may be one stored value.
  const perLanguage = topLevel && field.descriptor.localized && !everyField;
  for (const locale of languages(!topLevel || field.descriptor.localized)) {
    hosts.push({
      host: { ...at, path: field.path, ...inLanguage(locale) },
      access: topLevel ? "write" : "read",
      ...(locale !== undefined && !perLanguage ? { maybeShared: true } : {}),
    });
  }
  return hosts;
}

/** The hosts scanning the whole row, for blocks no fixed path reaches. */
function scanHosts(
  at: Pick<HostAddress, "kind" | "slug" | "id">,
  languages: Languages,
  /** The paths the walk reaches directly, which the scan leaves out. */
  excluded: readonly (readonly string[])[]
): HostCandidate[] {
  const hosts: HostCandidate[] = [];
  for (const locale of languages(true)) {
    hosts.push({
      host: { ...at, path: [], ...inLanguage(locale) },
      access: "scan",
      excluded,
      // A scan reads in every language because which values core keeps per
      // language is unknown.
      ...(locale === undefined ? {} : { maybeShared: true }),
    });
  }
  return hosts;
}

/** A host's language, when it has one. */
function inLanguage(locale: string | undefined): { locale?: string } {
  return locale === undefined ? {} : { locale };
}

/** The Layouts naming the component, each reported as left. */
async function layoutsNaming(site: RewriteSite): Promise<LeftHost[]> {
  const nextly = await site.nextly();
  const usage = await layoutReferencesOf({
    componentId: site.componentId,
    read: layoutPageReader(nextly, site.layouts),
  });
  const left: LeftHost[] = usage.references.map(reference => ({
    host: {
      kind: "collection",
      slug: site.layouts,
      id: reference.layoutId,
      path: ["areas"],
    },
    reason: "layout",
    detail: reference.title,
  }));
  if (!usage.complete) {
    left.push({
      host: { kind: "collection", slug: site.layouts, path: ["areas"] },
      reason: "unreadable",
      detail: "There are too many Layouts to check them all.",
    });
  }
  return left;
}

/**
 * Reads a host's stored forms as the system, with no read hook: the values
 * and the lifecycle alike come from the stored read, so a site's `afterRead`
 * hook can neither hide a copy nor change how the host is written back.
 */
export function siteHostReader(
  given: Pick<
    RewriteSite,
    "nextly" | "resolveCollection" | "singles" | "fieldGroups"
  >
): HostReader {
  const site = withGroupsOnce(given);
  return async host => {
    // A fixed host is read through its top-level field, whose stored value
    // holds the rest of its path; a group kept per language is stored whole
    // that way, in the host's language.
    const fields =
      host.path.length === 0
        ? await scannedFields(site, host)
        : host.path.slice(0, 1);
    // The row's version, the one thing taken from a Direct API read. Read
    // before the stored reads and after them: a save between them moves it,
    // so the forms are read again. The write sends the one read first, so a
    // save since refuses it.
    const nextly = await site.nextly();
    const { rev, ...forms } = await storedForms(host, fields, async () =>
      documentVersionOf(await readRow(nextly, host))
    );
    return { ...forms, ...(rev === undefined ? {} : { rev }) };
  };
}

/**
 * Whether a document has a pending working draft in any of the site's
 * languages, read as the system. A document that cannot be read, or that is
 * not there, answers `true`: the caller then leaves alone what waits on the
 * draft, rather than acting on a guess.
 */
export async function documentHasWorkingDraft(
  site: Pick<RewriteSite, "nextly" | "locales">,
  document: Pick<HostAddress, "kind" | "slug" | "id">
): Promise<boolean> {
  try {
    const nextly = await site.nextly();
    const locales = site.locales();
    for (const locale of locales.length === 0 ? [undefined] : locales) {
      const host: HostAddress = {
        ...document,
        path: [],
        ...(locale === undefined ? {} : { locale }),
      };
      const row = await readRow(nextly, host, "draft");
      if (row === null || row._isWorkingDraft === true) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * How many times a host's forms are read from the start when its working
 * draft is published or discarded, or the row saved, between the live read
 * and the draft read.
 */
const FORM_READS = 3;

/**
 * A host's stored forms, from the stored read of `fields`: the live row's,
 * its public state, and the pending working draft's where one is. One field
 * is a fixed path's; several are a whole-row scan's, given back as one row
 * of those fields. Read again from the start while the draft moves between
 * the two reads; a host whose draft never holds still is not one to judge,
 * and is reported as unreadable rather than guessed at.
 */
async function storedForms(
  host: HostAddress,
  fields: readonly string[],
  /** The row's version now, `undefined` from a server that issues none. */
  revision: () => Promise<string | undefined>
): Promise<HostRead> {
  for (let attempt = 0; attempt < FORM_READS; attempt += 1) {
    const forms = await storedFormsOnce(host, fields, revision);
    if (forms !== undefined) return forms;
  }
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage:
      "This document's working draft kept changing while it was read.",
  });
}

/**
 * One reading of a host's stored forms, with the row's version read before
 * it, or `undefined` where the row moved between the live read and the draft
 * read.
 *
 * The two reads are two snapshots, so the row can change between them. The
 * draft read falls back to the live row once no working draft is pending, so
 * a draft discarded or published after the live read answers the live value
 * in the draft's place; taken as the draft, it would be saved as one,
 * recreating a draft its author just discarded. And a draft published, then
 * a new one saved, leaves both reads reporting a pending draft in the same
 * state, pairing the new draft with a live value no longer live. The row's
 * version covers its lifecycle and its held draft, so it is read before the
 * live read and again after the draft read: only a pair over one version,
 * whose draft read still reports the draft pending in the same live state, is
 * the host's; anything else is read again.
 */
async function storedFormsOnce(
  host: HostAddress,
  fields: readonly string[],
  revision: () => Promise<string | undefined>
): Promise<HostRead | undefined> {
  const before = await revision();
  const rev = before === undefined ? {} : { rev: before };
  const live = await readStored(host, fields, "published");
  if (live.kind === "absent") {
    return { published: { kind: "absent" }, draft: null, liveState: null };
  }
  const lifecycle = lifecycleOf(live);
  if (!lifecycle.workingDraft) {
    return {
      published: hostValue(live, host, fields),
      draft: null,
      liveState: lifecycle.publicState,
      ...rev,
    };
  }
  const draft = await readStored(host, fields, "draft");
  if (draft.kind === "absent") return undefined;
  const now = lifecycleOf(draft);
  if (!now.workingDraft || now.publicState !== lifecycle.publicState) {
    return undefined;
  }
  if ((await revision()) !== before) return undefined;
  return {
    published: hostValue(live, host, fields),
    draft: hostValue(draft, host, fields),
    liveState: lifecycle.publicState,
    ...rev,
  };
}

/**
 * The lifecycle a found stored read gives. The system's read always carries
 * it; a read that does not is not one to judge a host by.
 */
function lifecycleOf(
  read: Extract<PluginStoredFields, { kind: "found" }>
): PluginStoredLifecycle {
  if (read.live === undefined) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage: "The stored read gave no lifecycle for this document.",
    });
  }
  return read.live;
}

/** One stored read of a host's fields, in one form and its language. */
function readStored(
  host: HostAddress,
  fields: readonly string[],
  form: "published" | "draft"
): Promise<PluginStoredFields> {
  return readStoredFields(THE_SYSTEM, {
    ...storedDocumentOf(host),
    fields,
    form,
    ...(host.locale === undefined ? {} : { locale: host.locale }),
  });
}

/**
 * A host's value from a read that found its document: the one field's for a
 * fixed path, or for a scan a row holding every field read that stores one.
 */
function hostValue(
  read: Extract<PluginStoredFields, { kind: "found" }>,
  host: HostAddress,
  fields: readonly string[]
): ReadValue {
  if (host.path.length === 0) {
    const row: Record<string, unknown> = {};
    for (const field of fields) {
      const value = within(read.values[field], []);
      if (value.kind === "value") row[field] = value.value;
    }
    return { kind: "value", value: row };
  }
  return within(read.values[host.path[0] ?? ""], host.path.slice(1));
}

/**
 * The value at `path` inside a stored top-level value. Nothing stored there,
 * a `null` included, is absent: a field never filled holds no copy, and
 * reads as one that does not exist, never as a value to judge.
 */
function within(
  stored: PluginStoredValue | undefined,
  path: readonly string[]
): ReadValue {
  if (stored === undefined || stored.kind === "absent") {
    return { kind: "absent" };
  }
  let value: unknown = stored.value;
  for (const key of path) {
    if (!isRecord(value)) return { kind: "absent" };
    value = value[key];
  }
  return value === undefined || value === null
    ? { kind: "absent" }
    : { kind: "value", value };
}

/**
 * The top-level fields a whole-row scan reads: each the walk cannot follow to
 * a fixed path, so it may hold a blocks value no host of its own reaches.
 * Read through the stored read like any host, never from a hooked row; one
 * the stored read cannot answer (a field kept in another table) makes the
 * read refuse, and the host is reported as unreadable, never unchanged.
 */
async function scannedFields(
  site: Pick<RewriteSite, "resolveCollection" | "singles" | "fieldGroups">,
  host: HostAddress
): Promise<string[]> {
  const declaration =
    host.kind === "single"
      ? (await site.singles())?.find(single => single.slug === host.slug)
      : await site.resolveCollection(host.slug);
  const fields = unreachedFieldsOf(
    declaration as { fields?: unknown; localized?: unknown } | undefined,
    await site.fieldGroups?.()
  );
  if (fields === undefined || fields.length === 0) {
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      publicMessage:
        "This document holds a blocks value no field of it can be read for.",
    });
  }
  return fields;
}

/**
 * The top-level field names whose declarations hold a blocks field with no
 * fixed path, asked of the walk itself one declaration at a time; a nameless
 * group's own fields are its parent's columns, so they are asked in turn.
 * `undefined` where such a declaration has no name to read it by.
 */
function unreachedFieldsOf(
  declaration: { fields?: unknown; localized?: unknown } | undefined,
  fieldGroup: FieldGroupDefinitions | undefined
): string[] | undefined {
  const listed = declaration?.fields;
  if (!Array.isArray(listed)) return undefined;
  const localized = declaration?.localized;
  const names: string[] = [];
  const seen = new Set<unknown>();
  const stack: unknown[] = [...listed];
  while (stack.length > 0) {
    const field = stack.pop();
    if (seen.has(field)) continue;
    seen.add(field);
    if (
      !blocksFieldReach({ fields: [field], localized }, undefined, fieldGroup)
        .unreachable
    ) {
      continue;
    }
    const name = (field as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name !== "") {
      names.push(name);
      continue;
    }
    const inner = (field as { fields?: unknown } | null)?.fields;
    if (!Array.isArray(inner)) return undefined;
    stack.push(...inner);
  }
  return names;
}

/**
 * One read of a host's row, or `null` when there is none: `all` reads the
 * main row in any state, and `draft` overlays a pending working draft where
 * there is one.
 */
async function readRow(
  nextly: RewriteDirectApi,
  host: HostAddress,
  read: "all" | "draft" = "all"
): Promise<Record<string, unknown> | null> {
  try {
    const row = await fetchRow(nextly, host, readOptions(host, read));
    return isRecord(row) ? row : null;
  } catch (error) {
    if (NextlyError.isNotFound(error)) return null;
    throw error;
  }
}

/** One by-id read of a host's row: a Single by its slug, an entry by its id. */
function fetchRow(
  nextly: RewriteDirectApi,
  host: HostAddress,
  options: ReturnType<typeof readOptions>
): Promise<unknown> {
  return host.kind === "single"
    ? nextly.findSingle({ slug: host.slug, createIfMissing: false, ...options })
    : nextly.findByID({ collection: host.slug, id: host.id ?? "", ...options });
}

/** Whether a read answered with a row. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The options one read of a host's row is made with, as the system. */
function readOptions(host: HostAddress, read: "all" | "draft") {
  return {
    depth: 0,
    overrideAccess: true,
    status: "all" as const,
    ...(host.locale === undefined
      ? {}
      : { locale: host.locale, fallbackLocale: false as const }),
    ...(read === "draft" ? { draft: true } : {}),
  };
}

/** The document a host belongs to, as the stored read and write name it. */
function storedDocumentOf(host: HostAddress): PluginStoredDocument {
  return host.kind === "single"
    ? { single: host.slug }
    : { collection: host.slug, id: host.id ?? "" };
}

/**
 * Writes a host as the person running the rewrite, checked against what was
 * read as the system (see `writeIdentityOf`).
 */
export function siteHostWriter(
  site: Pick<RewriteSite, "identity">
): HostWriter {
  return async write => {
    // A host below a group is only ever read: the walk leaves one holding a
    // copy to its author, so no write reaches here with one, nor with a scan.
    const field = write.host.path[0];
    if (field === undefined || write.host.path.length !== 1) {
      return {
        kind: "refused",
        detail: "This value has no address a write can name.",
      };
    }
    const data = withVersionFrom(
      {
        [field]: write.value,
        // Published again in the public state it was read in, which is the
        // one its workflow already chose.
        ...(write.publishAs === undefined ? {} : { status: write.publishAs }),
      },
      write.rev
    );
    const identity = writeIdentityOf(await site.identity());
    try {
      // Made only if the field still hashes, under the write's own row lock,
      // to what was read; a publish also only if no working draft is pending,
      // since it would put that draft live with it.
      await updateIfUnchanged(identity, {
        ...storedDocumentOf(write.host),
        data,
        ...(write.host.locale === undefined
          ? {}
          : { locale: write.host.locale }),
        expect: {
          field,
          form: write.expected.form,
          hash: write.expected.hash,
          ...(write.mode === "publish" ? { noPendingDraft: true } : {}),
        },
      });
      return { kind: "written" };
    } catch (error) {
      return writeFailure(error);
    }
  };
}

/**
 * Who a host's conditional write is made as. The system's own run writes as
 * the system. A person's is the person's update, judged by every rule their
 * own save meets (the entry's or Single's update access, the field's update
 * rules, and publishing where the write publishes), with its expectation
 * judged as the system's: the host was read as the system, and the hash came
 * from that read, never from the person. So a person who may update a host
 * but not read it, or whose field read rule closes the blocks field to them,
 * still has their authorized rewrite made, and nobody is told whether a value
 * of their own matches one they may not read.
 */
function writeIdentityOf(
  identity: WriteIdentity
): PluginConditionalWriteIdentity {
  return identity.overrideAccess === true
    ? identity
    : { caller: identity, checkedBy: THE_SYSTEM };
}

/**
 * Writes a host as the system, checked against what was read like any other
 * rewrite's write: for a run that strips what no person may keep, so a host
 * the person who started it cannot open is stripped too. Every other rule of
 * the write still applies.
 */
export function systemHostWriter(
  site: Pick<RewriteSite, "nextly" | "defaultLocale">
): HostWriter {
  return siteHostWriter({
    ...site,
    identity: () => Promise.resolve({ overrideAccess: true as const }),
  });
}

/**
 * What a failed write came to; anything this does not recognise is thrown. A
 * conflict is the conditional write refusing: the host changed since it was
 * read, or a draft is pending under a publish, so it is read again.
 */
function writeFailure(error: unknown): WriteResult {
  if (NextlyError.isForbidden(error)) return { kind: "forbidden" };
  if (NextlyError.isNotFound(error)) return { kind: "changed" };
  if (NextlyError.isCode(error, "CONFLICT")) return { kind: "changed" };
  // Refused as made from an out-of-date version: the row was saved since the
  // read the write was made from.
  if (NextlyError.isCode(error, "STALE_VERSION")) return { kind: "changed" };
  if (!NextlyError.isCode(error, "VALIDATION_ERROR")) throw error;
  return validationFailure(error);
}

/** What a validation refusal came to: the write refused, and why. */
function validationFailure(error: NextlyError): WriteResult {
  const issues = (error.publicData as { errors?: unknown } | undefined)?.errors;
  const list = Array.isArray(issues)
    ? (issues as { code?: unknown; message?: unknown }[])
    : [];
  return {
    kind: "refused",
    detail:
      list
        .map(issue => (typeof issue.message === "string" ? issue.message : ""))
        .filter(message => message !== "")
        .join(" ") || error.message,
  };
}
