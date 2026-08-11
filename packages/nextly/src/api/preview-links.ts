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
import { container } from "../di";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { env } from "../lib/env";
import type { GeneralSettingsService } from "../services/general-settings/general-settings-service";
import { resolveRoleSlugs } from "../services/lib/permissions";

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
/**
 * Run an access-enforced read and report an unreadable entry as `null`.
 *
 * Two outcomes are deliberately collapsed: a row a row-level rule hides, and an
 * id that matches nothing. Both mean the caller gets no link, and answering them
 * differently would tell an unauthorized caller which entries exist.
 *
 * Only a not-found is translated. Any other failure keeps its own error, so a
 * broken database is not reported as an ordinary denial.
 */
async function readEntryAsCaller<T>(
  read: () => Promise<T | null>
): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (NextlyError.isNotFound(error)) return null;
    throw error;
  }
}

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

  // That gate is one granularity coarser than what it hands out: it answers
  // "may this caller edit this COLLECTION", while the token names one ENTRY
  // and confers a read of it. Where a collection carries a row-level rule the
  // two diverge, and the coarse answer alone would let a caller bounded to
  // their own documents mint a working credential for someone else's.
  //
  // So the entry is authorized here too, by reading it back as the caller:
  // enforced (`overrideAccess: false`) and with their identity, which is the
  // same evaluation the bearer's own read will face. A row this caller cannot
  // see yields no link, and an entry that does not exist yields no link
  // either, rather than a token for nothing.
  const nextly = await getCachedNextly();
  const roles = await resolveRoleSlugs(auth);
  // `findByID` reports an unreadable row by THROWING `NOT_FOUND`, not by
  // returning null: null comes back only under `disableErrors`, which would also
  // swallow a genuine internal failure and report it here as an ordinary denial.
  // So the not-found case is translated and everything else keeps its own status
  // — otherwise the throw skips the check below and the caller is told the entry
  // does not exist, which is both the wrong answer and a different one from the
  // answer a hidden row gets.
  const visible = await readEntryAsCaller(() =>
    nextly.findByID({
      collection,
      id: entryId,
      depth: 0,
      overrideAccess: false,
      // Built the one way a caller is built, so this probe reaches the verdict
      // the caller's own read would. Claims matter here specifically: a stored
      // `custom` rule that decides on one is absence-tolerant, so a probe that
      // dropped them would admit exactly the caller the rule refuses.
      user: buildUserContext({
        claims: auth.claims,
        id: auth.userId,
        name: auth.userName,
        email: auth.userEmail,
        roles,
      }),
    })
  );
  if (!visible) {
    throw NextlyError.forbidden({
      logContext: {
        reason: "preview-link-entry-not-visible",
        collection,
        entryId,
      },
    });
  }

  const generation = await (
    await settingsService()
  ).getPreviewTokenGeneration();

  const { token, expiresAt } = await signPreviewToken(
    { collection, entryId, ...(locale === undefined ? {} : { locale }) },
    previewSigningSecret(),
    { generation, ...(ttlSeconds === undefined ? {} : { ttlSeconds }) }
  );

  // The token, not a full URL. Where a preview route is mounted is the app's
  // decision, and guessing it here would produce a link that 404s on any app
  // that mounted it elsewhere.
  return respondMutation("Preview link created", {
    token,
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
