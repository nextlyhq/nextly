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
  respondMutation,
} from "@nextlyhq/plugin-sdk";

import type { SiteSettingsRouteContext } from "../site-settings";
import { checkStoredFonts, unreadableStoredFonts } from "../site-style-record";
import { SITE_STYLE_SLUG } from "../site-style-storage";

import { parseCatalogue, parseFontMetadata } from "./catalogue";
import {
  SITE_FONTS_CATALOGUE_ROUTE_PATH,
  SITE_FONTS_ROUTE_PATH,
  type AddSiteFontAnswer,
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
        families: parsed.families,
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

  const adding = new Set<string>();

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
      JSON.parse(
        new TextDecoder().decode(
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
          )
        )
      )
    );
    if (meta === undefined) throw notInCatalogue();
    const api = await nextly();
    const slug = ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG;
    const stored = await storedFonts(api, slug);
    const plan = planFontAdd(
      request,
      meta,
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
    const added = await storeAll(api, slug, downloads, ctx.user);
    return respondMutation<AddSiteFontAnswer>(
      `${meta.family} was added to this site.`,
      { added, skipped: plan.skipped }
    );
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
      const bytes = await fetchFromCatalogue(
        fetch,
        file.url,
        rules({
          expect: "woff2",
          maxBytes: fonts.limits.bytesPerFile,
          messages: ADD_MESSAGES,
          signal,
        })
      );
      total += bytes.byteLength;
      if (total > fonts.limits.bytesPerAdd) {
        throw NextlyError.validation({
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
        return Response.json(await readCatalogue(ctx), {
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

/** The body as JSON, or nothing when it is not. */
async function bodyOf(req: Request): Promise<unknown> {
  try {
    return JSON.parse(await req.text()) as unknown;
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
): Promise<{ raw: readonly unknown[]; faces: readonly FontFaceDef[] }> {
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
  return { raw, faces: checkStoredFonts(raw).value ?? [] };
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
    return undefined;
  }
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
  user: { id: string } | null
): Promise<FontFaceDef[]> {
  const asUser = user === null ? {} : { user: { id: user.id } };
  const folder = await fontsFolder(api, user);
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
    // so a face another surface stored meanwhile is kept.
    const { raw } = await storedFonts(api, slug);
    await api.updateSingle({
      slug,
      data: { fonts: [...raw, ...added] },
      overrideAccess: true,
      ...asUser,
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
