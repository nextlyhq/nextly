/**
 * What the preview route and the draft gate use when the application supplies
 * nothing.
 *
 * A module of its own for one structural reason: every default here reaches the
 * service container or `next/headers`, and `preview-route.ts` has to stay
 * importable without dragging either. Keeping the resolution behind functions
 * in a separate file means `import { createPreviewRoute } from "nextly/runtime"`
 * still costs a token verifier and nothing more, and the route module keeps the
 * fully-injected shape its tests rely on.
 *
 * Nothing here is memoised, and that is deliberate. `generation` is the
 * revocation counter, so a value cached at module scope would keep preview
 * sessions alive after an administrator had revoked every link — the single
 * failure the counter exists to prevent.
 *
 * @module runtime/preview/preview-route-defaults
 */

import { container, getService } from "../../di";
import {
  resolvePreviewRedirect,
  type PreviewRedirectScope,
} from "../../domains/collections/services/preview-redirect-resolver";
import { NextlyError } from "../../errors/nextly-error";
import { getCachedNextly } from "../../init";
import { env } from "../../lib/env";
import type { GeneralSettingsService } from "../../services/general-settings/general-settings-service";

/**
 * The key preview tokens are signed with.
 *
 * Read per call rather than at module load, so a deployment missing it fails
 * the one request that needs it — carrying a remedy — instead of refusing to
 * boot. The wording matches the minting endpoint's, because an operator who
 * reaches one of these is about to reach the other.
 */
export function defaultSecret(): string {
  const secret = env.NEXTLY_SECRET;
  if (!secret) {
    throw NextlyError.internal({
      logContext: {
        reason: "preview-route-no-secret",
        remedy:
          "Set NEXTLY_SECRET. Preview links are signed with a key derived " +
          "from it, and without one an unsigned link would be forgeable by " +
          "anyone who can guess an entry id.",
      },
    });
  }
  return secret;
}

async function settingsService(): Promise<GeneralSettingsService> {
  await getCachedNextly();
  return container.get<GeneralSettingsService>("generalSettingsService");
}

/** The site's current revocation generation. */
export async function defaultGeneration(): Promise<number> {
  return (await settingsService()).getPreviewTokenGeneration();
}

/**
 * Next's draft mode.
 *
 * Imported inside the call rather than at the top of the file. `next/headers`
 * resolves only within a request, so a static import would make merely loading
 * this module fail in every other context — including the CLI, which loads a
 * user config whose module graph reaches `nextly/runtime`.
 */
export async function defaultDraftMode(): Promise<{ enable: () => void }> {
  const { draftMode } = await import("next/headers");
  return draftMode();
}

/** The request's cookies, imported inside the call for the same reason. */
export async function defaultCookies(): Promise<{
  get: (name: string) => { value: string } | undefined;
}> {
  const { cookies } = await import("next/headers");
  return cookies();
}

/**
 * Where a token sends the visitor, answered from the collection's own preview
 * declaration.
 *
 * The alternative was for every application to write this itself, which is what
 * left the capability unreachable: the resolution is not obvious, an equivalent
 * already exists for the admin's preview button, and an application that
 * derived it differently would produce links that answer 404 with nothing to
 * explain them.
 */
export async function defaultRedirectTo(
  scope: PreviewRedirectScope,
  context?: { requestOrigin: string }
): Promise<string | null> {
  await getCachedNextly();
  const { previewDeclarationFor } = await import("../../api/preview-url");
  const collections = getService("collectionsHandler");

  return resolvePreviewRedirect(
    scope,
    {
      loadEntry: async (collection, entryId, locale) => {
        // The SAME service the mint-time authorization probe reads through, so
        // the entry a link is authorized against and the entry its path is built
        // from cannot diverge. The Direct API's `findByID` is not usable here: it
        // takes no `status`, so a status-enabled collection filters it to
        // published only and an entry that has never been published — precisely
        // the entry a preview link is most often minted for — reports as missing.
        const read = await collections.getEntry({
          collectionName: collection,
          entryId,
          // No relationships. This read exists to produce a path, and every field
          // a preview URL can be built from is scalar, so expanding would read
          // further collections to answer a question none of them contribute to.
          depth: 0,
          // Trusted, because the caller is anonymous: whoever follows a preview
          // link has no session. Authorization happened when the link was minted,
          // against the gate that serves real reads, and the signed token carries
          // that verdict. What this produces is a path and never content.
          overrideAccess: true,
          status: "all",
          // The token's locale, so a link minted for one translation resolves
          // that translation's slug rather than the default language's.
          ...(locale === undefined ? {} : { locale }),
          // The working draft's values, not the published row's. An editor who
          // changed the slug on the draft is sharing the draft, so the published
          // slug would send the reviewer to the entry's old address — or, for an
          // entry never published, to no address at all.
          includeWorkingDraft: true,
        });

        if (!read.success || read.data === null) return null;
        return read.data as Record<string, unknown>;
      },
      loadDeclaration: previewDeclarationFor,
      loadSiteUrl: async () =>
        (await settingsService()).getSettings().then(s => s.siteUrl),
    },
    context?.requestOrigin
  );
}
