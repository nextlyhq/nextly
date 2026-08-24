/**
 * Resolving where an entry previews.
 *
 *   POST /api/nextly/preview-url  -> the preview URL for one entry's data
 *
 * **Gated on `read` for the collection, which is deliberately weaker than the
 * `update` that guards minting a preview LINK.** The two hand out different
 * things. A link is a bearer credential: it carries a signed token that grants
 * whoever holds it a read of a draft, so it is gated at the level of someone who
 * may edit that draft. This endpoint returns a URL and no credential — opening
 * it shows the caller exactly what their own session already permits, and shows
 * a stranger nothing that was not already public. Requiring `update` here would
 * hide the preview button from a reviewer who may read a collection but not
 * change it, which is a role the workflow exists to serve.
 *
 * **The site URL travels in the response, and that is the point rather than a
 * leak.** `settings` is a system resource the `editor` and `author` presets do
 * not grant, so those roles cannot read the configured site URL directly — and
 * they are exactly who previews content. Answering with a finished absolute URL
 * is what lets them preview without being handed a settings read they should not
 * have. The response discloses the site's own public address, which anyone who
 * visits the site already knows.
 *
 * @module api/preview-url
 */

import { z } from "zod";

import { container } from "../di";
import type { NextlyServiceConfig } from "../di/register";
import type { CollectionRegistryService } from "../domains/collections/services/collection-registry-service";
import {
  resolvePreviewUrl,
  type PreviewDeclaration,
} from "../domains/collections/services/preview-url-resolver";
import { resolvePreviewSiteUrl } from "../domains/preview/site-url";
import type { SingleRegistryService } from "../domains/singles/services/single-registry-service";
import { getCachedNextly } from "../init";
import type { GeneralSettingsService } from "../services/general-settings/general-settings-service";

import { respondData } from "./response-shapes";
import { requireRouteCollectionAccess } from "./route-auth";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

/**
 * The entry travels in the request body rather than being loaded by id.
 *
 * An editor previews what is on screen, which includes edits not yet saved — so
 * the values that decide the URL are the form's, not the row's. Loading the row
 * here would resolve a URL for the last saved state and quietly show the wrong
 * page, which is worse than not offering the button.
 *
 * The data is the caller's own: they are sending back what they are already
 * looking at, and the resolved URL returns only to them. So this widens no read.
 */
const resolveSchema = z.object({
  collection: z.string().min(1),
  entry: z.record(z.string(), z.unknown()),
});

async function settingsService(): Promise<GeneralSettingsService> {
  await getCachedNextly();
  return container.get<GeneralSettingsService>("generalSettingsService");
}

/**
 * Read the preview declaration for a collection from whichever authoring path
 * defined it.
 *
 * A code-first collection holds a `url` function that exists only in the
 * server's module graph; a UI-created one holds a `urlTemplate` string in the
 * registry. Both are read here and handed to the one resolver, so the caller
 * never branches on which kind of collection it is looking at.
 *
 * **The authored config is consulted FIRST, and the order is load-bearing.** A
 * code-first collection is also synced into the registry, but the function
 * cannot survive that trip — its stored record carries `hasPreview` and the
 * presentation options and nothing that can produce a URL. Reading the registry
 * first would therefore find a declaration for exactly those collections and
 * find it empty, and the resolver would correctly report `notConfigured` for a
 * collection whose preview works.
 */
export async function previewDeclarationFor(
  collection: string
): Promise<PreviewDeclaration | undefined> {
  await getCachedNextly();

  const config = container.get<NextlyServiceConfig>("config");
  const authored = config?.collections?.find(c => c.slug === collection);
  if (authored?.admin?.preview) return authored.admin.preview;

  const registry = container.get<CollectionRegistryService>(
    "collectionRegistryService"
  );
  const stored = await registry.getCollectionBySlug(collection);
  return stored?.admin?.preview;
}

/**
 * Read the preview declaration for a Single.
 *
 * The mirror of {@link previewDeclarationFor}, and separate for the same reason
 * the resolvers are: a Single is addressed by slug with no id, so the lookup
 * differs even though what is done with the answer does not.
 *
 * The AUTHORED config is consulted first, and the order is load-bearing for the
 * identical reason: a code-first Single is synced into the registry, but the
 * `url` function cannot survive that trip, so reading the registry first would
 * find a declaration for exactly those Singles and find it empty.
 */
export async function singlePreviewDeclarationFor(
  slug: string
): Promise<PreviewDeclaration | undefined> {
  await getCachedNextly();

  const config = container.get<NextlyServiceConfig>("config");
  const authored = config?.singles?.find(s => s.slug === slug);
  if (authored?.admin?.preview) return authored.admin.preview;

  const registry = container.get<SingleRegistryService>(
    "singleRegistryService"
  );
  const stored = await registry.getSingleBySlug(slug);
  return stored?.admin?.preview;
}

/**
 * A Single's document, read the way a preview redirect needs it.
 *
 * Shared by the minting endpoint and the preview route's own default, because
 * they are asking one question — where does this Single's DRAFT live — and two
 * implementations of it would drift into minting a link at one address and
 * landing it at another.
 *
 * Trusted, because both callers are already past their own authorization: the
 * mint has checked `update` on the Single, and whoever follows a link carries a
 * signed token that recorded that verdict. What this produces is a path, never
 * content.
 *
 * The working draft's values rather than the published row's, and every status,
 * because an editor sharing a draft is sharing what the draft says — and a
 * Single that has never been published is exactly the one a preview link is most
 * often minted for.
 */
export async function loadSingleForPreview(
  slug: string,
  locale: string | undefined
): Promise<Record<string, unknown> | null> {
  const nextly = await getCachedNextly();
  const document = await nextly.findSingle({
    slug,
    overrideAccess: true,
    draft: true,
    status: "all",
    // No relationships: every field a preview URL can be built from is scalar,
    // so expanding would read further collections to answer a question none of
    // them contribute to.
    depth: 0,
    ...(locale === undefined ? {} : { locale }),
  });
  return document ?? null;
}

/**
 * POST /api/nextly/preview-url
 *
 * Answers with one of the resolver's states, so a caller can tell "this
 * collection has no preview" from "this entry is not previewable yet" from "no
 * site URL is configured". Collapsing them into a nullable string is what let an
 * earlier attempt fall back to the admin's own origin and hand out a link to the
 * wrong host.
 */
export const resolveEntryPreviewUrl = withErrorHandler(async (req: Request) => {
  const body: unknown = await req.json().catch(() => undefined);
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  const { collection, entry } = parsed.data;

  // Per COLLECTION, so naming a collection the caller cannot read does not
  // resolve a URL into it. Row-level rules are not consulted: the entry data
  // came from the caller, so no row they cannot already see is involved.
  await requireRouteCollectionAccess(req, "read", collection);

  const [preview, settings] = await Promise.all([
    previewDeclarationFor(collection),
    settingsService().then(service => service.getSettings()),
  ]);

  return respondData(
    resolvePreviewUrl({
      preview,
      entry,
      siteUrl: resolvePreviewSiteUrl(settings.siteUrl),
    })
  );
});
