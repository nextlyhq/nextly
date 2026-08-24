/**
 * Preview links: minting one, and revoking all of them.
 *
 *   POST /api/nextly/preview-links          -> mint a link for one entry
 *   POST /api/nextly/preview-links/revoke   -> invalidate every link ever issued
 *
 * **Minting is gated on `update` for the collection, not on `publish`.**
 * Someone who can edit an entry already sees its draft in the admin, so sharing
 * a link to that same draft grants nothing they could not already show by
 * other means. Requiring `publish` would break the workflow this exists for,
 * where an editor who cannot publish shows a draft to a reviewer.
 *
 * **Revoking is gated on `manage settings`**, because the generation it moves
 * is site-wide: one editor revoking would otherwise break every other editor's
 * outstanding links.
 *
 * @module api/preview-links
 */

import { z } from "zod";

import { signPreviewToken } from "../auth/preview/preview-token";
import { buildUserContext } from "../auth/user-context";
import { container, getService } from "../di";
import type { NextlyServiceConfig } from "../di/register";
import { resolvePreviewRedirect } from "../domains/collections/services/preview-redirect-resolver";
import { hasPreviewConfigured } from "../domains/collections/services/preview-url-resolver";
import { resolvePreviewRoute } from "../domains/preview/route-config";
import { resolvePreviewSiteUrl } from "../domains/preview/site-url";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { env } from "../lib/env";
import type { GeneralSettingsService } from "../services/general-settings/general-settings-service";
import { resolveRoleSlugs } from "../services/lib/permissions";

import { assertEntryPreviewable } from "./preview-access";
import { previewDeclarationFor } from "./preview-url";
import { respondMutation } from "./response-shapes";
import {
  requireRouteCollectionAccess,
  requireRoutePermission,
} from "./route-auth";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

/**
 * The upper bound on how long a link stays usable.
 *
 * A preview link is a bearer credential that travels by email and chat, so its
 * lifetime is the window in which a forwarded message is still a working key.
 * A caller may ask for less; asking for more is refused rather than clamped,
 * because silently shortening a link an editor believes lasts a week is worse
 * than telling them it does not.
 */
const MAX_TTL_SECONDS = 7 * 24 * 60 * 60;

const mintSchema = z.object({
  collection: z.string().min(1),
  entryId: z.string().min(1),
  locale: z.string().min(1).optional(),
  ttlSeconds: z.number().int().positive().max(MAX_TTL_SECONDS).optional(),
});

async function settingsService(): Promise<GeneralSettingsService> {
  await getCachedNextly();
  return container.get<GeneralSettingsService>("generalSettingsService");
}

/**
 * The key preview tokens are signed with.
 *
 * Read here rather than at module load so a misconfigured deployment fails the
 * one request that needs it, with a remedy, instead of refusing to boot.
 */
function previewSigningSecret(): string {
  const secret = env.NEXTLY_SECRET;
  if (!secret) {
    throw NextlyError.internal({
      logContext: {
        reason: "preview-link-no-secret",
        remedy:
          "Set NEXTLY_SECRET. Preview links are signed with a key derived " +
          "from it, and without one an unsigned link would be forgeable by " +
          "anyone who can guess an entry id.",
      },
    });
  }
  return secret;
}

/**
 * The link a reviewer opens, built with URL semantics rather than by
 * concatenating strings.
 *
 * A configured site URL may legitimately carry a path, a query or a fragment —
 * the settings schema accepts all three. Gluing the route onto the end of one
 * puts the path INSIDE whichever component came last: a site URL of
 * `https://site.example/base?tenant=a` becomes
 * `https://site.example/base?tenant=a/api/preview?token=…`, which never reaches
 * the preview route and arrives carrying no token at all. Asking the URL parser
 * to place the pathname and the parameter cannot make that mistake, and it
 * keeps a site URL's own query intact rather than silently discarding it.
 *
 * `null` only when the site's address is available NOWHERE — neither the stored
 * setting nor the application's own URL. A relative URL would be resolved
 * against whatever origin the admin is served from, which is not the site's on
 * any deployment that separates them.
 */
function previewLinkUrl({
  siteUrl,
  route,
  token,
}: {
  siteUrl: string | null;
  route: string;
  token: string;
}): string | null {
  if (siteUrl === null) return null;
  try {
    const base = new URL(siteUrl);
    // Joined as PATHS, so a site URL mounted under a sub-path keeps it.
    base.pathname = `${base.pathname.replace(/\/+$/, "")}${route}`;
    base.searchParams.set("token", token);
    return base.toString();
  } catch {
    // An unparseable site URL is a configuration fault the editor cannot act
    // on, and answering with a broken link would be worse than answering none.
    return null;
  }
}

/**
 * POST /api/nextly/preview-links
 *
 * Mints a link scoped to one entry. Auth: `update` on that collection.
 */
export const mintPreviewLink = withErrorHandler(async (req: Request) => {
  const body: unknown = await req.json().catch(() => undefined);
  const parsed = mintSchema.safeParse(body);
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  const { collection, entryId, locale, ttlSeconds } = parsed.data;

  // The gate is per COLLECTION, so a caller who may edit posts cannot mint a
  // link into a collection they have no access to by naming it here.
  const auth = await requireRouteCollectionAccess(req, "update", collection);

  // A link is minted BY A PERSON, and an API key is not one.
  //
  // The token records who to render the draft as, and the page then judges
  // every field by that person's rules. A key is authorized on the grants
  // stamped on the KEY — deliberately, so a narrow key cannot mint on the
  // strength of its owner's account — but the only identity it could record is
  // that owner, whose access is exactly what the key was scoped away from. The
  // link would then render under permissions the request never had: a key
  // allowed to update an entry but denied one of its fields would hand its
  // recipient that field.
  //
  // Refused rather than approximated. The honest alternative is to record the
  // KEY and evaluate field rules against its own grants, which means teaching
  // the field-level registry to take a grant set instead of resolving one from
  // a user id — a change to a primitive every read and write shares, not
  // something to infer from a preview link.
  if (auth.authMethod === "api-key") {
    throw NextlyError.forbidden({
      logContext: {
        reason: "preview-link-minted-by-api-key",
        remedy:
          "A preview link records whose permissions the draft is rendered " +
          "through, and a key names no person. Mint it from a signed-in " +
          "session.",
      },
    });
  }

  // That gate is one granularity coarser than what it hands out: it answers
  // "may this caller edit this COLLECTION", while the token names one ENTRY
  // and confers a read of it. Where a collection carries a row-level rule the
  // two diverge, and the coarse answer alone would let a caller bounded to
  // their own documents mint a working credential for someone else's.
  //
  // So the entry is authorized here too, against the gate that serves the real
  // read. Booted first because that gate resolves services from the container,
  // and on a cold process the permission lookup itself needs them registered.
  await getCachedNextly();
  const roles = await resolveRoleSlugs(auth);

  // Authorized through the gate that serves collection reads and writes, so the
  // verdict here is the verdict the bearer's own read will reach. It asks two
  // questions the previous by-id probe could not express: whether the entry is
  // visible at all INCLUDING one never published, and whether this caller may
  // edit it — which is what the draft overlay requires before surfacing the
  // working draft the token hands out.
  await assertEntryPreviewable(
    collection,
    entryId,
    buildUserContext({
      claims: auth.claims,
      id: auth.userId,
      name: auth.userName,
      email: auth.userEmail,
      roles,
    })
  );

  // Refused BEFORE a token is signed, because a link that cannot land is worse
  // than no link: the reviewer who opens it sees a 404 indistinguishable from
  // an expired one, and the editor who sent it was told it worked.
  //
  // The button that reaches this endpoint is shown whether or not a collection
  // declares a preview URL, and that stays true — a draft is worth sharing
  // either way, and hiding the control would leave an editor with a feature
  // that vanished and no way to learn why. Refusing here puts the explanation
  // in front of the person who hit the problem instead.
  //
  // `hasPreviewConfigured` is asked rather than the two spellings compared
  // again here: it is the same predicate the resolver and the stored
  // `hasPreview` projection use, so a collection cannot be shareable by one
  // rule and unresolvable by another.
  const declaration = await previewDeclarationFor(collection);

  // Asked of THIS ENTRY, not only of the collection.
  //
  // A declaration is necessary and not sufficient: `preview.url` may return
  // `null` for a document it cannot address yet, and a `urlTemplate` placeholder
  // may name a field that is still empty. Checking only that a declaration
  // exists lets both mint successfully and 404 at the redirect — which is the
  // failure this refusal exists to remove, reappearing one level down.
  //
  // Resolved through the SAME function the preview route will call, so the
  // answer here and the answer the reviewer gets cannot disagree. The entry is
  // already authorized at this point, which is why a trusted read is correct.
  const target = hasPreviewConfigured(declaration)
    ? await resolvePreviewRedirect(
        { collection, entryId, ...(locale === undefined ? {} : { locale }) },
        {
          loadEntry: async (name, id, entryLocale) => {
            const read = await getService("collectionsHandler").getEntry({
              collectionName: name,
              entryId: id,
              depth: 0,
              overrideAccess: true,
              status: "all",
              ...(entryLocale === undefined ? {} : { locale: entryLocale }),
              includeWorkingDraft: true,
            });
            return read.success && read.data !== null
              ? (read.data as Record<string, unknown>)
              : null;
          },
          // Already resolved above, so this hands back the value rather than
          // fetching it again — the resolver takes a loader and this call site
          // happens to have the answer.
          loadDeclaration: () => Promise.resolve(declaration),
          loadSiteUrl: async () =>
            resolvePreviewSiteUrl(
              await (await settingsService()).getSettings().then(s => s.siteUrl)
            ),
        }
      )
    : null;

  if (target === null) {
    throw NextlyError.conflict({
      reason: "state",
      message: hasPreviewConfigured(declaration)
        ? "This entry has no preview address yet, so a shared link would have " +
          "nowhere to open. Filling in the fields its preview URL is built " +
          "from — usually the slug — makes it shareable."
        : "This collection has no preview URL configured, so a shared link " +
          "would have nowhere to open. A developer can add one to the " +
          "collection before links can be shared.",
      logContext: {
        reason: hasPreviewConfigured(declaration)
          ? "preview-link-entry-has-no-preview-target"
          : "preview-link-collection-has-no-preview-url",
        remedy: hasPreviewConfigured(declaration)
          ? "The collection's preview declaration returned no address for this " +
            "entry. A `url` function answering null, or a `urlTemplate` whose " +
            "placeholder field is empty, both mean 'not previewable yet'."
          : "Add `admin.preview.url` (code-first) or `admin.preview.urlTemplate` " +
            "(UI-created) to this collection. It answers where an entry is served " +
            "on the site, which nothing outside the application can know.",
        collection,
      },
    });
  }

  const generation = await (
    await settingsService()
  ).getPreviewTokenGeneration();

  const { token, expiresAt } = await signPreviewToken(
    { collection, entryId, ...(locale === undefined ? {} : { locale }) },
    previewSigningSecret(),
    {
      generation,
      // Recorded so the page renders through the SHARER's field-level
      // permissions. Without it the render skips those rules entirely and the
      // recipient sees fields the sharer cannot — which makes a link a way to
      // read past your own permissions by sending one to yourself.
      minter: auth.userId,
      ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
    }
  );

  // The finished URL as well as the token.
  //
  // Both halves are visible from here and from nowhere else. The site URL lives
  // in settings, which the `editor` and `author` presets cannot read; the mount
  // lives in the application's config, which the browser cannot see at all. So
  // the admin had no way to build this correctly and assumed a default, which
  // is why an application that mounted the route elsewhere handed its reviewers
  // a link that answered 404.
  //
  // `null` when no site URL is set, never a relative URL: a relative one would
  // be resolved against whatever origin the admin is served from, which is not
  // the site. The token is still returned, because it is what the link is —
  // withholding it would break preview outright on a site that never set a
  // URL, rather than degrading the one thing that needs the host.
  const settings = await (await settingsService()).getSettings();
  const siteUrl = resolvePreviewSiteUrl(settings.siteUrl);
  const url = previewLinkUrl({
    siteUrl,
    route: resolvePreviewRoute(
      container.get<NextlyServiceConfig>("config")?.preview
    ),
    token,
  });

  return respondMutation("Preview link created", {
    token,
    url,
    expiresAt: expiresAt.toISOString(),
  });
});

/**
 * POST /api/nextly/preview-links/revoke
 *
 * Invalidates every preview link ever issued, including sessions already in
 * flight. Auth: `manage settings`, because the generation is site-wide.
 */
export const revokePreviewLinks = withErrorHandler(async (req: Request) => {
  await requireRoutePermission(req, "manage", "settings");
  const generation = await (await settingsService()).revokeAllPreviewTokens();
  return respondMutation("Preview links revoked", { generation });
});
