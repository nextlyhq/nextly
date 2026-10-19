/**
 * Preview links: minting one, listing a document's live links, and revoking
 * one link, every link of one document, or every link on the site.
 *
 *   POST /api/nextly/preview-links               -> mint a link for one document
 *   GET  /api/nextly/preview-links?…             -> a document's live links
 *   POST /api/nextly/preview-links/:id/revoke    -> revoke one link
 *   POST /api/nextly/preview-links/revoke {doc}  -> revoke one document's links
 *   POST /api/nextly/preview-links/revoke        -> invalidate every link ever issued
 *
 * The list, revoke-one and per-document revoke-all are `@experimental` until
 * the screen that drives them settles.
 *
 * **Minting, listing and revoking a document's links are one decision**, made
 * by `authorizePreviewSharer`: a person who may share a preview of that entry
 * or Single. Listing and revoking need nothing more than sharing does, because
 * a person who may hand out a link may see who else has and take any back.
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
  listLiveLinks,
  olderLinksEnd,
  previewLinkDocument,
  recordPreviewLink,
  revokeAllRecordedLinks,
  revokeDocumentLinks,
  revokeRecordedLink,
  type PreviewLinkDocument,
} from "../auth/preview/preview-link-records";
import {
  MAX_PREVIEW_TTL_SECONDS,
  signPreviewToken,
  type PreviewTokenScope,
} from "../auth/preview/preview-token";
import { container, getService } from "../di";
import type { NextlyServiceConfig } from "../di/register";
import {
  buildAuditLogWriter,
  type AuditLogWriter,
} from "../domains/audit/audit-log-writer";
import {
  explainPreviewRedirect,
  explainSinglePreviewRedirect,
  readFromEnvelope,
  readOrReport,
  type PreviewPathOutcome,
  type PreviewRefusalCause,
} from "../domains/collections/services/preview-redirect-resolver";
import {
  hasPreviewConfigured,
  type PreviewDeclaration,
} from "../domains/collections/services/preview-url-resolver";
import { resolvePreviewViewports } from "../domains/collections/services/preview-viewports";
import { resolvePreviewRoute } from "../domains/preview/route-config";
import { resolvePreviewSiteUrl } from "../domains/preview/site-url";
import { NextlyError } from "../errors/nextly-error";
import { getCachedNextly } from "../init";
import { env } from "../lib/env";
import { previewSessionReachesFrame } from "../runtime/preview/preview-frame-policy";
import type { GeneralSettingsService } from "../services/general-settings/general-settings-service";

import {
  authorizePreviewSharer,
  type PreviewSharedDocument,
} from "./preview-access";
import {
  loadSingleForPreview,
  previewDeclarationFor,
  singlePreviewDeclarationFor,
} from "./preview-url";
import {
  privateToSession,
  respondList,
  respondMutation,
} from "./response-shapes";
import { requireRoutePermission } from "./route-auth";
import { withErrorHandler } from "./with-error-handler";
import { nextlyValidationFromZod } from "./zod-to-nextly-error";

/**
 * The upper bound on how long a link stays usable; see
 * {@link MAX_PREVIEW_TTL_SECONDS}. A caller may ask for less; asking for more is
 * refused rather than clamped, because silently shortening a link an editor
 * believes lasts a week is worse than telling them it does not.
 */
const MAX_TTL_SECONDS = MAX_PREVIEW_TTL_SECONDS;

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
 * The one refusal both mint paths make, and the causes it distinguishes.
 *
 * Written once because the DECISION is one decision — "there is nowhere for
 * this link to open" — while only the noun and the remedy differ. Two copies
 * would drift in the wording, and the wording is the whole value of it: this is
 * the message an editor reads instead of finding out from a reviewer that the
 * link 404s.
 *
 * The causes are kept apart because they name DIFFERENT PEOPLE. An unconfigured
 * collection or Single is a developer's job; a document whose address cannot be
 * built yet is usually one empty field the editor can fill; a declaration
 * pointing at another origin is neither, and no field on the entry will ever
 * change it. Telling an editor to fill in a slug that is already correct sends
 * them to look at the one thing that is not the problem.
 *
 * A `Record` rather than a chain of ternaries, so a new
 * {@link PreviewRefusalCause} is a type error here rather than silently taking
 * whichever branch happened to be last.
 */
/**
 * The word for the DOCUMENT, as against the word for the thing that DECLARES
 * the preview.
 *
 * Two messages need it and an inline copy in each would drift, which for a
 * one-word difference is the drift nobody notices: `noun` elsewhere in this map
 * is the declaring object — a collection or a Single — and that is correct for
 * a message about configuration. It is wrong for a message about a value on the
 * document, because an entry's data belongs to the entry rather than to its
 * collection, and a reader sent to look at "this collection" for a field goes
 * to the wrong screen.
 */
function documentNoun(subject: "collection" | "single"): "entry" | "single" {
  return subject === "single" ? "single" : "entry";
}

const REFUSALS: Record<
  PreviewRefusalCause,
  {
    message: (subject: "collection" | "single", noun: string) => string;
    reason: string;
    remedy: string;
  }
> = {
  documentUnreadable: {
    /*
     * The DOCUMENT, not the collection. What failed is the trusted read of one
     * entry; the collection and its declaration were both read successfully a
     * moment earlier. Naming the collection sends the editor to look at the
     * wrong scope, which is the same misdirection this cause was added to stop.
     */
    message: subject =>
      `This ${subject === "single" ? "single" : "entry"} could not be read ` +
      "just now, so a shared link would have nowhere to open. Nothing is " +
      "known to be wrong with it — please try again in a moment.",
    reason: "document-read-failed",
    /*
     * Deliberately NOT the deletion remedy. The read failed, which establishes
     * nothing about whether the document exists, and an operator sent looking
     * for a deletion that never happened is worse off than one told the read
     * failed.
     */
    /*
     * Deliberately NOT "a non-404 failure". A 404 CARRYING A CODE lands here
     * too, because a thrown not-found — an `afterRead` hook refusing a
     * dependent lookup — cannot be told apart from the document itself being
     * absent. Describing this as necessarily non-404 sends an operator looking
     * anywhere but the hook path that produced it.
     */
    remedy:
      "The trusted read failed without establishing that the previewed " +
      "document is absent. Look at the read path — a transient database " +
      "error, a rate limit, or a read hook raising not-found for something " +
      "the document merely references all arrive this way.",
  },
  documentGone: {
    message: subject =>
      `This ${subject === "single" ? "single" : "entry"} could not be read, so ` +
      "a shared link would have nowhere to open. It may have been deleted.",
    reason: "has-no-readable-document",
    /*
     * The REQUEST, never "the token" — nothing has been signed at this point.
     * This refusal is thrown before `respondWithPreviewLink`, so a log line
     * saying a token names something would record a credential that was never
     * issued, and an incident reader would go looking for it.
     */
    remedy:
      "The mint request named a document the resolver could not load. For an " +
      "entry that usually means it was deleted between the authorization read " +
      "and the resolver's own; for a Single, that it was removed from the " +
      "configuration.",
  },
  notConfigured: {
    message: (_subject, noun) =>
      `This ${noun} has no preview URL configured, so a shared link would ` +
      "have nowhere to open. A developer can add one before links can be " +
      "shared.",
    reason: "has-no-preview-url",
    remedy:
      "Add `admin.preview.url` (code-first) or `admin.preview.urlTemplate` " +
      "(UI-created). It answers where the document is served on the site, " +
      "which nothing outside the application can know.",
  },
  unavailable: {
    message: subject =>
      `This ${documentNoun(subject)} has no preview ` +
      "address yet, so a shared link would have nowhere to open. Filling in " +
      "the fields its preview URL is built from — usually the slug — makes " +
      "it shareable.",
    reason: "has-no-preview-target",
    remedy:
      "The preview declaration DECLINED to name an address for this document. " +
      "A `url` function answering null, or a `urlTemplate` whose placeholder " +
      "field is empty, both mean 'not previewable yet'. A declaration that " +
      "threw or produced an unusable address is `declarationFailed` instead.",
  },
  /*
   * Deliberately neutral, and neutral in BOTH directions.
   *
   * A caught error cannot identify whether the declaration or this document's
   * data caused it, so this names neither. Saying it is a developer's to
   * investigate would be wrong whenever a field on this document is the cause,
   * and it would send the one person who can fix it away from the fix.
   *
   * The DOCUMENT noun rather than `noun`: `noun` is the thing that DECLARES the
   * preview — a collection or a Single — which is right for a message about
   * configuration and wrong here, because an entry's data belongs to the entry
   * rather than to its collection.
   */
  declarationFailed: {
    message: subject =>
      `This ${documentNoun(subject)}'s preview URL could not be built: the ` +
      "preview declaration failed while producing an address. That can be a " +
      "fault in the declaration, or a value on this " +
      `${documentNoun(subject)} it did not expect — the error does not say ` +
      "which, so it is worth checking this " +
      `${documentNoun(subject)}'s fields as well as raising it with a ` +
      "developer.",
    reason: "preview-declaration-failed",
    remedy:
      "The declaration threw while running, or returned pieces that do not " +
      "compose into a URL under the site. Whether it fails for EVERY document " +
      "or only for this one is NOT observable from a caught throw — a " +
      "declaration reading a field this document never filled in raises the " +
      "same error a broken one does — so this names neither. Check " +
      "`admin.preview.url` / `admin.preview.urlTemplate` and the fields it " +
      "reads.",
  },
  foreignOrigin: {
    message: (_subject, noun) =>
      `This ${noun}'s preview URL points at a different site than this one, ` +
      "so a shared link would leave the preview behind. A developer can " +
      "align the preview URL with the configured site URL.",
    reason: "preview-url-names-another-origin",
    remedy:
      "The declaration resolved to an absolute URL whose origin differs from " +
      "the configured site URL (or, with none set, from the origin serving " +
      "the request). Filling in fields on the document cannot change this — " +
      "either the declaration or the site URL setting has to move.",
  },
  unresolvable: {
    message: (_subject, noun) =>
      `This ${noun}'s preview URL could not be turned into an address on ` +
      "this site, so a shared link would have nowhere to open. A developer " +
      "can check the preview URL and the site URL setting.",
    reason: "preview-url-does-not-resolve",
    remedy:
      "Either the preview URL or the configured site URL did not parse, or " +
      "the declaration produced a path that leaves this origin. Note that " +
      "`//host` and `/\\host` are absolute despite the leading slash.",
  },
};

function refuseUnservableLink(args: {
  subject: "collection" | "single";
  name: string;
  cause: PreviewRefusalCause;
}): never {
  const { subject, name, cause } = args;
  const noun = subject === "single" ? "single" : "collection";
  const refusal = REFUSALS[cause];

  throw NextlyError.conflict({
    reason: "state",
    message: refusal.message(subject, noun),
    logContext: {
      reason: `preview-link-${subject}-${refusal.reason}`,
      remedy: refusal.remedy,
      [noun]: name,
    },
  });
}

/**
 * The audit writer, resolved the way the auth router resolves it.
 *
 * The container's `getService` is keyed on `ServiceMap`, and the writer takes
 * the loose form because it is shared with callers outside that map. The widen
 * is the same one `route-handler/auth-handler.ts` performs at its own call
 * site; it lives in one function here so the two recording sites below cannot
 * drift into widening it differently.
 *
 * Built per call rather than once at module load: the adapter it reaches is
 * registered by whichever container is live, and a writer captured at import
 * time would outlast a reload and write through a connection nobody is using.
 */
function auditWriter(): AuditLogWriter {
  return buildAuditLogWriter(getService as (name: string) => unknown);
}

/**
 * What a scope looks like in an audit row.
 *
 * Its own function because the trail asks a narrower question than the token
 * does: WHICH DOCUMENT was opened up, in terms that stay readable years later
 * and identify no person. The scope's discriminant is projected to an explicit
 * `scope` key rather than left to the reader to infer from which of
 * `collection` or `single` is present — an audit row is read by someone who was
 * not there, and a shape they have to deduce is one they can deduce wrongly.
 *
 * The TOKEN never enters. It is the credential itself, so a trail carrying it
 * would hand its reader the access it exists to record — and an audit table is
 * readable by exactly the operators a preview link is meant to be scoped away
 * from. What is recorded is what the credential was FOR, never the credential.
 */
function auditScope(scope: PreviewTokenScope): Record<string, unknown> {
  const locale =
    "locale" in scope && scope.locale !== undefined
      ? { locale: scope.locale }
      : {};
  return "single" in scope
    ? { scope: "single", single: scope.single, ...locale }
    : {
        scope: "collection",
        collection: scope.collection,
        entryId: scope.entryId,
        ...locale,
      };
}

/**
 * Sign a scope and answer with the link, which is identical for both paths.
 *
 * The generation is read here rather than by each caller, so a link minted for
 * a Single and one minted for an entry cannot end up recorded against different
 * revocation generations — which would make "revoke everything" miss one kind.
 *
 * The audit row is written here for that same reason. Both mints funnel through
 * this function, so recording at each call site instead would be one rule with
 * two implementations — and the one that was forgotten would issue credentials
 * silently, which is precisely the state this replaces.
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
  /**
   * The origin the admin is being served from, taken from THIS request rather
   * than from anything the caller sent.
   *
   * The mint route is served by the admin, so its own URL names the admin's
   * origin — no header to trust and nothing for a caller to assert. It decides
   * only whether the pane is offered a frame or a new tab, so a wrong value
   * costs a fallback rather than access to anything.
   */
  adminOrigin: string,
  /**
   * The collection's or Single's own preview declaration.
   *
   * Passed in rather than re-read: both call sites already loaded it to decide
   * whether a link could be built at all, and reading it twice would let the
   * link and the viewports it offers come from two different reads.
   */
  declaration: PreviewDeclaration | undefined,
  ttlSeconds?: number
): Promise<Response> {
  const generation = await (
    await settingsService()
  ).getPreviewTokenGeneration();

  // Before signing: a revoke-all of this document that begins after this
  // moment has to be able to stop the link.
  const mintStartedAt = new Date();
  const { token, expiresAt, issuedAt, linkId } = await signPreviewToken(
    scope,
    previewSigningSecret(),
    {
      generation,
      // Recorded so the page renders through the SHARER's field-level
      // permissions. Without it the render skips those rules entirely and the
      // recipient sees fields the sharer cannot — which makes a link a way to
      // read past your own permissions by sending one to yourself.
      minter,
      // Every link minted now is recorded, so it can be listed, counted and
      // revoked on its own.
      recorded: true,
      ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
    }
  );

  // Before the token leaves this process. A failed write means no link: an
  // unrecorded new link could not be revoked on its own, and a link the
  // editor could not take back is not one to hand out. The row's end is the
  // token's own `exp`, so the list states when the link actually stops.
  await recordPreviewLink({
    id: linkId,
    scope,
    createdBy: minter,
    createdAt: issuedAt,
    expiresAt,
    generation,
    mintStartedAt,
  });

  const settings = await (await settingsService()).getSettings();
  const url = previewLinkUrl({
    siteUrl: resolvePreviewSiteUrl(settings.siteUrl),
    route: resolvePreviewRoute(
      container.get<NextlyServiceConfig>("config")?.preview
    ),
    token,
  });

  /*
   * Recorded LAST, after everything that can still fail has succeeded.
   *
   * Signing is not the moment a credential exists for anyone — the settings
   * read and the link assembly come after it, and a failure in either returns
   * an error while the token never leaves the process. A row written before
   * them would durably assert that draft access was handed out on a request
   * that handed out nothing, and an investigator reading the trail would be
   * hunting a link nobody holds.
   *
   * The writer never throws, deliberately, and that direction is right here for
   * the same reason it is right for a login: an unreachable audit table must
   * not be what stops an editor previewing their own draft. The cost is the
   * opposite gap — a database failure loses the row while the link works — and
   * the writer logs it. Fail-closed would convert a reporting outage into an
   * outage of the feature being reported on.
   *
   * No IP or user agent. Capturing them honestly needs the `trustProxy` and
   * `trustedProxyIps` configuration that decides which forwarded address may be
   * believed, and that read lives behind the auth handlers' own bridge; no
   * route in this layer captures either today. Recording the proxy's address as
   * the caller's would put a confidently wrong value in an audit field, which
   * is worse than an absent one — the actor, which is the load-bearing fact
   * here, is recorded either way.
   */
  await auditWriter().write({
    kind: "preview-link-minted",
    actorUserId: minter,
    metadata: {
      ...auditScope(scope),
      // The recorded link's id, which its revocation names too, so the trail
      // can say which credential a revocation ended.
      linkId,
      generation,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return respondMutation("Preview link created", {
    // The id the list and revoke-one name this link by. The token is shown
    // only here: it is the credential, and it is never stored.
    id: linkId,
    token,
    url,
    expiresAt: expiresAt.toISOString(),
    /*
     * Answered HERE because this is where both halves are known: the site's
     * address, and the policy the preview cookie is set with. The admin used to
     * compare the two origins itself, which was a second implementation of a
     * question the cookie already settles — correct only while nobody changed
     * the cookie, and wrong silently when someone did.
     *
     * It says the SESSION reaches a frame, not that the frame will load: an
     * application's own `frame-ancestors` is invisible from here.
     */
    embeddable: previewSessionReachesFrame(url, adminOrigin),
    /*
     * Resolved HERE because the declaration may be a FUNCTION, and a function
     * cannot be stored or sent. The browser receives the list it produced, so
     * the admin never needs to know where a site keeps its breakpoints — which
     * is what lets a plugin supply them without the admin depending on it.
     */
    viewports: await resolvePreviewViewports(declaration?.breakpoints),
  });
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
 * this caller update this slug — while the real update path additionally
 * requires the document to exist and to be reachable in the language asked for.
 * A link minted on the permission alone is a bearer credential for a draft that
 * path refuses to show them.
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

  // Who may share this Single, asked the one way the list and revocations ask
  // it: a person, not a key, with `update` on its slug and read and edit of
  // the Single itself in the translation the token will name. Runs before
  // anything is signed and before the trusted read below, so a refused caller
  // reaches neither.
  const { auth, grant: singleGrant } = await authorizePreviewSharer(
    req,
    { single, ...(locale === undefined ? {} : { locale }) },
    "mint"
  );

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

  const declaration = await singlePreviewDeclarationFor(single);

  // Resolved for THIS Single, not merely checked for a declaration, for the
  // same reason the entry path does it: a `url` answering null means "not
  // previewable yet", and minting on the strength of a declaration alone hands
  // out a link that 404s at the redirect.
  // The undeclared case is stated HERE rather than resolved, because the guard
  // exists to skip the document read: asking the resolver would load a Single
  // only to be told what the missing declaration already says.
  const outcome: PreviewPathOutcome = hasPreviewConfigured(declaration)
    ? await explainSinglePreviewRedirect(
        { single, ...(locale === undefined ? {} : { locale }) },
        {
          // `findSingle` reports failure by THROWING rather than by returning
          // an envelope, so checking for `null` here saw neither absence nor a
          // failed read — the throw simply travelled past, and the endpoint
          // answered with a raw internal error instead of this refusal.
          loadSingle: (slug, singleLocale) =>
            readOrReport(() => loadSingleForPreview(slug, singleLocale)),
          ...sharedRedirectDeps(declaration),
        },
        // The grant the gate above RETURNED, rather than one assembled here:
        // a witness built at the call site would assert the very thing the gate
        // exists to establish, and would be accepted by a comparison against
        // that same self-asserted value.
        singleGrant
      )
    : { kind: "refused", cause: "notConfigured" };

  if (outcome.kind === "refused") {
    refuseUnservableLink({
      subject: "single",
      name: single,
      cause: outcome.cause,
    });
  }

  return respondWithPreviewLink(
    { kind: "single", single, ...(locale === undefined ? {} : { locale }) },
    auth.userId,
    new URL(req.url).origin,
    declaration,
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

  // Who may share this entry, asked the one way the list and revocations ask
  // it: a person, not a key, with `update` on the collection, who may read
  // the entry INCLUDING one never published and may edit it, which is what
  // the draft overlay requires before surfacing the working draft the token
  // hands out. A coarse collection answer alone would let a caller bounded to
  // their own documents mint a working credential for someone else's.
  const { auth, grant: entryGrant } = await authorizePreviewSharer(
    req,
    { collection, entryId },
    "mint"
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
  const outcome: PreviewPathOutcome = hasPreviewConfigured(declaration)
    ? await explainPreviewRedirect(
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
            /*
             * A FAILED read is not an absent entry: a transient database error,
             * a rate limit or a throwing read hook would otherwise arrive as
             * "this may have been deleted", telling an editor their work is
             * gone while it sits there intact. Which envelope means absence is
             * decided in ONE place, so this loader and the anonymous route's
             * cannot come to disagree about the same entry.
             */
            return readFromEnvelope(read);
          },
          // Already resolved above, so this hands back the value rather than
          // fetching it again — the resolver takes a loader and this call site
          // happens to have the answer.
          ...sharedRedirectDeps(declaration),
        },
        // The grant `assertEntryPreviewable` returned. See the Single path:
        // it cannot exist unless that gate passed for this exact document.
        entryGrant
      )
    : // Stated rather than resolved, so an undeclared collection costs no entry
      // read to learn what the absent declaration already says.
      { kind: "refused", cause: "notConfigured" };

  if (outcome.kind === "refused") {
    refuseUnservableLink({
      subject: "collection",
      name: collection,
      cause: outcome.cause,
    });
  }

  return respondWithPreviewLink(
    { collection, entryId, ...(locale === undefined ? {} : { locale }) },
    auth.userId,
    new URL(req.url).origin,
    declaration,
    ttlSeconds
  );
});

/**
 * The one document a list or revocation names: an entry, or a Single.
 *
 * Strict, so a misspelt key is refused rather than ignored. That matters most
 * for revoke-all, where a body that names no document is the site-wide revoke:
 * a typo must not quietly become the most destructive request the endpoint
 * answers.
 */
const documentSchema = z.union([
  z
    .object({
      collection: z.string().min(1),
      entryId: z.string().min(1),
      locale: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      single: z.string().min(1),
      locale: z.string().min(1).optional(),
    })
    .strict(),
]);

/** A page of the live list: 1-based, 50 links unless asked, at most 100. */
const pagingSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

function parseDocument(input: unknown): PreviewSharedDocument {
  const parsed = documentSchema.safeParse(input);
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  return parsed.data;
}

/** The record's view of a requested document, which has no locale. */
function recordDocument(document: PreviewSharedDocument): PreviewLinkDocument {
  return previewLinkDocument(
    "single" in document
      ? { kind: "single", single: document.single }
      : { collection: document.collection, entryId: document.entryId }
  );
}

/** The audit trail's view of a requested document, which has no locale. */
function auditDocument(
  document: PreviewSharedDocument
): Record<string, unknown> {
  return auditScope(
    "single" in document
      ? { kind: "single", single: document.single }
      : { collection: document.collection, entryId: document.entryId }
  );
}

/** A live link, as the list shows it. */
interface ListedPreviewLink {
  kind: "link";
  id: string;
  locale: string | null;
  createdBy: { id: string; name: string | null } | null;
  createdAt: string;
  expiresAt: string;
  openCount: number;
  lastOpenedAt: string | null;
}

/**
 * The one row standing for every link made before links were recorded. They
 * carry no id, so they can only be revoked all together, and this is the
 * latest moment any of them could still work.
 */
interface OlderPreviewLinks {
  kind: "older";
  latestEnd: string;
}

/**
 * GET /api/nextly/preview-links?collection=…&entryId=…  or  ?single=…
 *
 * @experimental The live links of one document, newest first: who made each,
 * when it ends and how many times it was opened. While links made before
 * links were recorded may still be alive, one more item of `kind: "older"`
 * says so. Auth: the person may share a preview of that document.
 */
// Private to the session that asked, refusals included: the answer is who
// shared which credentials, and a shared cache must never hand it to another
// caller or keep a refusal over a later answer.
export const listPreviewLinks = privateToSession(
  withErrorHandler(async (req: Request) => {
    const params = new URL(req.url).searchParams;
    const document = parseDocument(
      Object.fromEntries(
        ["collection", "entryId", "single", "locale"]
          .map(key => [key, params.get(key)] as const)
          .filter((pair): pair is readonly [string, string] => pair[1] !== null)
      )
    );
    const paging = pagingSchema.safeParse({
      page: params.get("page") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    if (!paging.success) throw nextlyValidationFromZod(paging.error);
    const { page, limit } = paging.data;
    // A read that changes nothing: a Single with no row yet is not created to
    // answer it, and no read hook runs.
    await authorizePreviewSharer(req, document, "manage");

    const now = new Date();
    const generation = await (
      await settingsService()
    ).getPreviewTokenGeneration();
    const { links: live, total } = await listLiveLinks(
      recordDocument(document),
      generation,
      now,
      { limit, offset: (page - 1) * limit }
    );
    const olderEnd = await olderLinksEnd(
      recordDocument(document),
      now,
      generation
    );

    const items: Array<ListedPreviewLink | OlderPreviewLinks> = [
      ...live.map(
        (link): ListedPreviewLink => ({
          kind: "link",
          id: link.id,
          locale: link.locale,
          createdBy: link.createdBy,
          createdAt: link.createdAt.toISOString(),
          expiresAt: link.expiresAt.toISOString(),
          openCount: link.openCount,
          lastOpenedAt: link.lastOpenedAt?.toISOString() ?? null,
        })
      ),
      // On the first page only: it stands for no link of its own, so it is
      // neither counted nor paged.
      ...(olderEnd === null || page !== 1
        ? []
        : [{ kind: "older" as const, latestEnd: olderEnd.toISOString() }]),
    ];

    // Paged by the live links; `total` counts them, not the older-links row.
    const totalPages = Math.max(1, Math.ceil(total / limit));
    return respondList(items, {
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    });
  })
);

/**
 * POST /api/nextly/preview-links/:id/revoke  with the document in the body
 *
 * @experimental Revokes one link of that document, which stops at once on its
 * next opening and on every page of a session it already opened. Any person
 * who may share the document may revoke any of its links, not only their own.
 * An id that is not one of that document's links answers not found, the same
 * as one that never existed, so ids cannot be probed across documents.
 */
export async function revokePreviewLink(
  req: Request,
  routeParams: Record<string, string>
): Promise<Response> {
  return withErrorHandler(async (request: Request) => {
    // Set by the route parser from the path; a request reaching here without
    // one names no link.
    const linkId = routeParams.linkId;
    if (typeof linkId !== "string" || linkId.length === 0) {
      throw NextlyError.notFound({
        logContext: { reason: "preview-link-revoke-without-id" },
      });
    }
    const body: unknown = await request.json().catch(() => undefined);
    const document = parseDocument(body);
    const { auth } = await authorizePreviewSharer(request, document, "manage");

    const result = await revokeRecordedLink(
      linkId,
      recordDocument(document),
      auth.userId,
      new Date()
    );
    if (result.outcome === "absent") {
      throw NextlyError.notFound({
        logContext: { reason: "preview-link-not-of-document", linkId },
      });
    }

    // Recorded once, by the request that revoked it. A repeat, or the loser
    // of two at once, changed nothing, so it records nothing and is told when
    // the revocation that did happen took place.
    if (result.outcome === "revoked") {
      await auditWriter().write({
        kind: "preview-link-revoked",
        actorUserId: auth.userId,
        metadata: { ...auditDocument(document), linkId },
      });
    }

    return respondMutation("Preview link revoked", {
      id: linkId,
      revokedAt: result.revokedAt.toISOString(),
    });
  })(req);
}

/**
 * Revoke every link of one document: what `POST /revoke` does when its body
 * names one. Behind the sharer rule, because it reaches only that document.
 */
async function revokeDocumentPreviewLinks(
  req: Request,
  document: PreviewSharedDocument
): Promise<Response> {
  const { auth } = await authorizePreviewSharer(req, document, "manage");
  const revoked = await revokeDocumentLinks(
    recordDocument(document),
    auth.userId,
    new Date()
  );

  await auditWriter().write({
    kind: "preview-links-revoked",
    actorUserId: auth.userId,
    metadata: {
      // Present for one document, absent for the site-wide revoke: what this
      // revocation reached.
      ...auditDocument(document),
      revoked,
    },
  });

  return respondMutation("Preview links revoked", { revoked });
}

/**
 * Whether a revoke body names no document: absent, empty, or `{}`, which is
 * what the site-wide revoke has always been sent.
 */
function namesNoDocument(body: unknown): boolean {
  return (
    body === undefined ||
    body === null ||
    (typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body).length === 0)
  );
}

/**
 * POST /api/nextly/preview-links/revoke
 *
 * With no document in the body: invalidates every preview link ever issued,
 * including sessions already in flight. Auth: `manage settings`, because the
 * generation is site-wide. Unchanged for every existing caller.
 *
 * With a document in the body (`@experimental`): revokes every link of that
 * document, recorded or made before links were recorded. Auth: the person may
 * share a preview of that document.
 */
export const revokePreviewLinks = withErrorHandler(async (req: Request) => {
  const text = await req.text();
  let body: unknown;
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      throw NextlyError.invalidInput({
        message: "The request body is not valid JSON.",
        logContext: { reason: "preview-links-revoke-body-unreadable" },
      });
    }
  }
  if (!namesNoDocument(body)) {
    return revokeDocumentPreviewLinks(req, parseDocument(body));
  }

  const auth = await requireRoutePermission(req, "manage", "settings");
  const generation = await (await settingsService()).revokeAllPreviewTokens();
  // The generation has ended every link; the rows also record when.
  await revokeAllRecordedLinks(auth.userId, new Date());

  /*
   * The counterpart to the mint row, and the one an incident actually starts
   * from: revocation is site-wide and cuts every reader off mid-session, so the
   * question afterwards is who did it and when — which nothing could answer.
   *
   * The new generation is recorded because it is what makes the two kinds of
   * row relate: every `preview-link-minted` carrying a lower generation is
   * covered by this revocation, so the trail can say which credentials a given
   * revocation actually killed rather than only that one happened.
   *
   * That correlation holds for revocations that do not overlap, which is what
   * a site-wide break-glass action normally looks like, and NOT for concurrent
   * ones. `revokeAllPreviewTokens` increments atomically and then reads the
   * counter back in a separate statement, so two revocations racing can both
   * observe the later value and record it — the increments are all applied, but
   * one actor's row names a generation another actor produced. The value is
   * recorded rather than withheld because it is the only thing that relates the
   * two kinds of row at all, and stated here rather than left to be inferred
   * because a reader correlating an incident needs to know which of those two
   * cases they are in.
   */
  await auditWriter().write({
    kind: "preview-links-revoked",
    // The credential that acted: a key, when the request carried one, with
    // its owner still in `actorUserId`.
    actorKind: auth.authMethod === "api-key" ? "apiKey" : "staff",
    actorUserId: auth.userId,
    metadata: {
      generation,
      /*
       * WHICH CREDENTIAL acted, not only whose account it belongs to.
       *
       * Unlike minting, this route accepts an API key: a key holding
       * `manage settings` can already change the settings this generation
       * lives in, so refusing it here would remove an automation capability
       * without closing anything. But `userId` on an api-key request is the
       * key's OWNER, and recording that alone would state that a person
       * personally revoked every link on the site when a delegated key did —
       * which is exactly backwards in the case this trail exists for, where a
       * key is the thing under suspicion.
       *
       * `apiKeyId` is present only on an api-key request, so `authMethod` is
       * recorded beside it rather than inferred from its absence: a session row
       * and a row whose key id failed to resolve would otherwise read alike.
       */
      authMethod: auth.authMethod,
      ...(auth.apiKeyId === undefined ? {} : { apiKeyId: auth.apiKeyId }),
    },
  });

  return respondMutation("Preview links revoked", { generation });
});
