/**
 * The Variables panel's routes: how widely each variable is used and where,
 * and removing the ones the site added that nothing uses.
 *
 * A variable (design token) is used by a document whose blocks or page
 * settings name it in a `$token` reference, by a shared style whose own
 * styles name it, and by a block type whose own default styles
 * (`baseStyles`) name it; the last two count whether or not any page applies
 * the style or places the block. Documents are read from the variable usage
 * index (`token-usage`), through the same listing the shared-style counts
 * are read from, so a count, its split by kind and the where-used list cannot
 * disagree. Shared styles are read from the site style as the compiler
 * merges it: the code's and the stored ones. Block types are read from the
 * block registry the pages are rendered with.
 *
 * ## One check, on every path
 *
 * {@link refuseVariablesInUse} is the one in-use check. The remove route
 * makes it just before its write, and the site-style Single makes it on any
 * other write that drops a variable (`site-style-storage`), so the Variables
 * panel's whole-section save, an undo and an import are refused alike.
 *
 * ## What serializes it with a first use
 *
 * The same fence a shared style's removal has. A page write that ADDS a
 * reference to a variable the site does not define is refused
 * (`fields/token-reference-judgement`), so once the removal's write of the
 * site style lands, no later save can bring a first use of the variable. A
 * save before it is found: the check reads the usage index and then the
 * stored documents themselves, just before the write. The site-style write is
 * made with the version of the read the check judged, so a change to the
 * shared styles or the variables in between refuses the write rather than
 * being overwritten; the removal then reads again, judges again on what is
 * stored now, and removes only its variables from that ({@link stale-retry}).
 *
 * ## What isn't closed
 *
 * Once its write has landed, the removal rescans the stored documents once
 * more, and a page saved during the removal that uses one of the variables
 * puts them back: the removed entries are written back where they were, and
 * the removal is refused as in use. What remains is a page save whose
 * validation ran before the removal's write and whose commit lands after
 * that final rescan read the page. A lock over the whole composition, taken
 * in the transaction of every page write and of the removal's, is what would
 * close it.
 *
 * @module variables-routes
 */
import {
  MAX_TOKEN_NAME_LENGTH,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import {
  getCachedNextly,
  NextlyError,
  respondDoc,
  respondMutation,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import { documentVersionOf, withVersionFrom } from "./document-version";
import {
  SHARED_STYLE_IN_USE_CODE,
  VARIABLE_ID_PARAM,
  VARIABLE_PAGE_PARAM,
  VARIABLE_REMOVE_ROUTE_PATH,
  VARIABLE_USAGE_IDS_MAX,
  VARIABLE_USAGE_ROUTE_PATH,
  VARIABLE_WHERE_USED_ROUTE_PATH,
  SHARED_STYLE_WHERE_USED_MAX,
  SHARED_STYLE_WHERE_USED_PAGES_MAX,
  type VariableRemoveRequest,
  type VariablesUsageResponse,
  type VariableUsage,
  type VariableUseItem,
} from "./library-contract";
import {
  stillUsedMessage,
  storedUsesOf,
  type StoredDocuments,
  type StoredUse,
} from "./shared-style-rescan";
import {
  invalidRequest,
  jsonBody,
  listingOf,
  mayCountSharedStyleUsage,
  namedDocumentsReader,
  namedSingleReader,
  NOTHING_FOUND,
  readableUses,
  removalRefusalOf,
  respondWithUsesPage,
  siteStylePermission,
  usageOf,
  usageRefusals,
  type ReadNamedDocuments,
  type ReadNamedSingle,
  type SharedStyleUsageSource,
  type UsageReason,
} from "./shared-styles-routes";
import { resolveSiteStyle, type SiteStyleData } from "./site-style";
import { readSiteStyleRecord } from "./site-style-record";
import {
  SITE_STYLE_SLUG,
  VARIABLE_REMOVE_WRITE_CONTEXT,
  storedVariableIdentity,
  storedVariables,
  suppliedVariableIds,
  type NamedVariable,
  type VariablesInUseCheck,
} from "./site-style-storage";
import { retryOnStale } from "./stale-retry";
import { readStoredJson } from "./stored-json";
import {
  blockDefaultsUsing,
  sharedStylesUsing,
  tokenUsageOf,
  type BlockTypeDefaults,
} from "./token-usage";
import { indexIsWhole, indexStillCounting } from "./usage-index-health";

/** A variable's identity, as the engine bounds one it can write. */
const IDENTITY = z.string().min(1).max(MAX_TOKEN_NAME_LENGTH);

const RemoveBody = z.strictObject({
  ids: z.array(IDENTITY).min(1).max(VARIABLE_USAGE_IDS_MAX),
});

/** The stored documents' own answer to whether some variables are still used. */
export interface StillUsedVariables {
  /** Every stored document still using any of the ids, read past access. */
  uses(ids: readonly string[]): Promise<readonly StoredUse[]>;
  /**
   * The title of the first of these the caller may open, when the check is
   * made for a caller who can be asked; absent, no document is named.
   */
  firstReadable?(uses: readonly StoredUse[]): Promise<string | undefined>;
}

/** The block types registered now, as the pages are rendered with them. */
export type RegisteredBlocks = () => readonly BlockTypeDefaults[];

/**
 * What the in-use check reads: the usage index, the registered block types,
 * and the stored documents.
 */
export interface VariableUseSources {
  readonly usage: SharedStyleUsageSource;
  readonly blocks: RegisteredBlocks;
  readonly stillUsed: StillUsedVariables;
}

/** The reasons the site's shared styles give against removing each variable. */
function sharedStyleReasons(
  removable: readonly NamedVariable[],
  classes: readonly unknown[]
): UsageReason[] {
  const using = sharedStylesUsing(
    classes,
    new Set(removable.map(variable => variable.id))
  );
  return removable.flatMap(({ id, name }) => {
    const styles = using.get(id);
    if (styles === undefined) return [];
    const names = styles.map(style => style.name).join(", ");
    return [
      {
        id,
        message: `${name} is used by the shared ${styles.length === 1 ? "style" : "styles"} ${names}.`,
        used: true,
      },
    ];
  });
}

/**
 * The reasons the registered block types give against removing each
 * variable: a type whose own default styles name it changes every instance of
 * it, on every page placing one, once the variable is gone.
 */
function blockDefaultReasons(
  removable: readonly NamedVariable[],
  blocks: readonly BlockTypeDefaults[]
): UsageReason[] {
  const using = blockDefaultsUsing(
    blocks,
    new Set(removable.map(variable => variable.id))
  );
  return removable.flatMap(({ id, name }) => {
    const types = using.get(id);
    if (types === undefined) return [];
    const labels = types.map(type => type.label).join(", ");
    const style =
      types.length === 1 ? "block's default style" : "blocks' default styles";
    return [
      { id, message: `${name} is used by the ${labels} ${style}.`, used: true },
    ];
  });
}

/** The words for variables the stored documents still use. */
function stillUsedWords(
  count: number,
  first: string | undefined,
  variables: number,
  canName: boolean
): string {
  if (canName) return stillUsedMessage(count, first, variables);
  const it = variables === 1 ? "it" : "them";
  const documents = count === 1 ? "1 document" : `${count} documents`;
  return `Still used on ${documents}. Remove ${it} from ${count === 1 ? "it" : "them"} first.`;
}

/**
 * Refuse removing variables any of which is still used: the one in-use check
 * for every path that removes one.
 *
 * In order, each read only once the cheaper ones found nothing: the usage
 * index must be whole and count no document for any of them, and no shared
 * style (`classes`, the site's as merged) and no registered block type's own
 * default styles may name one; then the stored documents themselves are
 * read, since an index zero is not proof. `pathOf`
 * says where each variable's issue is filed: its identity for the route, the
 * section for a write of the Single.
 */
export async function refuseVariablesInUse(
  removable: readonly NamedVariable[],
  classes: readonly unknown[],
  sources: VariableUseSources,
  pathOf: (id: string) => string
): Promise<void> {
  if (removable.length === 0) return;
  const ids = removable.map(variable => variable.id);
  const reasons = [
    ...(await usageRefusals(removable, sources.usage, "variable")),
    ...sharedStyleReasons(removable, classes),
    ...blockDefaultReasons(removable, sources.blocks()),
  ];
  if (reasons.length > 0) {
    throw removalRefusalOf(reasons, { variableIds: ids }, pathOf);
  }
  await refuseStoredVariableUses(ids, sources.stillUsed);
}

/**
 * Refuse, with the in-use refusal, when a stored document still uses any of
 * the variables: the stored documents' own answer, read past the index, which
 * the removal asks last before its write and once more after it.
 */
async function refuseStoredVariableUses(
  ids: readonly string[],
  stillUsed: StillUsedVariables
): Promise<void> {
  const uses = await stillUsed.uses(ids);
  if (uses.length === 0) return;
  const canName = stillUsed.firstReadable !== undefined;
  const message = stillUsedWords(
    uses.length,
    await stillUsed.firstReadable?.(uses),
    ids.length,
    canName
  );
  throw NextlyError.validation({
    errors: [{ path: "", code: SHARED_STYLE_IN_USE_CODE, message }],
    logContext: {
      variableIds: ids,
      uses: uses.map(use => `${use.kind}:${use.slug}:${use.id}`),
    },
  });
}

/** The variables a usage read asks about: one or more, at most one page. */
function usageIds(url: string): string[] {
  const ids = [...new Set(new URL(url).searchParams.getAll(VARIABLE_ID_PARAM))];
  const parsed = z
    .array(IDENTITY)
    .min(1)
    .max(VARIABLE_USAGE_IDS_MAX)
    .safeParse(ids);
  if (!parsed.success) {
    throw invalidRequest(
      `Name between 1 and ${VARIABLE_USAGE_IDS_MAX} variables with ?id=.`
    );
  }
  return parsed.data;
}

/** The site's shared styles as the compiler merges them, read for a request. */
export type SharedStylesNow = () => Promise<readonly unknown[]>;

/**
 * How widely each variable asked about is used, with the index's health and
 * whether this caller may ask for a count now. Counts name no document.
 */
export async function readVariableUsage(
  req: Request,
  ctx: Pick<PluginRouteContext, "caller" | "self">,
  usage: SharedStyleUsageSource,
  sharedStyles: SharedStylesNow,
  blocks: RegisteredBlocks
): Promise<VariablesUsageResponse> {
  const ids = usageIds(req.url);
  const health = await usage.health();
  // One index read for the whole page of variables, and one site-style read.
  const found = await usage.documentsUsingEach(ids, health);
  const styles = sharedStylesUsing(await sharedStyles(), new Set(ids));
  const defaults = blockDefaultsUsing(blocks(), new Set(ids));
  // Built from entries, so an identity like `__proto__` is an own key.
  const variables: Record<string, VariableUsage> = Object.fromEntries(
    ids.map(id => [
      id,
      {
        ...usageOf(found.get(id) ?? NOTHING_FOUND, collection =>
          usage.kindOf(collection)
        ),
        sharedStyles: (styles.get(id) ?? []).map(style => style.id).sort(),
        // In type order already, as the walk reads the registry.
        blockDefaults: (defaults.get(id) ?? []).map(block => block.type),
      },
    ])
  );
  return {
    whole: indexIsWhole(health),
    counting: indexStillCounting(health),
    mayCount: await mayCountSharedStyleUsage(ctx),
    variables,
  };
}

/**
 * What a where-used read asks for: one variable, and which page of its uses.
 * The page's upper bound depends on the site, so it is asked after the
 * places beside the documents are read ({@link variableUsesPagesMax}).
 */
const WhereUsedQuery = z.object({
  id: IDENTITY,
  page: z.coerce.number().int().min(1).default(1),
});

/**
 * The last page a variable's where-used list can reach: every document one
 * usage listing can name, which is what bounds a shared style's list, and
 * the places beside them that this site has, twenty to a page.
 */
export function variableUsesPagesMax(placesBesideDocuments: number): number {
  const documents =
    SHARED_STYLE_WHERE_USED_PAGES_MAX * SHARED_STYLE_WHERE_USED_MAX;
  return Math.ceil(
    (documents + placesBesideDocuments) / SHARED_STYLE_WHERE_USED_MAX
  );
}

/**
 * The places a variable is used, a page of twenty at a time: the shared
 * styles naming it, by id, then the block types whose default styles name
 * it, by type, then the documents, read as the caller so only readable ones
 * are named and the rest counted in `meta.hiddenCount`.
 */
export async function readVariableUses(
  req: Request,
  usage: SharedStyleUsageSource,
  readers: { named: ReadNamedDocuments; single: ReadNamedSingle },
  sharedStyles: SharedStylesNow,
  blocks: RegisteredBlocks,
  siteStyleSlug: string
): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const parsed = WhereUsedQuery.safeParse({
    id: params.get(VARIABLE_ID_PARAM) ?? undefined,
    page: params.get(VARIABLE_PAGE_PARAM) ?? undefined,
  });
  if (!parsed.success) {
    throw invalidRequest(
      "Name the variable with ?id=, and a page from 1 with ?page=."
    );
  }
  const { id, page } = parsed.data;
  const styles: VariableUseItem[] = (
    sharedStylesUsing(await sharedStyles(), new Set([id])).get(id) ?? []
  )
    .map(style => ({
      id: style.id,
      title: style.name,
      collection: siteStyleSlug,
      kind: "shared-style" as const,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // In type order already, as the walk reads the registry.
  const defaults: VariableUseItem[] = (
    blockDefaultsUsing(blocks(), new Set([id])).get(id) ?? []
  ).map(block => ({
    id: block.type,
    title: block.label,
    collection: "",
    kind: "block-default" as const,
  }));
  if (page > variableUsesPagesMax(styles.length + defaults.length)) {
    throw invalidRequest(
      "That page is past the last place a variable can be used."
    );
  }
  const found = await listingOf(usage, id, await usage.health());
  const { readable, hidden } = await readableUses(found, usage, readers);
  return respondWithUsesPage<VariableUseItem>(
    [...styles, ...defaults, ...readable],
    page,
    { hidden, complete: found.complete }
  );
}

/** The stored tokens section, as stored, and the version of the read. */
export interface VariableRead {
  /** The stored section, unknown keys kept; empty when nothing is stored. */
  readonly section: Record<string, unknown>;
  /** The site's shared styles as merged, for the in-use check. */
  readonly classes: readonly unknown[];
  /** The Single's version as read; absent from a server that issues none. */
  readonly rev: string | undefined;
}

/** The stored tokens section, read and written as the remove route needs it. */
export interface VariableStore {
  read(): Promise<VariableRead>;
  /**
   * Store the section, with the version of the read it was made from, and
   * answer the document as the write left it, read as {@link read} reads it.
   */
  write(
    section: Record<string, unknown>,
    from: VariableRead
  ): Promise<VariableRead>;
}

/** The section without the entries whose identity is among `gone`. */
function withoutVariables(
  section: Record<string, unknown>,
  gone: ReadonlySet<string>
): Record<string, unknown> {
  const entries = Array.isArray(section.tokens) ? section.tokens : [];
  // Each entry judged on its own by the token rules, so one they cannot read
  // is kept exactly as stored rather than dropped by a removal of another.
  return {
    ...section,
    tokens: entries.filter(entry => {
      const id = storedVariableIdentity(entry);
      return id === undefined || !gone.has(id);
    }),
  };
}

/**
 * The section as a write left it, with the entries whose identity is among
 * `gone` put back where `original` held them. Each goes back at its index in
 * `original`, in order, so a section the write changed in nothing else comes
 * back exactly as it was read. One the section already holds again, a later
 * save having put it there, is left as that save stored it.
 */
function withVariablesBack(
  written: Record<string, unknown>,
  original: Record<string, unknown>,
  gone: ReadonlySet<string>
): Record<string, unknown> {
  const entries = Array.isArray(written.tokens) ? [...written.tokens] : [];
  const held = new Set(storedVariables({ tokens: entries }).keys());
  const was: unknown[] = Array.isArray(original.tokens) ? original.tokens : [];
  was.forEach((entry, at) => {
    const id = storedVariableIdentity(entry);
    if (id !== undefined && gone.has(id) && !held.has(id)) {
      entries.splice(Math.min(at, entries.length), 0, entry);
    }
  });
  return { ...written, tokens: entries };
}

/**
 * Put the removed variables back, a page having been saved using one while
 * the removal ran. Written from the read the removal's write produced, so an
 * unrelated save of the Single since is never overwritten: when the write is
 * refused as made from a replaced version, the Single is read again and the
 * variables are put back into what it holds now, a bounded number of times.
 * Any other failure is reported as it is.
 */
async function restoreRemoved(
  store: VariableStore,
  original: Record<string, unknown>,
  gone: ReadonlySet<string>,
  after: VariableRead
): Promise<void> {
  await retryOnStale(
    () => store.read(),
    from => store.write(withVariablesBack(from.section, original, gone), from),
    { read: after }
  );
}

/**
 * What the stored section says against removing each variable: supplied by
 * the site's code (it can be reset, not removed). One the site does not store
 * is refused outright, as an id the caller made up.
 */
function storedRefusals(
  ids: readonly string[],
  section: Record<string, unknown>,
  supplied: ReadonlySet<string>
): { reasons: string[]; removable: NamedVariable[] } {
  const stored = storedVariables(section);
  const reasons: string[] = [];
  const removable: NamedVariable[] = [];
  for (const id of ids) {
    const variable = stored.get(id);
    if (supplied.has(id)) {
      reasons.push(
        `${variable?.name ?? id} is defined in the site's code, so it can be reset but not removed.`
      );
    } else if (variable === undefined) {
      throw NextlyError.notFound({
        message: "There is no variable with this id.",
        logContext: { variableId: id },
      });
    } else {
      removable.push(variable);
    }
  }
  return { reasons, removable };
}

/**
 * Remove variables the site added that nothing uses: every check on what the
 * server reads just before the write, never on what the panel showed. One
 * refusal refuses the whole request, so nothing is half removed.
 *
 * Once the write has landed the stored documents are read once more, by the
 * check's own rescan: a page saved while the removal ran, that uses one of
 * the variables, puts every removed entry back where it was, and the removal
 * is refused as that rescan refuses. A rescan that cannot finish puts them
 * back too, since nothing then says no page uses them.
 *
 * A write refused because the Single was saved meanwhile is made again on
 * what is stored then: the stored section and the in-use check are judged
 * again, a shared style saved meanwhile that names a variable included, and
 * only these variables are taken out of the newest section.
 */
export async function removeVariables(
  req: Request,
  store: VariableStore,
  supplied: ReadonlySet<string>,
  checks: VariableRemovalChecks
): Promise<Response> {
  const parsed = RemoveBody.safeParse(await jsonBody(req));
  if (!parsed.success) {
    throw invalidRequest(
      `Name between 1 and ${VARIABLE_USAGE_IDS_MAX} variables to remove, by id.`
    );
  }
  const ids = [
    ...new Set(parsed.data.ids),
  ] satisfies VariableRemoveRequest["ids"];
  const gone = new Set(ids);
  const { read, written } = await retryOnStale(
    () => store.read(),
    async read => {
      const { reasons, removable } = storedRefusals(
        ids,
        read.section,
        supplied
      );
      if (reasons.length > 0) {
        throw NextlyError.conflict({
          reason: "state",
          message: `Nothing was removed. ${reasons.join(" ")}`,
          logContext: { variableIds: ids },
        });
      }
      await checks.inUse(removable, read.classes);
      return {
        read,
        written: await store.write(withoutVariables(read.section, gone), read),
      };
    }
  );
  try {
    await refuseStoredVariableUses(ids, checks.stillUsed);
  } catch (refusal) {
    await restoreRemoved(store, read.section, gone, written);
    throw refusal;
  }
  return respondMutation(
    ids.length === 1
      ? "The variable was removed."
      : `${ids.length} variables were removed.`,
    { ids }
  );
}

/** The slice of the Direct API the store reads and writes the Single through. */
interface VariableDirectApi {
  findSingle(args: { slug: string; overrideAccess: boolean }): Promise<unknown>;
  updateSingle(args: {
    slug: string;
    data: Record<string, unknown>;
    overrideAccess: boolean;
    context: Record<string, unknown>;
    user?: { id: string };
  }): Promise<unknown>;
}

/** The site-style Single's stored document as a record, or an empty one. */
function storedDocument(doc: unknown): Record<string, unknown> {
  return doc !== null && typeof doc === "object"
    ? (doc as Record<string, unknown>)
    : {};
}

/**
 * The site's shared styles as the compiler merges them: the code's, then the
 * stored ones over them by id.
 */
export function mergedSharedStyles(
  doc: unknown,
  defaults: SiteStyleData | undefined
): readonly unknown[] {
  const stored = readSiteStyleRecord({
    classes: storedDocument(doc).classes,
  });
  return resolveSiteStyle(defaults, stored).classes ?? [];
}

/** The site-style Single's document as the remove route reads it. */
function variableReadOf(
  doc: unknown,
  defaults: SiteStyleData | undefined
): VariableRead {
  const section = readStoredJson(storedDocument(doc).tokens);
  return {
    section:
      section !== null && typeof section === "object" && !Array.isArray(section)
        ? (section as Record<string, unknown>)
        : {},
    classes: mergedSharedStyles(doc, defaults),
    rev: documentVersionOf(doc),
  };
}

/**
 * The stored tokens section of the RESOLVED site-style Single, read and
 * written past its own permission: the route's declared permission admits
 * the caller. Written as the caller, marked as the route's write.
 */
export function siteStyleVariableStore(
  ctx: Pick<PluginRouteContext, "self" | "user">,
  nextly: VariableDirectApi,
  defaults: SiteStyleData | undefined
): VariableStore {
  const slug = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
  return {
    read: async () =>
      variableReadOf(
        await nextly.findSingle({ slug, overrideAccess: true }),
        defaults
      ),
    // The update answers the document it stored, with its new version.
    write: async (section, from) =>
      variableReadOf(
        await nextly.updateSingle({
          slug,
          data: withVersionFrom({ tokens: section }, from.rev),
          overrideAccess: true,
          context: { ...VARIABLE_REMOVE_WRITE_CONTEXT },
          ...(ctx.user === null ? {} : { user: { id: ctx.user.id } }),
        }),
        defaults
      ),
  };
}

/** Refuse a caller who may not read Design, before any read. */
async function admitVariableReader(
  ctx: Pick<PluginRouteContext, "caller" | "self">
): Promise<void> {
  const style = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
  // The routes are authenticated, so the dispatcher refuses an anonymous
  // caller first; `null` must still never read as allowed.
  const allowed = (await ctx.caller?.can("read", style)) ?? false;
  if (!allowed) {
    throw NextlyError.forbidden({
      logContext: { reason: "variable-usage-needs-site-style-read" },
    });
  }
}

/** What the routes are built from, per request. */
export interface VariableRouteSetup {
  /** The site's configured style: its code tier, looks included. */
  readonly defaults: SiteStyleData | undefined;
  /** The variable usage index for this request. */
  readonly usage: (ctx: PluginRouteContext) => SharedStyleUsageSource;
  /** The block types registered now. */
  readonly blocks: RegisteredBlocks;
  /** The removal's checks, as the installed plugin makes them for this caller. */
  readonly inUse: (
    ctx: PluginRouteContext,
    readNamed: ReadNamedDocuments
  ) => VariableRemovalChecks;
}

/**
 * The three variable routes. The two reads are Design's read, asked in the
 * handler before anything is read; the removal declares Design's update. A
 * count of the site's pages is the shared-style count route, since one sweep
 * fills every usage index.
 */
export function variableRoutes(setup: VariableRouteSetup): {
  method: "GET" | "POST";
  path: string;
  requiredPermission?: ReturnType<typeof siteStylePermission>;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}[] {
  const sharedStylesOf = (ctx: Pick<PluginRouteContext, "self">) => async () =>
    mergedSharedStyles(
      await (
        await getCachedNextly()
      ).findSingle({
        slug: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
        overrideAccess: true,
      }),
      setup.defaults
    );
  return [
    {
      method: "GET",
      path: VARIABLE_USAGE_ROUTE_PATH,
      handler: async (req, ctx) => {
        await admitVariableReader(ctx);
        return respondDoc(
          await readVariableUsage(
            req,
            ctx,
            setup.usage(ctx),
            sharedStylesOf(ctx),
            setup.blocks
          )
        );
      },
    },
    {
      method: "GET",
      path: VARIABLE_WHERE_USED_ROUTE_PATH,
      handler: async (req, ctx) => {
        await admitVariableReader(ctx);
        return readVariableUses(
          req,
          setup.usage(ctx),
          { named: namedDocumentsReader(ctx), single: namedSingleReader(ctx) },
          sharedStylesOf(ctx),
          setup.blocks,
          ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG
        );
      },
    },
    {
      method: "POST",
      path: VARIABLE_REMOVE_ROUTE_PATH,
      requiredPermission: siteStylePermission("update"),
      handler: async (req, ctx) =>
        removeVariables(
          req,
          siteStyleVariableStore(ctx, await getCachedNextly(), setup.defaults),
          suppliedVariableIds(setup.defaults),
          setup.inUse(ctx, namedDocumentsReader(ctx))
        ),
    },
  ];
}

/**
 * The remove route's checks: the in-use check it makes before its write, and
 * the stored documents' own answer that check reads last, which the route
 * asks once more after its write.
 */
export interface VariableRemovalChecks {
  readonly inUse: VariablesInUseCheck;
  readonly stillUsed: StillUsedVariables;
}

/** What the in-use check is bound to. */
export interface VariableCheckSetup {
  readonly usage: SharedStyleUsageSource;
  readonly blocks: RegisteredBlocks;
  readonly documents: () => Promise<StoredDocuments>;
  readonly limits: DocumentLimits;
  readonly firstReadable?: (
    uses: readonly StoredUse[]
  ) => Promise<string | undefined>;
  readonly pathOf: (id: string) => string;
}

/**
 * The in-use check, bound to the variable index, the registered block types
 * and the stored documents, with the rescan it ends on. The stored documents
 * are walked by `tokenUsageOf` under the page's bounds, the walk the index
 * records from.
 */
export function variableRemovalChecks(
  args: VariableCheckSetup
): VariableRemovalChecks {
  const stillUsed: StillUsedVariables = {
    uses: async ids =>
      storedUsesOf(
        ids,
        await args.documents(),
        stored => tokenUsageOf(stored, args.limits).ids
      ),
    ...(args.firstReadable === undefined
      ? {}
      : { firstReadable: args.firstReadable }),
  };
  return {
    stillUsed,
    inUse: (removable, classes) =>
      refuseVariablesInUse(
        removable,
        classes,
        { usage: args.usage, blocks: args.blocks, stillUsed },
        args.pathOf
      ),
  };
}

/**
 * The in-use check alone: what the site-style Single's guard makes for any
 * write that drops a variable other than the remove route's.
 */
export function variablesInUseCheck(
  args: VariableCheckSetup
): VariablesInUseCheck {
  return variableRemovalChecks(args).inUse;
}
