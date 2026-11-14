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
 * panel's whole-section save, an undo and an import are refused alike. These
 * are the early, friendly refusals, naming the document where they can.
 *
 * ## What serializes it with a first use
 *
 * The composition graph lock (`composition-graph-lock`). A page write that
 * ADDS a reference to a variable the site does not define is refused
 * (`fields/token-reference-judgement`), but that validation runs before the
 * page's transaction, so it is made again inside it, under the lock, against
 * the site's variables read then (`composition-rejudge`). Every write of the
 * site style that drops a variable, this route's included, takes the same
 * lock inside its own transaction and reads the stored documents once more
 * under it (`site-style-removal-lock`); a use found refuses the write, which
 * is rolled back whole. So the two are judged one after the other: a page
 * that got the lock first has committed when the removal reads, and refuses
 * it; one that comes after waits for the removal to commit, and is refused
 * its first use of a variable now gone.
 *
 * The site-style write is made with the version of the read the check
 * judged, so a change to the shared styles or the variables in between
 * refuses the write rather than being overwritten; the removal then reads
 * again, judges again on what is stored now, and removes only its variables
 * from that ({@link stale-retry}).
 *
 * ## What isn't closed
 *
 * A reference held in a blocks value inside a repeater's rows or a
 * field-group instance: the validation does not judge those, and a page
 * write changing only them does not take the lock.
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
  refuseStoredUses,
  storedUsesOf,
  type StillUsed,
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
  REMOVAL_COUNT_MS,
} from "./shared-styles-routes";
import type { SiteStyleData } from "./site-style";
import {
  SITE_STYLE_SLUG,
  VARIABLE_REMOVE_WRITE_CONTEXT,
  sharedStylesOverCode,
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
import {
  type UncoveredPage,
  type UncoveredPages,
  variablesOnUncoveredPages,
} from "./uncovered-pages";
import { indexIsWhole, indexStillCounting } from "./usage-index-health";

/** A variable's identity, as the engine bounds one it can write. */
const IDENTITY = z.string().min(1).max(MAX_TOKEN_NAME_LENGTH);

const RemoveBody = z.strictObject({
  ids: z.array(IDENTITY).min(1).max(VARIABLE_USAGE_IDS_MAX),
});

/**
 * The stored documents' own answer to whether some variables are still used:
 * the one shape a shared style's removal asks too. Without `firstReadable`
 * the check is made for a write whose author cannot be asked, and no
 * document is named.
 */
export type StillUsedVariables = StillUsed;

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
  /**
   * The pages the usage index does not cover, read where it cannot become
   * whole; without them, such an index refuses every removal.
   */
  readonly uncovered?: UncoveredPages;
}

/**
 * The reasons the site's shared styles give against removing each variable:
 * the one reading both the in-use check here and the site style's write
 * under the composition graph lock (`site-style-removal-lock`) refuse by.
 */
export function sharedStyleReasons(
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

/**
 * What the pages the index does not cover say against removing `removable`,
 * read from their stored text within the removal's time box
 * (`REMOVAL_COUNT_MS`): each variable used on one, by name, with the page
 * named where the caller may open it, or the first page not read in time or
 * not readable at all, or that the pages could not all be listed in time.
 * Nothing on a clear answer.
 */
export async function uncoveredReasons(
  removable: readonly NamedVariable[],
  pages: UncoveredPages,
  namer: Pick<StillUsedVariables, "firstReadable">,
  now: () => number = () => Date.now()
): Promise<UsageReason[]> {
  const outcome = await variablesOnUncoveredPages({
    identities: removable.map(variable => variable.id),
    pages,
    deadline: now() + REMOVAL_COUNT_MS,
    now,
  });
  if (outcome.kind === "clear") return [];
  const them = removable.length === 1 ? "the variable" : "the variables";
  if (outcome.kind === "unlisted") {
    // Not every uncovered page is known yet, so none can be named: the
    // refusal says the list itself did not finish within the box.
    return [
      {
        message: `The pages to check for ${them} could not all be listed in time, so nothing can be removed until they are. Try again shortly.`,
        used: false,
      },
    ];
  }
  if (outcome.kind === "unread") {
    const page = await pagesNamed([outcome.page], namer);
    return [
      {
        message: `${page} could not be read to check whether it uses ${them}, so nothing can be removed until it is. Try again shortly.`,
        used: false,
      },
    ];
  }
  const reasons: UsageReason[] = [];
  for (const { id, name } of removable) {
    const pagesUsing = outcome.uses.get(id);
    if (pagesUsing === undefined) continue;
    reasons.push({
      id,
      message: `${name} is used on ${await pagesNamed(pagesUsing, namer)}.`,
      used: true,
    });
  }
  return reasons;
}

/**
 * Pages named as a refusal names them: the first the caller may open by its
 * title, then how many more; counted alone where none can be named.
 */
async function pagesNamed(
  pages: readonly UncoveredPage[],
  namer: Pick<StillUsedVariables, "firstReadable">
): Promise<string> {
  const first = await namer.firstReadable?.(
    pages.map(page => ({
      kind: page.scope,
      slug: page.entity,
      id: page.entityKey,
    }))
  );
  const count = pages.length;
  if (first === undefined) return count === 1 ? "1 page" : `${count} pages`;
  return count === 1 ? first : `${first} and ${count - 1} more`;
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
  const uncovered = sources.uncovered;
  const reasons = [
    ...(await usageRefusals(
      removable,
      sources.usage,
      "variable",
      uncovered === undefined
        ? undefined
        : asked => uncoveredReasons(asked, uncovered, sources.stillUsed)
    )),
    ...sharedStyleReasons(removable, classes),
    ...blockDefaultReasons(removable, sources.blocks()),
  ];
  if (reasons.length > 0) {
    throw removalRefusalOf(reasons, { variableIds: ids }, pathOf);
  }
  // The stored documents' own answer, read past the index, last before the
  // write; the site style's write asks it again under the lock.
  await refuseStoredUses(ids, sources.stillUsed, "variableIds");
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

/** Shared styles in id order, two looks of one id in block-type order. */
function byIdThenType(a: VariableUseItem, b: VariableUseItem): number {
  const ids = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (ids !== 0) return ids;
  const left = a.blockType ?? "";
  const right = b.blockType ?? "";
  return left < right ? -1 : left > right ? 1 : 0;
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
      // A look's type, without which two types' own looks of one id could
      // not be told apart, nor the right one opened.
      ...(style.blockType === undefined ? {} : { blockType: style.blockType }),
    }))
    .sort(byIdThenType);
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
 * The write itself reads the stored documents once more, inside its own
 * transaction and under the composition graph lock
 * (`site-style-removal-lock`): a page saved while the removal ran, that uses
 * one of the variables, refuses it there as in use, and the write is rolled
 * back whole, so nothing is removed and nothing has to be put back.
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
  // The in-use check alone: the stored documents are read again by the
  // write's own transaction, not by the route after it.
  checks: Pick<VariableRemovalChecks, "inUse">
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
  await retryOnStale(
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
      await store.write(withoutVariables(read.section, gone), read);
    }
  );
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
  // The section's one reading, which the Single's guards and its write under
  // the lock merge by too.
  return sharedStylesOverCode(defaults, storedDocument(doc).classes);
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
  checksAccess?: true;
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
      checksAccess: true, // The handler judges each caller.
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
      checksAccess: true, // The handler judges each caller.
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
 * the stored documents' own answer that check reads last, which the site
 * style's own write asks again under the composition graph lock
 * (`site-style-removal-lock`).
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
  /** The pages the index does not cover (`uncovered-pages`). */
  readonly uncovered?: UncoveredPages;
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
        {
          usage: args.usage,
          blocks: args.blocks,
          stillUsed,
          ...(args.uncovered === undefined
            ? {}
            : { uncovered: args.uncovered }),
        },
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
