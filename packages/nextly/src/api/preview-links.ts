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

import {
  signPreviewToken,
  type PreviewTokenScope,
} from "../auth/preview/preview-token";
import { buildUserContext } from "../auth/user-context";
import { container, getService } from "../di";
import type { NextlyServiceConfig } from "../di/register";
import {
  resolvePreviewRedirect,
  resolveSinglePreviewRedirect,
} from "../domains/collections/services/preview-redirect-resolver";
import {
  hasPreviewConfigured,
  type PreviewDeclaration,
} from "../domains/collections/services/preview-url-resolver";
import { resolvePreviewRoute } from "../domains/preview/route-config";
import { resolvePreviewSiteUrl } from "../domains/preview/site-url";
import type { UserContext } from "../domains/singles/types";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { env } from "../lib/env";
import type { GeneralSettingsService } from "../services/general-settings/general-settings-service";
import { resolveRoleSlugs } from "../services/lib/permissions";

import {
  assertEntryPreviewable,
  assertSinglePreviewable,
} from "./preview-access";
import {
  loadSingleForPreview,
  previewDeclarationFor,
  singlePreviewDeclarationFor,
} from "./preview-url";
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

/**
 * What a mint request may name: ONE collection entry, or ONE Single.
 *
 * A union rather than three optional fields, so "both" and "neither" are
 * unrepresentable rather than validated afterwards. Naming both is not a
 * narrower request — they are different documents — and honouring one silently
 * would mint a credential for a document the caller may not have meant.
 *
 * The entry variant is unchanged, so every existing caller keeps working.
 */
const mintSchema = z.union([
  z.object({
    collection: z.string().min(1),
    entryId: z.string().min(1),
    single: z.undefined().optional(),
    locale: z.string().min(1).optional(),
    ttlSeconds: z.number().int().positive().max(MAX_TTL_SECONDS).optional(),
  }),
  z.object({
    single: z.string().min(1),
    collection: z.undefined().optional(),
    entryId: z.undefined().optional(),
    locale: z.string().min(1).optional(),
    ttlSeconds: z.number().int().positive().max(MAX_TTL_SECONDS).optional(),
  }),
]);

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
 * The two loaders both redirect resolvers need identically.
 *
 * The document loaders genuinely differ — one reads an entry by id through the
 * collections handler, the other reads a Single by slug through the Direct API —
 * but where the DECLARATION and the site URL come from does not, and writing
 * that twice is how the two paths start disagreeing about which settings read
 * they trust.
 */
function sharedRedirectDeps(declaration: PreviewDeclaration | undefined): {
  loadDeclaration: () => Promise<PreviewDeclaration | undefined>;
  loadSiteUrl: () => Promise<string | null>;
} {
  return {
    // Already resolved by the caller, so this hands the value back rather than
    // fetching it again.
    loadDeclaration: () => Promise.resolve(declaration),
    loadSiteUrl: async () =>
      resolvePreviewSiteUrl(
        await (await settingsService()).getSettings().then(s => s.siteUrl)
      ),
  };
}

/**
 * The one refusal both mint paths make, and the two causes it distinguishes.
 *
 * Written once because the DECISION is one decision — "there is nowhere for
 * this link to open" — while only the noun and the remedy differ. Two copies
 * would drift in the wording, and the wording is the whole value of it: this is
 * the message an editor reads instead of finding out from a reviewer that the
 * link 404s.
 *
 * The two causes are kept apart because they name different people. An
 * unconfigured collection or Single is a developer's job; a document whose
 * address cannot be built yet is usually one empty field the editor can fill.
 * Telling an editor to "ask a developer" about their own unfilled slug sends
 * them to the wrong person.
 */
function refuseUnservableLink(args: {
  subject: "collection" | "single";
  name: string;
  declared: boolean;
}): never {
  const { subject, name, declared } = args;
  const noun = subject === "single" ? "single" : "collection";

  throw NextlyError.conflict({
    reason: "state",
    message: declared
      ? `This ${subject === "single" ? "single" : "entry"} has no preview ` +
        "address yet, so a shared link would have nowhere to open. Filling in " +
        "the fields its preview URL is built from — usually the slug — makes " +
        "it shareable."
      : `This ${noun} has no preview URL configured, so a shared link would ` +
        "have nowhere to open. A developer can add one before links can be " +
        "shared.",
    logContext: {
      reason: declared
        ? `preview-link-${subject}-has-no-preview-target`
        : `preview-link-${subject}-has-no-preview-url`,
      remedy: declared
        ? "The preview declaration returned no address for this document. A " +
          "`url` function answering null, or a `urlTemplate` whose placeholder " +
          "field is empty, both mean 'not previewable yet'."
        : "Add `admin.preview.url` (code-first) or `admin.preview.urlTemplate` " +
          "(UI-created). It answers where the document is served on the site, " +
          "which nothing outside the application can know.",
      [noun]: name,
    },
  });
}

/**
 * Sign a scope and answer with the link, which is identical for both paths.
 *
 * The generation is read here rather than by each caller, so a link minted for
 * a Single and one minted for an entry cannot end up recorded against different
 * revocation generations — which would make "revoke everything" miss one kind.
 */
async function respondWithPreviewLink(
  scope: PreviewTokenScope,
  /**
   * The id of the person the draft will be rendered as.
   *
   * Threaded through this shared helper rather than supplied at each mint, for
   * the reason the generation is: a Single link and an entry link that recorded
   * this differently would render under different permissions, and the one that
   * forgot it would render under none at all.
   */
  minter: string,
  ttlSeconds?: number
): Promise<Response> {
  const generation = await (
    await settingsService()
  ).getPreviewTokenGeneration();

  const { token, expiresAt } = await signPreviewToken(
    scope,
    previewSigningSecret(),
    {
      generation,
      // Recorded so the page renders through the SHARER's field-level
      // permissions. Without it the render skips those rules entirely and the
      // recipient sees fields the sharer cannot — which makes a link a way to
      // read past your own permissions by sending one to yourself.
      minter,
      ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
    }
  );

  const settings = await (await settingsService()).getSettings();

  return respondMutation("Preview link created", {
    token,
    url: previewLinkUrl({
      siteUrl: resolvePreviewSiteUrl(settings.siteUrl),
      route: resolvePreviewRoute(
        container.get<NextlyServiceConfig>("config")?.preview
      ),
      token,
    }),
    expiresAt: expiresAt.toISOString(),
  });
}

/**
 * Who is asking, resolved the one way both mint paths must resolve it.
 *
 * An API key is authorized on the grants stamped on the KEY, never on its
 * owner's roles. Without that distinction the probe resolves the owner's RBAC —
 * including a super-admin bypass — so a key holding `update-*` but not `read-*`
 * would mint a link on the strength of an account that can read, handing out a
 * bearer credential for a document the key itself may not fetch.
 *
 * Shared rather than derived per call site: an entry link and a Single link
 * confer the same kind of credential, so a difference in who they think is
 * asking would be a difference in who can obtain one.
 */
/**
 * Refuse to mint from an API key.
 *
 * A preview link records WHOSE permissions the draft is rendered through, and a
 * key names no person. It is authorized on the grants stamped on the KEY —
 * deliberately, so a narrow key cannot mint on the strength of its owner's
 * account — but the only identity it could record is that owner, whose access
 * is exactly what the key was scoped away from. The link would then render
 * under permissions the request never had: a key allowed to update a document
 * while denied one of its fields would hand its recipient that field.
 *
 * Refused rather than approximated. The honest alternative is to record the KEY
 * and evaluate field rules against its own grants, which means teaching the
 * field-level registry to take a grant set instead of resolving one from a user
 * id — a change to a primitive every read and write shares.
 *
 * Shared by BOTH mints rather than written at one: an entry link and a Single
 * link hand out the same kind of credential, and a rule applied to one of them
 * is a rule with a way around it.
 */
function refuseApiKeyMint(auth: { authMethod: "session" | "api-key" }): void {
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
}

async function callerFor(
  auth: Awaited<ReturnType<typeof requireRouteCollectionAccess>>
): Promise<{ user: UserContext }> {
  const roles = await resolveRoleSlugs(auth);
  return {
    user: buildUserContext({
      claims: auth.claims,
      id: auth.userId,
      name: auth.userName,
      email: auth.userEmail,
      roles,
    }),
  };
  // No `actor`. It existed to judge an API KEY on its own stamped grants, and
  // both mints now refuse a key outright — which is strictly stronger than
  // judging one correctly, so nothing is lost but the branch.
}

/**
 * Whether this Single carries translations.
 *
 * Read the way its preview declaration is read — the authored config first,
 * then the registry — because a code-first Single is synced into the registry
 * and the two must not answer differently about the same document.
 */
async function singleFacts(
  slug: string
): Promise<{ localized: boolean; hasStatus: boolean }> {
  const authored = container
    .get<NextlyServiceConfig>("config")
    ?.singles?.find(s => s.slug === slug);
  const stored = await getService("singleRegistryService").getSingleBySlug(
    slug
  );

  // EITHER source saying yes is taken as yes, rather than the authored config
  // answering alone. The two can disagree — a per-Single metadata sync that
  // fails deliberately retains the previous registry row — and the read path
  // consumes the registry, so a config-first answer reports a Single as
  // unlocalized while every read still treats it as localized. That direction
  // is the dangerous one: it accepts an omitted locale and signs a token whose
  // absent claim covers every translation.
  return {
    localized: authored?.localized === true || stored?.localized === true,
    hasStatus: authored?.status === true || stored?.status === true,
  };
}

/**
 * Mint a link scoped to one Single.
 *
 * Two gates, because the route's own is one axis short of what the token hands
 * out. `requireRouteCollectionAccess` answers the coarse RBAC question — may
 * this caller update this slug — while a Single's STORED rules (owner-only,
 * role based, custom) are evaluated against the loaded document and can deny a
 * caller who holds that permission. A link minted on the permission alone is a
 * bearer credential for a draft the real update path refuses to show them.
 *
 * That the token's subject and the gate's subject are the same document does
 * not close it: the divergence here is between a PERMISSION and a stored RULE,
 * not between a collection and a row.
 */
async function mintForSingle(
  req: Request,
  args: { single: string; locale?: string; ttlSeconds?: number }
): Promise<Response> {
  const { single, locale, ttlSeconds } = args;

  const auth = await requireRouteCollectionAccess(req, "update", single);
  // Booted first because the gate below resolves services from the container,
  // and on a cold process the permission lookup itself needs them registered.
  await getCachedNextly();

  // An unscoped token covers EVERY translation, which on a localized Single is
  // a grant over drafts nobody authorized — the admin resolves a locale before
  // it offers the control, and this is the same rule for a caller that reaches
  // the endpoint directly. Refused rather than widened: authorizing every
  // translation to honour the request would hand out the grant this exists to
  // withhold.
  const facts = await singleFacts(single);

  // A Single with no Draft / Published lifecycle has no pending state to
  // preview, so a link would hand its recipient the CURRENT private document
  // rather than a draft — through a route that reads it trusted. The admin
  // already withholds the control for exactly this; refusing here is the same
  // rule for a caller that reaches the endpoint directly.
  if (!facts.hasStatus) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "This single has no draft/published lifecycle, so there is no " +
        "pending version to preview.",
      logContext: {
        reason: "preview-link-single-has-no-status",
        remedy:
          "Add `status: true` to the single. Without it every save is live, " +
          "so a preview link would show the published document rather than " +
          "an unpublished change.",
        single,
      },
    });
  }

  if (locale === undefined && facts.localized) {
    throw NextlyError.invalidInput({
      message:
        "A localized single needs a locale, so the link grants one " +
        "translation rather than every one of them.",
      logContext: {
        reason: "preview-link-single-locale-required",
        remedy:
          "Name the translation being shared. A token with no locale claim " +
          "covers every locale, including translations that have never been " +
          "published.",
        single,
      },
    });
  }

  // The Single's STORED rules, against the real document, in the TRANSLATION
  // the token will name. Runs before anything is signed and before the trusted
  // read below, so a refused caller reaches neither.
  refuseApiKeyMint(auth);
  const { user } = await callerFor(auth);
  await assertSinglePreviewable(single, locale, user, {
    // The route above ran the coarse gate for `update` on this Single, so
    // repeating it here would ask a question already answered. The preview
    // RENDER passes `false`: it has no route gate at all.
    routeAuthorized: true,
  });

  const declaration = await singlePreviewDeclarationFor(single);

  // Resolved for THIS Single, not merely checked for a declaration, for the
  // same reason the entry path does it: a `url` answering null means "not
  // previewable yet", and minting on the strength of a declaration alone hands
  // out a link that 404s at the redirect.
  const target = hasPreviewConfigured(declaration)
    ? await resolveSinglePreviewRedirect(
        { single, ...(locale === undefined ? {} : { locale }) },
        {
          loadSingle: loadSingleForPreview,
          ...sharedRedirectDeps(declaration),
        }
      )
    : null;

  if (target === null) {
    refuseUnservableLink({
      subject: "single",
      name: single,
      declared: hasPreviewConfigured(declaration),
    });
  }

  return respondWithPreviewLink(
    { kind: "single", single, ...(locale === undefined ? {} : { locale }) },
    auth.userId,
    ttlSeconds
  );
}

/**
 * POST /api/nextly/preview-links
 *
 * Mints a link scoped to one entry, or to one Single. Auth: `update` on the
 * collection, or on the Single's own slug.
 */
export const mintPreviewLink = withErrorHandler(async (req: Request) => {
  const body: unknown = await req.json().catch(() => undefined);
  const parsed = mintSchema.safeParse(body);
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  const { locale, ttlSeconds } = parsed.data;

  // A Single takes its own path from here. It shares the refusal and the link
  // assembly and nothing else: it is addressed by slug with no id, so there is
  // no entry to authorize by row and no by-id read to make.
  if (parsed.data.single !== undefined) {
    return mintForSingle(req, {
      single: parsed.data.single,
      ...(locale === undefined ? {} : { locale }),
      ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
    });
  }

  const { collection, entryId } = parsed.data;

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
  refuseApiKeyMint(auth);

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
  const { user } = await callerFor(auth);
  // Authorized through the gate that serves collection reads and writes, so the
  // verdict here is the verdict the bearer's own read will reach. It asks two
  // questions the previous by-id probe could not express: whether the entry is
  // visible at all INCLUDING one never published, and whether this caller may
  // edit it — which is what the draft overlay requires before surfacing the
  // working draft the token hands out.
  await assertEntryPreviewable(collection, entryId, user, {
    // The route above ran the coarse gate for `update` on this collection, so
    // repeating it here would ask a question already answered. The preview
    // RENDER passes `false`: it has no route gate at all.
    routeAuthorized: true,
  });

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
          ...sharedRedirectDeps(declaration),
        }
      )
    : null;

  if (target === null) {
    refuseUnservableLink({
      subject: "collection",
      name: collection,
      declared: hasPreviewConfigured(declaration),
    });
  }

  return respondWithPreviewLink(
    { collection, entryId, ...(locale === undefined ? {} : { locale }) },
    auth.userId,
    ttlSeconds
  );
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
