/**
 * The two routes behind Design → Fonts' catalogue: read the Google Fonts
 * catalogue, and add a family to the site.
 *
 * Adding a font downloads its files on the SERVER, into the site's media
 * through the same storage path uploads use, and registers faces that point at
 * the site's own addresses. Visitors' browsers then never contact Google or
 * the catalogue, and the API can add a font without a browser.
 *
 * What makes reaching another server safe here:
 * - the site-design permission is checked before the body is read or anything
 *   is fetched;
 * - the request names a family, weights, styles and scripts, and the server
 *   builds every address ({@link site-fonts/plan});
 * - every fetch goes through {@link site-fonts/guarded-fetch}: the configured
 *   hosts only, no redirect off them, caps on size and time, and the woff2
 *   signature;
 * - the plan is capped before the first download, and an add is all or
 *   nothing: a failure deletes every file it stored.
 *
 * @module site-fonts/routes
 */
import type { FontFaceDef } from "@nextlyhq/blocks-engine";
import {
  getCachedNextly,
  NextlyError,
  respondList,
  respondMutation,
} from "@nextlyhq/plugin-sdk";

import { documentVersionOf, withVersionFrom } from "../document-version";
import type { SiteSettingsRouteContext } from "../site-settings";
import { checkStoredFonts, unreadableStoredFonts } from "../site-style-record";
import { SITE_STYLE_SLUG } from "../site-style-storage";

import {
  parseCatalogue,
  parseCatalogueStats,
  parseFontMetadata,
  parseVariableVersion,
  withPopularity,
} from "./catalogue";
import {
  SITE_FONTS_CATALOGUE_ROUTE_PATH,
  SITE_FONTS_ROUTE_PATH,
  type AddSiteFontAnswer,
  type FontCatalogueList,
  type FontCatalogueRead,
} from "./contract";
import {
  fetchFromCatalogue,
  type CatalogueFetch,
  type CatalogueFetchRules,
} from "./guarded-fetch";
import type { ResolvedFontOptions } from "./options";
import { planFontAdd, readAddFontBody, type PlannedFile } from "./plan";

/** A route's context, with the outbound fetch the plugin declared. */
interface SiteFontsRouteContext extends SiteSettingsRouteContext {
  fetch?: CatalogueFetch;
}

/** The slice of the Direct API an add stores and registers through. */
export interface SiteFontsDirectApi {
  findSingle(args: { slug: string; overrideAccess: boolean }): Promise<unknown>;
  updateSingle(args: {
    slug: string;
    data: Record<string, unknown>;
    overrideAccess: boolean;
    user?: { id: string };
  }): Promise<unknown>;
  media: {
    upload(args: {
      file: { data: Buffer; name: string; mimetype: string; size: number };
      altText?: string;
      folder?: string;
      overrideAccess: boolean;
      user?: { id: string };
    }): Promise<{ id: string }>;
    delete(args: { id: string; overrideAccess: boolean }): Promise<unknown>;
    folders: {
      list(args: {
        overrideAccess: boolean;
      }): Promise<ReadonlyArray<{ id: string; name: string }>>;
      create(args: {
        name: string;
        overrideAccess: boolean;
        user?: { id: string };
      }): Promise<{ id: string }>;
    };
  };
}

/** What the routes are built from; the Direct API is a seam for tests. */
export interface SiteFontsRouteSetup {
  readonly fonts: ResolvedFontOptions;
  readonly nextly?: () => Promise<SiteFontsDirectApi>;
  readonly now?: () => number;
}

type Route = {
  method: "GET" | "POST";
  path: string;
  handler: (req: Request, ctx: SiteFontsRouteContext) => Promise<Response>;
};

/** How long a catalogue read is served before it is read again: a day. */
const CATALOGUE_TTL_MS = 24 * 60 * 60 * 1000;

/** The most bytes the catalogue's list may have; it is about half a megabyte. */
const CATALOGUE_MAX_BYTES = 2 * 1024 * 1024;

/** The most bytes the catalogue's stats may have; they are about 600 KB. */
const STATS_MAX_BYTES = 2 * 1024 * 1024;

/** The most bytes one family's metadata may have. */
const METADATA_MAX_BYTES = 512 * 1024;

/** How long one whole add may take, every download included. */
const ADD_TIMEOUT_MS = 60_000;

/** How many adds one process runs at once. */
const MAX_ADDS_IN_FLIGHT = 2;

/** The media folder added fonts are stored in. */
const FONTS_FOLDER = "Fonts";

/** What an author is told when the catalogue's answer is refused or late. */
const ADD_MESSAGES = {
  refused:
    "Google Fonts sent something that isn’t a font file, so nothing was added.",
  unanswered:
    "Google Fonts didn’t answer in time. Nothing was added; try again.",
} as const;

const READ_MESSAGES = {
  refused: "Google Fonts sent something that isn’t a catalogue.",
  unanswered: "Google Fonts could not be reached.",
} as const;

/** Whether this process may reach plain http on localhost: tests only. */
function loopbackAllowed(): boolean {
  const mode = process.env.NODE_ENV;
  return mode === "development" || mode === "test";
}

/**
 * Refuse a caller who may not change the site's design. Asked of the
 * site-style Single by its resolved slug, so a renamed Single keeps its grant.
 */
async function assertMayChangeFonts(ctx: SiteFontsRouteContext): Promise<void> {
  const slug = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
  if (ctx.caller !== null && (await ctx.caller.can("update", slug))) return;
  throw new NextlyError({
    code: "FORBIDDEN",
    publicMessage: "You can’t change this site’s fonts.",
    logContext: { reason: "site-fonts-without-update-site-style" },
  });
}

/** The plugin's outbound fetch, which exists only when it declared hosts. */
function fetchOf(ctx: SiteFontsRouteContext): CatalogueFetch {
  if (ctx.fetch !== undefined) return ctx.fetch;
  throw NextlyError.serviceUnavailable({
    publicMessage: "Google Fonts could not be reached.",
    logMessage: "The page builder's routes were given no outbound fetch.",
  });
}

/**
 * The two routes, sharing one catalogue cache and one count of adds in flight.
 * Built once per plugin, so a test's plugin starts with neither.
 */
export function siteFontRoutes(setup: SiteFontsRouteSetup): Route[] {
  const { fonts } = setup;
  const now = setup.now ?? Date.now;
  const nextly =
    setup.nextly ??
    (async (): Promise<SiteFontsDirectApi> => getCachedNextly());
  const rules = (
    over: Pick<CatalogueFetchRules, "expect" | "maxBytes" | "messages"> &
      Partial<CatalogueFetchRules>
  ): CatalogueFetchRules => ({
    allowed: [fonts.api, fonts.files],
    allowLoopback: loopbackAllowed(),
    timeoutMs: fonts.limits.timeoutMs,
    ...over,
  });

  let cached: { read: FontCatalogueRead; at: number } | null = null;

  const readCatalogue = async (
    ctx: SiteFontsRouteContext
  ): Promise<FontCatalogueRead> => {
    if (cached !== null && now() - cached.at < CATALOGUE_TTL_MS) {
      return cached.read;
    }
    try {
      // The stats are asked for beside the list rather than after it, so a
      // read waits for the slower of the two, not both in turn.
      const popularity = readPopularity(ctx);
      const bytes = await fetchFromCatalogue(
        fetchOf(ctx),
        new URL("/v1/fonts?type=google", fonts.api).href,
        rules({
          expect: "json",
          maxBytes: CATALOGUE_MAX_BYTES,
          messages: READ_MESSAGES,
        })
      );
      const parsed = parseCatalogue(
        JSON.parse(new TextDecoder().decode(bytes))
      );
      if (parsed.unreadable === true) {
        throw NextlyError.serviceUnavailable({
          publicMessage: READ_MESSAGES.refused,
          logContext: { reason: "catalogue-not-a-list", host: fonts.api.host },
        });
      }
      const read: FontCatalogueRead = {
        families: withPopularity(parsed.families, await popularity),
        previewBase: fonts.files.origin,
        fetchedAt: new Date(now()).toISOString(),
      };
      cached = { read, at: now() };
      return read;
    } catch (error) {
      // The last good copy, rather than none, when a refresh fails: the
      // catalogue changes slowly and an author mid-browse loses nothing.
      if (cached !== null) return cached.read;
      if (NextlyError.is(error)) throw error;
      throw NextlyError.serviceUnavailable({
        publicMessage: READ_MESSAGES.refused,
        logContext: { reason: "catalogue-not-json", host: fonts.api.host },
      });
    }
  };

  /**
   * How popular each family is, or nothing when the stats cannot be had.
   *
   * Never a refusal: the order is a convenience, and the list is the answer
   * an author is waiting for, so a stats answer that fails, is late or is not
   * stats leaves the list unranked rather than failing it. Read only with the
   * list, so it is kept for the list's day and never read per editor open.
   */
  const readPopularity = async (
    ctx: SiteFontsRouteContext
  ): Promise<ReadonlyMap<string, number> | undefined> => {
    try {
      const bytes = await fetchFromCatalogue(
        fetchOf(ctx),
        new URL("/v1/stats", fonts.api).href,
        rules({
          expect: "json",
          maxBytes: STATS_MAX_BYTES,
          messages: READ_MESSAGES,
        })
      );
      return parseCatalogueStats(JSON.parse(new TextDecoder().decode(bytes)));
    } catch {
      return undefined;
    }
  };

  const adding = new Set<string>();
  /*
   * The read of the site's fonts and the write appending to it, one add at a
   * time. Two adds may run at once, and two that both read before either
   * writes would each write the list without the other's faces.
   */
  let appending: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const turn = appending.then(work, work);
    appending = turn.catch(() => undefined);
    return turn;
  };

  const addFont = async (
    req: Request,
    ctx: SiteFontsRouteContext
  ): Promise<Response> => {
    // The precondition, before the body is read or anything is fetched.
    await assertMayChangeFonts(ctx);
    const request = readAddFontBody(await bodyOf(req));
    if (adding.has(request.id) || adding.size >= MAX_ADDS_IN_FLIGHT) {
      throw NextlyError.serviceUnavailable({
        publicMessage:
          "Another font is being added to this site. Try again in a moment.",
        logContext: { reason: "site-font-add-busy", family: request.id },
      });
    }
    adding.add(request.id);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), ADD_TIMEOUT_MS);
    try {
      return await runAdd(request, ctx, deadline.signal);
    } finally {
      clearTimeout(timer);
      adding.delete(request.id);
    }
  };

  const runAdd = async (
    request: ReturnType<typeof readAddFontBody>,
    ctx: SiteFontsRouteContext,
    signal: AbortSignal
  ): Promise<Response> => {
    const fetch = fetchOf(ctx);
    const meta = parseFontMetadata(
      addJson(
        await fetchFromCatalogue(
          fetch,
          new URL(`/v1/fonts/${request.id}`, fonts.api).href,
          rules({
            expect: "json",
            maxBytes: METADATA_MAX_BYTES,
            messages: ADD_MESSAGES,
            signal,
            notFound: notInCatalogue,
          })
        ),
        fonts.api.host
      )
    );
    if (meta === undefined) throw notInCatalogue();
    const pinned = meta.variable
      ? { ...meta, version: await variableVersion(fetch, request.id, signal) }
      : meta;
    const api = await nextly();
    const slug = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
    const stored = await storedFonts(api, slug);
    const plan = planFontAdd(
      request,
      pinned,
      { filesBase: fonts.files.origin, maxFiles: fonts.limits.filesPerAdd },
      stored.faces
    );
    if (plan.files.length === 0) {
      return respondMutation<AddSiteFontAnswer>(
        `${meta.family} is already on this site.`,
        { added: [], skipped: plan.skipped }
      );
    }
    const downloads = await downloadAll(fetch, plan.files, signal);
    const added = await storeAll(api, slug, downloads, ctx.user, inTurn);
    return respondMutation<AddSiteFontAnswer>(
      `${meta.family} was added to this site.`,
      { added, skipped: plan.skipped }
    );
  };

  /**
   * The release a variable family's files are pinned to: the variable
   * package's own, which the catalogue versions apart from the static one.
   */
  const variableVersion = async (
    fetch: CatalogueFetch,
    id: string,
    signal: AbortSignal
  ): Promise<string> => {
    const version = parseVariableVersion(
      addJson(
        await fetchFromCatalogue(
          fetch,
          new URL(`/v1/version/${id}`, fonts.api).href,
          rules({
            expect: "json",
            maxBytes: METADATA_MAX_BYTES,
            messages: ADD_MESSAGES,
            signal,
            notFound: notInCatalogue,
          })
        ),
        fonts.api.host
      )
    );
    if (version === undefined) throw notInCatalogue();
    return version;
  };

  /** Every planned file, one at a time, under the per-add byte cap. */
  const downloadAll = async (
    fetch: CatalogueFetch,
    files: readonly PlannedFile[],
    signal: AbortSignal
  ): Promise<Array<{ file: PlannedFile; bytes: Uint8Array }>> => {
    const downloads: Array<{ file: PlannedFile; bytes: Uint8Array }> = [];
    let total = 0;
    for (const file of files) {
      // Each file may take what the add has left, so the read stops at the
      // add's total rather than after a whole file past it.
      const left = fonts.limits.bytesPerAdd - total;
      const bytes = await fetchFromCatalogue(
        fetch,
        file.url,
        rules({
          expect: "woff2",
          maxBytes: Math.min(fonts.limits.bytesPerFile, left),
          messages: ADD_MESSAGES,
          signal,
          ...(left < fonts.limits.bytesPerFile
            ? { tooLarge: overAddTotal }
            : {}),
        })
      );
      total += bytes.byteLength;
      downloads.push({ file, bytes });
    }
    return downloads;
  };

  return [
    {
      method: "GET",
      path: SITE_FONTS_CATALOGUE_ROUTE_PATH,
      handler: async (_req, ctx) => {
        await assertMayChangeFonts(ctx);
        const read = await readCatalogue(ctx);
        const total = read.families.length;
        // Every family on one page: the editor filters and pages the list
        // itself, so it reads the catalogue once. An empty catalogue has no
        // page, as any empty list reports, and the page size stays usable.
        const limit = Math.max(total, 1);
        const meta: FontCatalogueList["meta"] = {
          total,
          page: 1,
          limit,
          totalPages: Math.ceil(total / limit),
          hasNext: false,
          hasPrev: false,
          previewBase: read.previewBase,
          fetchedAt: read.fetchedAt,
        };
        return respondList([...read.families], meta, {
          headers: { "cache-control": "no-store" },
        });
      },
    },
    { method: "POST", path: SITE_FONTS_ROUTE_PATH, handler: addFont },
  ];
}

/** What an author is told about an id the catalogue does not have. */
function notInCatalogue(): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: "id",
        code: "INVALID_VALUE",
        message: "That isn’t a font in the catalogue.",
      },
    ],
  });
}

/**
 * The most bytes an add's body may have: a family's id, nine weights, two
 * styles and every script fit in far less.
 */
const MAX_ADD_BODY_BYTES = 8 * 1024;

/** An add's body past what any add can be. */
function bodyTooLarge(): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: "body",
        code: "INVALID_VALUE",
        message: "That request is larger than adding a font can be.",
      },
    ],
  });
}

/**
 * The body as JSON, or nothing when it is not. Read a chunk at a time and
 * abandoned the moment it passes the limit, so a caller cannot make the
 * server hold a body of any size before the request is judged.
 */
async function bodyOf(req: Request): Promise<unknown> {
  const stated = Number(req.headers.get("content-length"));
  if (Number.isFinite(stated) && stated > MAX_ADD_BODY_BYTES) {
    throw bodyTooLarge();
  }
  const reader = req.body?.getReader();
  if (reader === undefined) return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_ADD_BODY_BYTES) {
      // Cancelled without waiting: the body may be one half of a copy, whose
      // cancel settles only once the other half is cancelled too.
      void reader.cancel().catch(() => undefined);
      throw bodyTooLarge();
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The stored faces as written, and as read. An add refuses a site storing a
 * row this version cannot read, because appending would mean dropping it.
 */
async function storedFonts(
  api: SiteFontsDirectApi,
  slug: string
): Promise<{
  raw: readonly unknown[];
  faces: readonly FontFaceDef[];
  /** The Single's version as read, for a write made from this read. */
  rev: string | undefined;
}> {
  const doc = await api.findSingle({ slug, overrideAccess: true });
  const unreadable = unreadableStoredFonts(doc);
  if (unreadable.length > 0) {
    throw NextlyError.validation({
      errors: [
        {
          path: "fonts",
          code: "INVALID_VALUE",
          message: `This site stores a font this version cannot read (${unreadable.join(", ")}), and adding one would replace it. Repair or remove that entry first.`,
        },
      ],
    });
  }
  const raw =
    typeof doc === "object" &&
    doc !== null &&
    "fonts" in doc &&
    Array.isArray(doc.fonts)
      ? (doc.fonts as readonly unknown[])
      : [];
  return {
    raw,
    faces: checkStoredFonts(raw).value ?? [],
    rev: documentVersionOf(doc),
  };
}

/**
 * The "Fonts" folder's id, made on first use; the media root when either
 * step fails, since where the files sit is a convenience and not a reason to
 * refuse the add.
 */
async function fontsFolder(
  api: SiteFontsDirectApi,
  user: { id: string } | null
): Promise<string | undefined> {
  try {
    const folders = await api.media.folders.list({ overrideAccess: true });
    const found = folders.find(folder => folder.name === FONTS_FOLDER);
    if (found !== undefined) return found.id;
    const made = await api.media.folders.create({
      name: FONTS_FOLDER,
      overrideAccess: true,
      ...(user === null ? {} : { user: { id: user.id } }),
    });
    return made.id;
  } catch {
    // Made meanwhile by another surface, perhaps: look once more before
    // storing the files at the library's root.
    const again = await api.media.folders
      .list({ overrideAccess: true })
      .catch(() => []);
    return again.find(folder => folder.name === FONTS_FOLDER)?.id;
  }
}

/**
 * A json answer read during an add, or the add's refusal when it is not json
 * at all: a body cut short or garbled reaches the author as the catalogue's
 * fault, in the add's own words, rather than as an internal error.
 */
function addJson(bytes: Uint8Array, host: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw NextlyError.serviceUnavailable({
      publicMessage: ADD_MESSAGES.refused,
      logContext: { reason: "catalogue-not-json", host },
    });
  }
}

/** The files of one add, together, are past what one add may download. */
function overAddTotal(): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: "subsets",
        code: "INVALID_VALUE",
        message:
          "These files are larger than one add allows. Choose fewer weights or languages.",
      },
    ],
  });
}

/**
 * Store each file in the site's media, then append its faces to the stored
 * fonts. All or nothing: a failure deletes every file this add stored.
 *
 * The upload runs trusted: the permission was checked first and the bytes
 * come from the configured catalogue, not from the caller. The caller is
 * still recorded as the uploader.
 */
async function storeAll(
  api: SiteFontsDirectApi,
  slug: string,
  downloads: ReadonlyArray<{ file: PlannedFile; bytes: Uint8Array }>,
  user: { id: string } | null,
  inTurn: <T>(work: () => Promise<T>) => Promise<T>
): Promise<FontFaceDef[]> {
  const asUser = user === null ? {} : { user: { id: user.id } };
  // In turn with the other adds: two that both look before either makes the
  // folder would each make one.
  const folder = await inTurn(() => fontsFolder(api, user));
  const created: string[] = [];
  try {
    const added: FontFaceDef[] = [];
    for (const { file, bytes } of downloads) {
      const media = await api.media.upload({
        file: {
          data: Buffer.from(bytes),
          name: file.fileName,
          mimetype: "font/woff2",
          size: bytes.byteLength,
        },
        altText: file.altText,
        ...(folder === undefined ? {} : { folder }),
        overrideAccess: true,
        ...asUser,
      });
      created.push(media.id);
      added.push({
        ...file.face,
        src: [{ url: `/api/media/${media.id}/raw`, format: "woff2" }],
      });
    }
    // Read again just before writing, and appended to rather than replaced,
    // so a face another surface stored meanwhile is kept; in turn with the
    // other adds, so neither writes over the other's.
    await inTurn(async () => {
      const { raw, rev } = await storedFonts(api, slug);
      // With the version of that read, so a save between it and this write
      // refuses the write rather than dropping what the save stored.
      await api.updateSingle({
        slug,
        data: withVersionFrom({ fonts: [...raw, ...added] }, rev),
        overrideAccess: true,
        ...asUser,
      });
    });
    return added;
  } catch (error) {
    for (const id of created) {
      await api.media
        .delete({ id, overrideAccess: true })
        .catch(() => undefined);
    }
    throw error;
  }
}
