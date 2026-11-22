/**
 * The site's CSS variable prefix as Settings changes it: the route under the
 * site permission, and its dry run, which counts what still names a variable
 * through the current prefix in CSS text (a shadow's colour is kept so), since
 * a change leaves those pointing at nothing.
 *
 * The prefix has one door, as the breakpoints do: this route marks its write
 * as Settings', and the `site-style` Single refuses any other signed-in write
 * that changes the prefix (`site-style-storage`). The engine's
 * `resolveTokenPrefix` decides which prefixes may be used, here as in the
 * compiler and the Settings field.
 *
 * @module site-css-prefix
 */
import {
  isPlainRecord,
  resolveSiteTokens,
  resolveTokenPrefix,
  tokenIdentity,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  getCachedNextly,
  NextlyError,
  respondMutation,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import {
  SITE_CSS_PREFIX_ROUTE_PATH,
  type SiteCssPrefixDryRun,
  type SiteCssPrefixSaved,
} from "./library-contract";
import type { SharedStyleUsageSource } from "./shared-styles-routes";
import {
  MANAGE_SITE_PERMISSION,
  versionToWrite,
  writeSiteStyle,
  type SiteSettingsDirectApi,
  type SiteSettingsRouteContext,
} from "./site-settings";
import {
  resolveSiteStyle,
  siteCssPrefix,
  type SiteStyleData,
} from "./site-style";
import { readSiteStyleRecord } from "./site-style-record";
import {
  readStoredSiteStyleVersioned,
  SITE_STYLE_SLUG,
  type SiteStyleReader,
} from "./site-style-storage";
import { retryOnStale } from "./stale-retry";
import { readStoredJson } from "./stored-json";
import {
  isIdentityKey,
  sharedStylesUsing,
  variablesAsked,
  variablesUsing,
  type VariablesAsked,
} from "./token-usage";
import { indexIsWhole } from "./usage-index-health";

/**
 * The bound on a prefix sent, before the engine judges it: far above any
 * prefix it accepts, so only the engine refuses a real one, and small enough
 * that a body cannot make the judgement scan an unbounded string.
 */
const PREFIX_SENT_MAX = 256;

const PrefixBody = z.strictObject({
  prefix: z.string().max(PREFIX_SENT_MAX),
  // Count what the change would leave naming the old prefix, and save nothing.
  dryRun: z.boolean().optional(),
});

/**
 * A question about the site's variables that asks only for the custom
 * properties they are written under, not their identities: what CSS text
 * holds (`var()`), which a prefix change leaves pointing at nothing, where a
 * `$token` reference is compiled under the new prefix and follows it.
 */
function propertiesOnly(asked: VariablesAsked): VariablesAsked {
  return {
    keys: asked.keys.filter(key => !isIdentityKey(key)),
    identitiesIn: found =>
      asked.identitiesIn([...found].filter(key => !isIdentityKey(key))),
  };
}

/** The count a dry run answers with: the places, and whether all were read. */
export interface OldPrefixUses {
  readonly count: number;
  readonly complete: boolean;
}

/**
 * The places that name one of the site's variables through `var()` under
 * `prefix`: the site's variables whose values do (a shadow variable's
 * colour), the shared styles whose own styles do, and the documents the
 * variable usage index records doing so. Each is counted once however many
 * such names it holds. Read-only: a prefix change rewrites none of them.
 *
 * The same question the variable removal asks (`variablesAsked`), keyed on
 * the properties alone, so a count here and a "used by" there agree on what
 * names a variable. Without the index the documents are not counted, and the
 * answer says it is incomplete.
 */
export async function oldPrefixUses(
  style: SiteStyleData,
  prefix: string,
  usage: UsageReader | undefined
): Promise<OldPrefixUses> {
  // Every tier merged, the engine's defaults included: a built-in colour
  // named through `var()` is lost by a prefix change just the same.
  const variables = resolveSiteTokens(style.tokens);
  const asked = propertiesOnly(
    variablesAsked(variables.tokens.map(tokenIdentity), prefix)
  );
  const naming = siteStyleNaming(variables, style.classes ?? [], asked);
  if (usage === undefined) return { count: naming.size, complete: false };
  const documents = await documentsNaming(usage, asked);
  for (const key of documents.named) naming.add(key);
  return {
    count: naming.size + documents.unnamed,
    complete: documents.complete,
  };
}

/** The variable usage index, as the count reads it. */
type UsageReader = Pick<
  SharedStyleUsageSource,
  "health" | "documentsUsingEach"
>;

/**
 * The site's variables and shared styles whose own CSS text names a
 * variable asked about, each by a key of its own kind.
 */
function siteStyleNaming(
  variables: SiteTokenSet,
  classes: readonly unknown[],
  asked: VariablesAsked
): Set<string> {
  const naming = new Set<string>();
  for (const namers of variablesUsing(variables, asked).values()) {
    for (const namer of namers) naming.add(`variable:${namer.id}`);
  }
  for (const styles of sharedStylesUsing(classes, asked).values()) {
    for (const shared of styles) {
      naming.add(`style:${shared.blockType ?? ""}:${shared.id}`);
    }
  }
  return naming;
}

/**
 * The documents the usage index records naming a variable asked about: each
 * named one by key, the rows naming no document counted apart (one cannot be
 * told from another), and whether the index could answer for every page.
 */
async function documentsNaming(
  usage: UsageReader,
  asked: VariablesAsked
): Promise<{ named: Set<string>; unnamed: number; complete: boolean }> {
  const health = await usage.health();
  const found = await usage.documentsUsingEach(asked.keys, health);
  const named = new Set<string>();
  let unnamed = 0;
  let complete = indexIsWhole(health);
  for (const listing of found.values()) {
    complete &&= listing.complete;
    for (const entry of listing.collections) {
      for (const document of entry.documents) {
        if (document === null) unnamed += 1;
        else named.add(`document:${entry.collection}:${document}`);
      }
    }
  }
  return { named, unnamed, complete };
}

/** A refusal naming what is wrong with the prefix sent. */
function invalidPrefix(message: string): NextlyError {
  return NextlyError.validation({
    errors: [{ path: "prefix", code: "INVALID_VALUE", message }],
  });
}

/** The body, parsed and judged at the boundary: a prefix the engine takes. */
async function readPrefix(
  req: Request
): Promise<{ prefix: string; dryRun: boolean }> {
  let raw: unknown;
  try {
    raw = JSON.parse(await req.text()) as unknown;
  } catch {
    raw = undefined;
  }
  const parsed = PrefixBody.safeParse(raw);
  if (!parsed.success) throw invalidPrefix("The request is not a prefix.");
  // The engine's verdict and its reason, so what is refused here is exactly
  // what the compiler would refuse to write under.
  const { refusal } = resolveTokenPrefix(parsed.data.prefix);
  if (refusal !== undefined) throw invalidPrefix(refusal);
  return { prefix: parsed.data.prefix, dryRun: parsed.data.dryRun === true };
}

/**
 * The stored `tokens` section with `prefix` saved in it, or the saved one
 * cleared where `prefix` is the one the site uses without it (the code's, or
 * the default): only what differs from the code is stored, as for variables.
 */
function tokensWithPrefix(
  section: unknown,
  prefix: string,
  defaults: SiteStyleData | undefined
): Record<string, unknown> {
  const held = readStoredJson(section);
  // Every other part of the section kept as stored; a site with none yet
  // starts from the empty set the Single's field takes.
  const rest = Object.fromEntries(
    Object.entries(isPlainRecord(held) ? held : { tokens: [] }).filter(
      ([key]) => key !== "prefix"
    )
  );
  return prefix === siteCssPrefix(defaults, undefined).current
    ? rest
    : { ...rest, prefix };
}

/** The prefix a stored `tokens` section saves, if it saves one. */
function savedPrefixOf(section: unknown): string | undefined {
  const held = readStoredJson(section);
  return isPlainRecord(held) && typeof held.prefix === "string"
    ? held.prefix
    : undefined;
}

/** What the prefix route reads and writes through. */
type SiteCssPrefixDirectApi = SiteSettingsDirectApi & SiteStyleReader;

/**
 * Change the site's CSS variable prefix, or with `dryRun` count what the
 * change would leave naming the old one. Authorized by the route's declared
 * permission before this runs, and judged by the engine before anything is
 * read. The write is marked as Settings', the one door the Single lets
 * change the prefix, and sends the version it was made from: a save in
 * between is read again and the prefix set on what is stored then.
 */
async function writeSiteCssPrefix(
  req: Request,
  ctx: SiteSettingsRouteContext,
  nextly: SiteCssPrefixDirectApi,
  setup: {
    readonly defaults?: SiteStyleData;
    readonly usage?: UsageReader;
  }
): Promise<Response> {
  const { prefix, dryRun } = await readPrefix(req);
  const slug = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
  const read = () =>
    readStoredSiteStyleVersioned({ nextly, slug, overrideAccess: true });
  if (dryRun) {
    const { stored } = await read();
    const style = resolveSiteStyle(setup.defaults, readSiteStyleRecord(stored));
    const before = siteCssPrefix(setup.defaults, readSiteStyleRecord(stored));
    const uses =
      prefix === before.current
        ? { count: 0, complete: true }
        : await oldPrefixUses(style, before.current, setup.usage);
    return respondMutation<SiteCssPrefixDryRun>(
      "Nothing was saved: this is what changing the prefix would leave behind.",
      {
        dryRun: true,
        prefix,
        oldPrefixUses: uses.count,
        usesComplete: uses.complete,
      }
    );
  }
  const after = await retryOnStale(read, async ({ stored, rev }) => {
    const tokens = tokensWithPrefix(stored.tokens, prefix, setup.defaults);
    // Nothing to store where the saved prefix already stands, a site with
    // no saved variables included: no write, no version.
    if (savedPrefixOf(stored.tokens) !== savedPrefixOf(tokens)) {
      await writeSiteStyle(
        nextly,
        ctx,
        { tokens },
        versionToWrite(rev === undefined ? stored : { ...stored, version: rev })
      );
    }
    return siteCssPrefix(
      setup.defaults,
      readSiteStyleRecord({ ...stored, tokens })
    );
  });
  return respondMutation<SiteCssPrefixSaved>(
    "The CSS variable prefix was changed.",
    { prefix: after }
  );
}

/**
 * The route Settings changes the site's CSS variable prefix through, and
 * asks first what the change would leave naming the old one (`dryRun`),
 * under the site permission.
 */
export function siteCssPrefixRoute(setup: {
  readonly defaults?: SiteStyleData;
  /** The variable usage index, as this request reads it. */
  readonly usage?: (ctx: PluginRouteContext) => SharedStyleUsageSource;
}): {
  method: "POST";
  path: string;
  requiredPermission: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: SITE_CSS_PREFIX_ROUTE_PATH,
    requiredPermission: MANAGE_SITE_PERMISSION,
    handler: async (req, ctx) =>
      writeSiteCssPrefix(req, ctx, await getCachedNextly(), {
        ...(setup.defaults === undefined ? {} : { defaults: setup.defaults }),
        ...(setup.usage === undefined ? {} : { usage: setup.usage(ctx) }),
      }),
  };
}
