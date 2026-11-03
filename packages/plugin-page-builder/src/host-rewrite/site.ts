/**
 * The rewrite's dependencies on a real site: which documents hold blocks, how
 * each is read, how each is written, and who may write it.
 *
 * Read as the SYSTEM, because a host the person running the rewrite cannot see
 * still renders the component. Written as that PERSON, through the identity
 * their request resolved, so a host they may not update (or, for a live row,
 * publish) is refused by the same rules their own save would meet.
 *
 * @module host-rewrite/site
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import { blocksFieldReach } from "../class-usage-blocks-fields";
import {
  layoutPageReader,
  type LayoutGuardDirectApi,
} from "../layout-component-guard";
import { layoutReferencesOf } from "../layout-component-usage";

import { documentKeyOf, type HostAddress, type LeftHost } from "./contract";
import { HOST_CHANGED, writeExpecting } from "./expectations";
import type {
  HostCandidate,
  HostDocument,
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
}

/** The identity a write runs as, as the caller's request resolved it. */
export type WriteIdentity = Record<string, unknown> & {
  readonly overrideAccess: false;
};

/** What the rewrite needs from the installed plugin and the person running it. */
export interface RewriteSite {
  /** The booted Direct API. */
  readonly nextly: () => Promise<RewriteDirectApi>;
  /** Every registered collection's slug, or `undefined` when unreadable. */
  readonly collectionSlugs: () => Promise<readonly string[] | undefined>;
  /** A collection's registry record (its fields and localization). */
  readonly resolveCollection: (slug: string) => Promise<unknown>;
  /** Every Single holding blocks, with its fields, or `undefined` when unreadable. */
  readonly singles: () => Promise<
    | readonly {
        readonly slug: string;
        readonly fields?: unknown;
        /**
         * The Single's localization master switch, which a blocks field with
         * no flag of its own inherits; every language is walked when it is on.
         */
        readonly localized?: boolean;
      }[]
    | undefined
  >;
  /** The site's configured languages. */
  readonly locales: () => readonly string[];
  /** The RESOLVED slug Layouts are stored under. */
  readonly layouts: string;
  /** The documents the usage index says place the component; a hint only. */
  readonly hints: () => Promise<
    readonly { readonly slug: string; readonly id: string }[]
  >;
  /** The component being converted, for the Layout scan. */
  readonly componentId: string;
  /** Who the writes are made as, resolved from the caller's own request. */
  readonly identity: () => Promise<WriteIdentity>;
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

/** The walk's hosts on a real site. */
export function siteHostSource(site: RewriteSite): HostSource {
  const reaches = new Map<string, Promise<unknown>>();
  const collection = (slug: string) => {
    let held = reaches.get(slug);
    if (held === undefined) {
      held = site.resolveCollection(slug);
      reaches.set(slug, held);
    }
    return held;
  };
  return {
    documents: cursor => walkDocuments(site, collection, cursorFrom(cursor)),
    cursorOf: document => JSON.stringify(cursorOfDocument(document)),
    hinted: async () => {
      const found: HostDocument[] = [];
      for (const hint of await site.hints()) {
        const hosts = hostsOf(
          { kind: "collection", slug: hint.slug, id: hint.id },
          await collection(hint.slug),
          site.locales()
        );
        if (hosts.length > 0) {
          found.push({
            key: documentKeyOf({ kind: "collection", ...hint }),
            hosts,
          });
        }
      }
      return found;
    },
    outside: () => layoutsNaming(site),
  };
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
  site: RewriteSite,
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
  site: RewriteSite,
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
  site: RewriteSite,
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
  site: RewriteSite,
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

/** A document's hosts: every blocks field in every language it stores. */
function hostsOf(
  at: Pick<HostAddress, "kind" | "slug" | "id">,
  declaration: unknown,
  locales: readonly string[]
): HostCandidate[] {
  const reach = blocksFieldReach(
    declaration as { fields?: unknown; localized?: unknown }
  );
  const languages = (localized: boolean): (string | undefined)[] =>
    localized && locales.length > 0 ? [...locales] : [undefined];
  const hosts: HostCandidate[] = [];
  for (const field of reach.fields) {
    for (const locale of languages(field.descriptor.localized)) {
      hosts.push({
        host: {
          ...at,
          path: field.path,
          ...(locale === undefined ? {} : { locale }),
        },
        access: field.path.length === 1 ? "write" : "read",
      });
    }
  }
  if (reach.unreachable) {
    const localized =
      (declaration as { localized?: unknown } | null)?.localized === true;
    for (const locale of languages(localized)) {
      hosts.push({
        host: { ...at, path: [], ...(locale === undefined ? {} : { locale }) },
        access: "scan",
      });
    }
  }
  return hosts;
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
    return {
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
 * One read of a host's row, or `null` when there is none: `all` reads the
 * main row in any state, `public` only in a state the workflow calls public,
 * and `draft` overlays a pending working draft where there is one.
 */
async function readRow(
  nextly: RewriteDirectApi,
  host: HostAddress,
  read: "all" | "public" | "draft"
): Promise<Record<string, unknown> | null> {
  const inLocale =
    host.locale === undefined
      ? {}
      : { locale: host.locale, fallbackLocale: false as const };
  const shared = {
    depth: 0,
    overrideAccess: true,
    status: read === "public" ? ("published" as const) : ("all" as const),
    ...inLocale,
    ...(read === "draft" ? { draft: true } : {}),
  };
  try {
    const row =
      host.kind === "single"
        ? await nextly.findSingle({
            slug: host.slug,
            createIfMissing: false,
            ...shared,
          })
        : await nextly.findByID({
            collection: host.slug,
            id: host.id ?? "",
            ...shared,
          });
    return typeof row === "object" && row !== null
      ? (row as Record<string, unknown>)
      : null;
  } catch (error) {
    if (NextlyError.isNotFound(error)) return null;
    throw error;
  }
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

/** Writes a host as the person running the rewrite, checked against what was read. */
export function siteHostWriter(
  site: Pick<RewriteSite, "nextly" | "identity">
): HostWriter {
  return async write => {
    const field = write.host.path[0];
    if (field === undefined || write.host.path.length !== 1) {
      return {
        kind: "refused",
        detail: "This value has no address a write can name.",
      };
    }
    const data: Record<string, unknown> = {
      [field]: write.value,
      // Published again in the public state it was read in, which is the one
      // its workflow already chose.
      ...(write.publishAs === undefined ? {} : { status: write.publishAs }),
    };
    const nextly = await site.nextly();
    const identity = await site.identity();
    const inLocale =
      write.host.locale === undefined ? {} : { locale: write.host.locale };
    try {
      await writeExpecting({ host: write.host, ...write.expected }, () =>
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

/** What a failed write came to; anything this does not recognise is thrown. */
function writeFailure(error: unknown): WriteResult {
  if (NextlyError.isForbidden(error)) return { kind: "forbidden" };
  if (NextlyError.isNotFound(error)) return { kind: "changed" };
  if (NextlyError.isCode(error, "CONFLICT")) return { kind: "changed" };
  if (!NextlyError.isCode(error, "VALIDATION_ERROR")) throw error;
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
