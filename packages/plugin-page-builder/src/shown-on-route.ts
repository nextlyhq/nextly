/**
 * `GET /singles/<slug>/shown-on`: where the builder shows one of a Single's
 * values, for that Single's side panel ("Shown on (from the builder)").
 *
 * Read from the index the bindings sweep keeps (`bindings-report/uses-store`)
 * in one query by the Single's slug, never by reading pages when the panel
 * opens. Each place is a document and the block in it, named as the reader
 * knows them: the document's title, and the block as Layers names it.
 *
 * Who may see what:
 * - The reader must be able to read the Single, or the route refuses: a
 *   Single they may not read is not theirs to ask about.
 * - A place is listed only when the reader may read its document, and the
 *   blocks field it is in, read as them (`bindings-report/readable`).
 * - The others are counted from the index, as the system, and answered as a
 *   number only: never a title, an id or an address of a document the
 *   reader may not open.
 *
 * `?all=1` lists every place the reader may open, for the full list behind
 * "and N more"; without it, the first ten.
 *
 * @module shown-on-route
 */
import {
  blockLabelFrom,
  type BlockRegistryReader,
} from "@nextlyhq/blocks-engine";
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import type {
  ReadableDocument,
  ReadableQuestion,
} from "./bindings-report/readable";
import type { SingleLabels } from "./bindings-report/route";
import type {
  BindingUsesReader,
  StoredUse,
} from "./bindings-report/uses-store";
import { parseRouteQuery } from "./route-query";
import {
  SHOWN_ON_FIRST,
  SHOWN_ON_ROUTE_PATH,
  type ShownOnAnswer,
  type ShownOnPlace,
} from "./shown-on-contract";

/**
 * How many uses one answer reads at most: far more than any Single is bound
 * in, and a bound on the one query whatever the site holds.
 */
const USES_READ_MAX = 2000;

/**
 * What a document's own search metadata is called where a block's name would
 * be, as the "Bindings to fix" report calls it.
 */
const PAGE_METADATA = "Page metadata";

/** What the route needs of the installed plugin. */
export interface ShownOnDeps {
  /** The index's reads; `null` before the plugin is installed. */
  readonly uses: () => BindingUsesReader | null;
  /** What the caller may read of each document, read as them. */
  readonly readable: (
    ctx: PluginRouteContext,
    entries: readonly ReadableQuestion[]
  ) => Promise<ReadonlyMap<string, ReadableDocument>>;
  /** Whether the caller may read the Single, read as them. */
  readonly mayReadSingle: (
    ctx: PluginRouteContext,
    slug: string
  ) => Promise<boolean>;
  /** The admin's name for each of these Singles. */
  readonly singleLabels: (
    ctx: PluginRouteContext,
    slugs: ReadonlySet<string>
  ) => Promise<SingleLabels>;
  /**
   * Start the check of every document, through the caller's request, never
   * waiting for it: asked while the index has not been filled once.
   */
  readonly refresh: (ctx: PluginRouteContext) => void;
  /** The site's default language, the one the builder edits. */
  readonly defaultLocale: () => string | undefined;
  /** The site's block registry, whose labels name a block without its own. */
  readonly blocks: BlockRegistryReader;
}

/** One place, from the uses of one block of one document. */
interface Found {
  readonly key: string;
  readonly first: StoredUse;
  /** Whether a use of it is in the default language, or in no one language. */
  inDefault: boolean;
  readonly fields: Set<string>;
}

/** The query: `all=1` for every place. */
const shownOnQuery = z.object({ all: z.enum(["1"]).optional() });

/** The uses grouped by document and block, in the order they were read. */
function placesOf(
  uses: readonly StoredUse[],
  defaultLocale: string | undefined
): Found[] {
  const byKey = new Map<string, Found>();
  for (const use of uses) {
    const key = `${use.documentKey}\u0000${use.nodeId}`;
    const inDefault = use.locale === undefined || use.locale === defaultLocale;
    const held = byKey.get(key);
    if (held === undefined) {
      byKey.set(key, {
        key,
        first: use,
        inDefault,
        fields: new Set([use.blocksField]),
      });
    } else {
      held.inDefault ||= inDefault;
      held.fields.add(use.blocksField);
    }
  }
  return [...byKey.values()];
}

/** The documents the places are in, as the readable read asks of them. */
function questionsOf(places: readonly Found[]): ReadableQuestion[] {
  const byDocument = new Map<string, ReadableQuestion>();
  for (const place of places) {
    const { documentKey, kind, slug, documentId } = place.first;
    const rows = [...place.fields].map(blocksField => ({ blocksField }));
    const held = byDocument.get(documentKey);
    byDocument.set(documentKey, {
      documentKey,
      kind,
      slug,
      ...(documentId === undefined ? {} : { documentId }),
      rows: [...(held?.rows ?? []), ...rows],
    });
  }
  return [...byDocument.values()];
}

/** A blocks field's top-level field, which the readable read names. */
function topField(blocksField: string): string {
  return blocksField.split(".")[0] ?? "";
}

/** The block's name as Layers shows it: the author's, else its block's label. */
function blockNameOf(use: StoredUse, blocks: BlockRegistryReader): string {
  if (use.nodeId === "") return PAGE_METADATA;
  if (use.blockName !== undefined) return use.blockName;
  return blockLabelFrom(use.blockType, blocks.get(use.blockType));
}

/** One place as the reader is shown it. */
function shownPlace(
  place: Found,
  readable: ReadableDocument,
  singles: SingleLabels,
  blocks: BlockRegistryReader
): ShownOnPlace {
  const use = place.first;
  return {
    key: place.key,
    kind: use.kind,
    slug: use.slug,
    ...(use.documentId === undefined ? {} : { documentId: use.documentId }),
    place: use.place,
    title:
      use.kind === "single"
        ? (singles.get(use.slug) ?? readable.title)
        : readable.title,
    block: blockNameOf(use, blocks),
    nodeId: use.nodeId,
    blocksField: use.blocksField,
    ...(place.inDefault ? {} : { inAnotherLanguage: true as const }),
  };
}

/** By title, then block, as a person reads a list. */
function byTitle(a: ShownOnPlace, b: ShownOnPlace): number {
  return (
    a.title.localeCompare(b.title) ||
    a.block.localeCompare(b.block) ||
    a.key.localeCompare(b.key)
  );
}

/** Answer one Single's places, as the caller may see them. */
export async function readShownOn(
  slug: string,
  all: boolean,
  ctx: PluginRouteContext,
  deps: ShownOnDeps
): Promise<ShownOnAnswer> {
  if (slug === "" || !(await deps.mayReadSingle(ctx, slug))) {
    throw NextlyError.forbidden({
      logContext: { reason: "shown-on-single-not-readable" },
    });
  }
  const reader = deps.uses();
  // Before the plugin is installed the index has nothing to say yet.
  if (reader === null) {
    return { checking: true, places: [], more: 0, hidden: 0 };
  }
  const [uses, filled] = await Promise.all([
    reader.ofSingle(slug, USES_READ_MAX),
    reader.filled(),
  ]);
  if (!filled) deps.refresh(ctx);
  const places = placesOf(uses, deps.defaultLocale());
  const readable = await deps.readable(ctx, questionsOf(places));
  const singleDocuments = new Set(
    places.flatMap(place =>
      place.first.kind === "single" ? [place.first.slug] : []
    )
  );
  const singles =
    singleDocuments.size === 0
      ? new Map<string, string>()
      : await deps.singleLabels(ctx, singleDocuments);
  const visible: ShownOnPlace[] = [];
  for (const place of places) {
    const document = readable.get(place.first.documentKey);
    // Every field the block's uses are in must be one the reader may read.
    const open =
      document !== undefined &&
      [...place.fields].every(field => document.fields.has(topField(field)));
    if (open) visible.push(shownPlace(place, document, singles, deps.blocks));
  }
  visible.sort(byTitle);
  const listed = all ? visible : visible.slice(0, SHOWN_ON_FIRST);
  return {
    checking: !filled,
    places: listed,
    more: visible.length - listed.length,
    hidden: places.length - visible.length,
  };
}

/**
 * The route. Open to anyone signed in: the handler asks core's gate, as the
 * caller, whether they may read the Single, and reads each document as them.
 * `noStore` because the answer is one person's.
 */
export function shownOnRoute(deps: ShownOnDeps): {
  method: "GET";
  path: string;
  checksAccess: true;
  noStore: true;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "GET",
    path: SHOWN_ON_ROUTE_PATH,
    checksAccess: true, // The handler judges each caller.
    noStore: true,
    handler: async (req, ctx) => {
      const query = parseRouteQuery(req.url, ["all"], shownOnQuery, "shown on");
      const slug = ctx.params?.slug ?? "";
      return Response.json(
        await readShownOn(slug, query.all === "1", ctx, deps)
      );
    },
  };
}
