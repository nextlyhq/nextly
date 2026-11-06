/**
 * The rewrite's dependencies on a real site: which documents hold blocks, how
 * each is read, how each is written, and who may write it.
 *
 * Read as the SYSTEM, because a host the person running the rewrite cannot see
 * still renders the component. Written as that PERSON, through the identity
 * their request resolved, so a host they may not update (or, for a live row,
 * publish) is refused by the same rules their own save would meet. A run no
 * person started writes as the system instead (see `WriteIdentity`).
 *
 * @module host-rewrite/site
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { blocksFieldReach } from "../class-usage-blocks-fields";
import { documentVersionOf, withVersionFrom } from "../document-version";
import {
  layoutPageReader,
  type LayoutGuardDirectApi,
} from "../layout-component-guard";
import { layoutReferencesOf } from "../layout-component-usage";

import { documentKeyOf, type HostAddress, type LeftHost } from "./contract";
import {
  HOST_CHANGED,
  writeExpecting,
  type StoredExpectation,
} from "./expectations";
import { PUBLIC_STATES } from "./lifecycle";
import type {
  HostCandidate,
  HostDocument,
  HostReader,
  HostSource,
  HostWrite,
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
}

/**
 * The identity a write runs as: the caller's request, as it resolved it, or
 * the system, for a run no person started (removing a component's retired
 * field values, which no reader is ever shown and every write already drops).
 */
export type WriteIdentity =
  | (Record<string, unknown> & { readonly overrideAccess: false })
  | { readonly overrideAccess: true };

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
  /** The site's default language, which validation names as no language. */
  readonly defaultLocale: () => string | undefined;
  /** The RESOLVED slug Layouts are stored under. */
  readonly layouts: string;
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
  "nextly" | "collectionSlugs" | "resolveCollection" | "singles" | "locales"
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
  const collection = collectionResolver(site);
  return cursor => walkDocuments(site, collection, cursorFrom(cursor));
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
export function siteHostSource(site: RewriteSite): HostSource {
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
export function siteWalkSource(site: DocumentSite): HostSource {
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
    const hosts = hostsOf(at, declaration, site.locales());
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
  const sorted = [...singles].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  for (const single of sorted) {
    if (after !== undefined && single.slug <= after) continue;
    const at = { kind: "single" as const, slug: single.slug };
    const hosts = hostsOf(at, single, site.locales());
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
  if (
    hostsOf({ kind: "collection", slug, id: "" }, declaration, []).length === 0
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
        hosts: hostsOf(at, declaration, site.locales()),
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
  locales: readonly string[]
): HostCandidate[] {
  const reach = blocksFieldReach(
    declaration as { fields?: unknown; localized?: unknown }
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

/** Reads a host's stored forms as the system. */
export function siteHostReader(site: Pick<RewriteSite, "nextly">): HostReader {
  return async host => {
    const nextly = await site.nextly();
    // Whether the row is public is asked of core's own lifecycle filter: a
    // read bounded to `published` answers every state the collection's
    // workflow calls public, so no state name is compared here.
    const shown = await readRow(nextly, host, "public");
    const live = shown ?? (await readRow(nextly, host, "all"));
    const pending = await readRow(nextly, host, "draft");
    const draft =
      pending !== null && pending._isWorkingDraft === true
        ? valueAt(pending, host.path)
        : null;
    // The version a read gives is the live row's, with or without a draft.
    const rev = documentVersionOf(live);
    return {
      ...(rev === undefined ? {} : { rev }),
      published: live === null ? { kind: "absent" } : valueAt(live, host.path),
      draft,
      // A row with no lifecycle has no state to keep: it is saved, not
      // published.
      liveState:
        shown !== null && typeof shown.status === "string"
          ? shown.status
          : null,
    };
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
 * One read of a host's row, or `null` when there is none: `all` reads the
 * main row in any state, `public` only in a state the workflow calls public,
 * and `draft` overlays a pending working draft where there is one.
 */
async function readRow(
  nextly: RewriteDirectApi,
  host: HostAddress,
  read: "all" | "public" | "draft"
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

/** The options one read of a host is made with, as the system. */
function readOptions(host: HostAddress, read: "all" | "public" | "draft") {
  return {
    depth: 0,
    overrideAccess: true,
    status: read === "public" ? PUBLIC_STATES : ("all" as const),
    ...(host.locale === undefined
      ? {}
      : { locale: host.locale, fallbackLocale: false as const }),
    ...(read === "draft" ? { draft: true } : {}),
  };
}

/** The value at a path of a row; the whole row for the empty path. */
function valueAt(
  row: Record<string, unknown>,
  path: readonly string[]
): ReadValue {
  let value: unknown = row;
  for (const key of path) {
    if (typeof value !== "object" || value === null) return { kind: "absent" };
    value = (value as Record<string, unknown>)[key];
  }
  return value === undefined || value === null
    ? { kind: "absent" }
    : { kind: "value", value };
}

/**
 * What a write's validation must find before it may land.
 *
 * A save depends on the one form it was computed from. A publish depends on
 * more: the live row it was computed from, and the absence of a pending
 * draft, since a publish would put a draft created meanwhile live, the
 * author's other changes with it. With no pending draft the draft form reads
 * as the live row, so it must hash the same; and the draft's absence is asked
 * as such, because a draft that leaves this field alone hashes the same too.
 */
function expectationFor(
  nextly: RewriteDirectApi,
  write: HostWrite,
  defaultLocale: string | undefined
): StoredExpectation {
  // The language as validation names it: none for the default one.
  const locale =
    write.host.locale === undefined || write.host.locale === defaultLocale
      ? {}
      : { locale: write.host.locale };
  const judged = { done: false };
  if (write.mode !== "publish") {
    return { host: write.host, forms: [write.expected], ...locale, judged };
  }
  return {
    host: write.host,
    ...locale,
    judged,
    forms: [write.expected, { form: "draft", hash: write.expected.hash }],
    noPendingDraft: async () => {
      const pending = await readRow(nextly, write.host, "draft");
      return pending === null || pending._isWorkingDraft !== true;
    },
  };
}

/** The identity a write made as the system runs as: past every access rule. */
interface SystemIdentity {
  readonly overrideAccess: true;
}

/** Who a writer's writes are made as: a person, or the system. */
type WriterIdentity = WriteIdentity | SystemIdentity;

/** Writes a host as the person running the rewrite, checked against what was read. */
export function siteHostWriter(
  site: Pick<RewriteSite, "nextly" | "defaultLocale"> & {
    readonly identity: () => Promise<WriterIdentity>;
  }
): HostWriter {
  return async write => {
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
    const nextly = await site.nextly();
    const identity = await site.identity();
    const inLocale =
      write.host.locale === undefined ? {} : { locale: write.host.locale };
    try {
      await writeExpecting(
        expectationFor(nextly, write, site.defaultLocale()),
        () =>
          write.host.kind === "single"
            ? nextly.updateSingle({
                slug: write.host.slug,
                data,
                depth: 0,
                ...inLocale,
                ...identity,
              })
            : nextly.update({
                collection: write.host.slug,
                id: write.host.id ?? "",
                data,
                depth: 0,
                ...inLocale,
                ...identity,
              })
      );
      return { kind: "written" };
    } catch (error) {
      return writeFailure(error);
    }
  };
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

/** What a failed write came to; anything this does not recognise is thrown. */
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

/** What a validation refusal came to: the host changed, or refused, and why. */
function validationFailure(error: NextlyError): WriteResult {
  const issues = (error.publicData as { errors?: unknown } | undefined)?.errors;
  const list = Array.isArray(issues)
    ? (issues as { code?: unknown; message?: unknown }[])
    : [];
  if (list.some(issue => issue.code === HOST_CHANGED))
    return { kind: "changed" };
  return {
    kind: "refused",
    detail:
      list
        .map(issue => (typeof issue.message === "string" ? issue.message : ""))
        .filter(message => message !== "")
        .join(" ") || error.message,
  };
}
