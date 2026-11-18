/**
 * IdentityService — core's side of a login plugin's external identities.
 *
 * A listed login plugin authenticates a person at an outside provider and
 * hands the result to core; core owns the identities (the
 * `nextly_external_identities` table) and every decision that turns one into
 * a session. This service is the intake door for that hand-off and the one
 * operation that attaches an identity on purpose: it resolves a handed-over
 * identity to the account it is linked to, and completes an explicit link a
 * signed-in person started. It never mints a session — resolving hands the
 * caller a user id and nothing more, and a completed link attaches a row and
 * nothing more — so the only way any of this becomes a session is the
 * plugin login the resolution feeds (`ctx.auth.completeLogin`).
 *
 * The provider key a plugin names is stamped with the plugin's own name
 * before it reaches the table or a lookup, the same way its strategy names
 * are (`plugins/plugin-auth-provider`): one plugin can neither read nor
 * claim a row in another plugin's namespace, whatever key it hands over.
 * Everything a plugin asserts about the identity is parsed at this boundary
 * and refused when malformed — the subject, the address-proof flag, and the
 * statement that the identity passed its provider's admission restriction —
 * because a payload a plugin got wrong is a programming error the plugin
 * author must see, not a login outcome the person is redirected over.
 *
 * @module domains/auth/services/identity-service
 * @since 1.0.0
 */
import { randomUUID } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq } from "drizzle-orm";

import { readAccessTokenCookie } from "../../../auth/cookies/access-token-cookie";
import { verifyAccessToken } from "../../../auth/jwt/verify";
import { sessionTokenIsCurrent } from "../../../auth/session/session-standing";
import { loadedDialect } from "../../../database/dialect-tables";
import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors/nextly-error";
import { env } from "../../../lib/env";
import { bootNameOf } from "../../../plugins/plugin-consent";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { pluginAdminSlug } from "../../../plugins/plugin-slug";
import type { nextlyExternalIdentitiesMysql } from "../../../schemas/external-identities/mysql";
import type { nextlyExternalIdentitiesPg } from "../../../schemas/external-identities/postgres";
import type { nextlyExternalIdentitiesSqlite } from "../../../schemas/external-identities/sqlite";
import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";

/**
 * Whether a provider key may provision accounts, and with which roles.
 *
 * A structural copy of the linking policy's own shape, so the policy module
 * satisfies this port as it is once it is wired here. The hand-off calls
 * through it once, to gate a key the configuration doesn't enable; the
 * branches this type describes govern linking and provisioning, which are
 * not this service's questions.
 */
export type ProviderProvisioningPolicy =
  | { readonly mayProvision: false }
  | { readonly mayProvision: true; readonly roles: readonly string[] };

/**
 * A provider key the configuration enables, as the linking policy resolved
 * it. Only the fields the hand-off's one gate call needs are declared; the
 * policy's own type carries them and more.
 */
export interface EnabledProviderKey {
  readonly providerKey: string;
  readonly trustedForImplicitLinking: boolean;
  readonly provisioning: ProviderProvisioningPolicy;
}

/**
 * The linking policy this service asks its one question through.
 *
 * Structural, matching the linking-policy module's public shape, so the real
 * policy — resolved from the app's own auth configuration — is handed to
 * this service as it is. A sign-in for a key the configuration doesn't
 * enable is refused by `requireEnabled` before any lookup, which is the only
 * question this service asks: whether an unlinked identity may be linked
 * implicitly, or provision an account, is decided elsewhere, by the slices
 * that own those branches.
 */
export interface LinkingPolicyPort {
  requireEnabled(providerKey: string): EnabledProviderKey;
}

/** What a listed login plugin hands over about one external identity. */
export interface ExternalIdentityHandOff {
  /** The provider's own key for the provider, as the plugin names it. The plugin's own name is stamped onto it here. */
  readonly providerKey: string;
  /** The issuer that asserted the identity, where the provider has one. Absent where it has none. */
  readonly issuer?: string;
  /** The subject: the issuer's stable identifier for the person. */
  readonly subject: string;
  /** The address the provider asserted for the person, if it asserted one. */
  readonly address?: string | null;
  /** Whether the provider proved the address. Strictly boolean; anything else is a programming error in the plugin. */
  readonly addressProved: boolean;
  /**
   * The plugin's statement that the identity passed its provider's admission
   * restriction — the provider's domain, tenant or organization. Parsed as
   * strictly as the proof flag, and refused when false: a plugin that vouches
   * for an identity its provider would not admit is handing core a person
   * the provider never said was theirs to send.
   */
  readonly passedAdmissionRestriction: boolean;
}

/**
 * One plugin's claim on the identity table, snapshotted when the plugin's
 * context was built.
 *
 * The name is the one the boot resolved the plugin under, not the live
 * definition's own `name` — `init` runs as a method on the definition and
 * could rename an unlisted plugin onto a listed one's key — the same
 * snapshot-and-verdict-travel-together rule `ctx.auth.completeLogin`'s
 * strategy prefix follows.
 */
export interface PluginIdentityBinding {
  /** The boot-resolved plugin name, for logs. */
  readonly pluginName: string;
  /** What every provider key this plugin hands over is stamped with. */
  readonly providerKeyPrefix: string;
}

/**
 * Snapshot a plugin's identity-table namespace, once per plugin context.
 *
 * The prefix is the plugin's admin slug and a colon, matching the strategy
 * names the same plugin records logins under, so both spellings of "which
 * plugin handled this" agree.
 */
export function pluginIdentityBinding(
  plugin: PluginDefinition
): PluginIdentityBinding {
  const pluginName = bootNameOf(plugin);
  return Object.freeze({
    pluginName,
    providerKeyPrefix: `${pluginAdminSlug(pluginName)}:`,
  });
}

/** The session a link completes in: who is signed in, on which token. */
export interface CompletingSession {
  readonly userId: string;
  readonly sessionJti: string;
}

/**
 * Reads the session of the request that completes a link.
 *
 * A port so the link operation can be tested against sessions without
 * minting them, and answered by core's own session read everywhere else.
 */
export type CompletingSessionReader = (
  request: Request
) => Promise<CompletingSession | null>;

/**
 * The session of a request, read the way every session is read: the cookie's
 * token verified against the secret, then judged against the account's
 * standing. Null when the request carries no session a signed-in person
 * holds — no token, an invalid or expired one, or an account that may no
 * longer use it.
 */
async function sessionOfCompletingRequest(
  request: Request
): Promise<CompletingSession | null> {
  const token = readAccessTokenCookie(request);
  if (token === null) return null;
  const verified = await verifyAccessToken(token, env.NEXTLY_SECRET || "");
  if (!verified.valid) return null;
  if (!(await sessionTokenIsCurrent(verified.payload))) return null;
  const { sub, jti } = verified.payload;
  if (
    typeof sub !== "string" ||
    sub === "" ||
    typeof jti !== "string" ||
    jti === ""
  ) {
    return null;
  }
  return { userId: sub, sessionJti: jti };
}

/**
 * What everything the hand-off validates an identity down to: the stamped
 * provider key, the issuer as the table stores it ("" where the provider has
 * none), the subject, and the address as a column value.
 */
interface StampedIdentity {
  readonly providerKey: string;
  readonly issuer: string;
  readonly subject: string;
  readonly address: string | null;
}

/** A refused intake, as a validation error the plugin author sees. */
function intakeRefusal(options: {
  binding: PluginIdentityBinding;
  path: string;
  reason: string;
  message: string;
}): NextlyError {
  return NextlyError.validation({
    errors: [{ path: options.path, code: "INVALID", message: options.message }],
    logContext: { reason: options.reason, plugin: options.binding.pluginName },
  });
}

/**
 * Stamp and parse what a plugin handed over, refusing every malformed part.
 *
 * Shared by the sign-in hand-off and the explicit link, so the two doors
 * cannot drift apart on what an identity is: both stamp with the same
 * prefix, both refuse the same malformed payload, and only what happens
 * past this point differs.
 */
function stampedIdentityOf(
  binding: PluginIdentityBinding,
  handOff: ExternalIdentityHandOff
): StampedIdentity {
  const { providerKeyPrefix } = binding;

  if (
    typeof handOff.providerKey !== "string" ||
    handOff.providerKey.length === 0
  ) {
    throw intakeRefusal({
      binding,
      path: "providerKey",
      reason: "identity-provider-key-missing",
      message:
        "A sign-in hand-off must name the provider's key; the plugin's own name is stamped onto it here.",
    });
  }

  if (typeof handOff.subject !== "string" || handOff.subject.length === 0) {
    throw intakeRefusal({
      binding,
      path: "subject",
      reason: "identity-subject-missing",
      message:
        "A sign-in hand-off must carry the provider's subject for the person; a missing or empty one resolves nobody.",
    });
  }

  if (handOff.issuer !== undefined && typeof handOff.issuer !== "string") {
    throw intakeRefusal({
      binding,
      path: "issuer",
      reason: "identity-issuer-malformed",
      message:
        "A sign-in hand-off's issuer, where it has one, must be a string.",
    });
  }

  // The address is the provider's assertion, not a local fact: null where
  // the provider asserted none, kept exactly as given otherwise. The local
  // account's address is never rewritten from it, and a link attaches
  // without the two ever being compared.
  if (
    handOff.address !== undefined &&
    handOff.address !== null &&
    typeof handOff.address !== "string"
  ) {
    throw intakeRefusal({
      binding,
      path: "address",
      reason: "identity-address-malformed",
      message:
        "A sign-in hand-off's address, where it has one, must be a string.",
    });
  }

  // Strictly boolean: the flag decides whether the provider vouched for the
  // address, and a truthy value of another type would answer a question it
  // was never asked. Missing is malformed here, not a default: a plugin that
  // omits it has not said either way.
  if (typeof handOff.addressProved !== "boolean") {
    throw intakeRefusal({
      binding,
      path: "addressProved",
      reason: "identity-address-proof-malformed",
      message:
        "A sign-in hand-off must say whether the provider proved the address, as a boolean.",
    });
  }

  // Parsed as strictly as the proof flag, and refused when negative: the
  // plugin is the only party that knows the provider's restriction, so its
  // statement is the whole of what core can ask, and an identity the plugin
  // itself says was outside it is refused whatever else the payload claims.
  if (typeof handOff.passedAdmissionRestriction !== "boolean") {
    throw intakeRefusal({
      binding,
      path: "passedAdmissionRestriction",
      reason: "identity-admission-statement-malformed",
      message:
        "A sign-in hand-off must state, as a boolean, whether the identity passed its provider's admission restriction.",
    });
  }
  if (handOff.passedAdmissionRestriction !== true) {
    throw intakeRefusal({
      binding,
      path: "passedAdmissionRestriction",
      reason: "identity-admission-statement-negative",
      message:
        "An identity its own plugin reports as outside its provider's admission restriction is refused.",
    });
  }

  return {
    providerKey: `${providerKeyPrefix}${handOff.providerKey}`,
    // "" where the provider has no issuer: the table's scheme, which keeps
    // the unique index honest on every dialect rather than only where the
    // database compares missing values as equal.
    issuer: handOff.issuer ?? "",
    subject: handOff.subject,
    address: handOff.address ?? null,
  };
}

/** What a handed-over identity resolved to. `userId` null: no linked account in this slice. */
export interface SignInResolution {
  readonly userId: string | null;
}

/** What an explicit link attached: the identity row's own facts, and nothing else. */
export interface AttachedExternalIdentity {
  readonly identity: {
    readonly id: string;
    readonly providerKey: string;
    readonly issuer: string;
    readonly subject: string;
    readonly address: string | null;
    readonly userId: string;
  };
}

/** An explicit link as the plugin hands it over: the identity, and the context it started in. */
export interface ExplicitLinkInput {
  readonly identity: ExternalIdentityHandOff;
  /**
   * The link's context: the user who started the link and the session token
   * they started it in (that token's `jti`). The link completes only for
   * that user, still signed in on that same token.
   */
  readonly context: { readonly userId: string; readonly sessionJti: string };
  /** The request the provider returned to, carrying the completing session. */
  readonly completingRequest: Request;
}

/** Everything the service needs beyond the database. */
export interface IdentityServiceDeps {
  /** The linking policy, resolved from the app's own auth configuration. */
  readonly linkingPolicy: LinkingPolicyPort;
  /**
   * How the completing request's session is read. Defaults to core's own
   * session read; a port so the link's session rules can be tested without
   * minting tokens.
   */
  readonly sessionOf?: CompletingSessionReader;
}

export class IdentityService extends BaseService {
  private identitiesTable:
    | typeof nextlyExternalIdentitiesPg
    | typeof nextlyExternalIdentitiesMysql
    | typeof nextlyExternalIdentitiesSqlite;
  private readonly deps: IdentityServiceDeps;

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    deps: IdentityServiceDeps
  ) {
    super(adapter, logger);
    this.deps = deps;
    // The loaded dialect's own tables, so only that dialect's files are
    // imported; `createAdapter` loads them.
    this.identitiesTable = loadedDialect(
      this.dialect
    ).tables.nextlyExternalIdentities;
  }

  /**
   * Take a finished sign-in for an external identity and resolve it to the
   * account it is linked to.
   *
   * This is the whole of the sign-in side: it writes nothing — not the
   * address, not a link, not a row for an identity nobody holds — so an
   * unlinked identity resolves no user here whatever session the request
   * carrying it holds, and whoever is signed in at the time is left alone.
   * Linking an unlinked identity, implicitly or by provisioning, is another
   * slice's branch; this door only answers "whose account is this, if any".
   *
   * Order, preconditions first: the payload is parsed and every malformed
   * part refused; then the stamped key passes the linking policy's enabled
   * gate, before any lookup, so a key the app's configuration doesn't enable
   * is refused whether or not anything is stored under it; only then is the
   * table read. The issuer is part of the lookup key: a subject one issuer
   * asserted is not the identity another issuer's word for the same subject
   * would name, and resolves no account here.
   */
  async resolveSignInIdentity(
    binding: PluginIdentityBinding,
    handOff: ExternalIdentityHandOff
  ): Promise<SignInResolution> {
    const identity = stampedIdentityOf(binding, handOff);
    // The one policy question this service asks, before any lookup: the
    // key's own gate. Branch answers (implicit-link trust, provisioning)
    // are not read here — a linked identity signs in through a key that has
    // neither.
    this.deps.linkingPolicy.requireEnabled(identity.providerKey);
    const row = await this.findIdentity(identity);
    return { userId: row?.userId ?? null };
  }

  /**
   * Complete an explicit link a signed-in person started: attach the
   * identity to their account, and issue nothing.
   *
   * Never a sign-in: the identity is attached without matching addresses —
   * the person's own request is what vouches for the pairing, so the
   * provider's address and the account's are not compared — and no session
   * comes out of it. Whoever completes the link is already signed in, and
   * the operation's answer is the attached row alone.
   *
   * It completes only for the person who started it, still signed in in the
   * session they started it in: the completing request's session must
   * verify, its account must still stand behind its token, the token's user
   * must be the context's user, and the token itself (`jti`) must be the
   * one the link started with. Anything else — another session, another
   * user, a sign-out since — refuses the link before anything is written.
   * An identity already stored under the same key, issuer and subject is
   * never moved: it refuses, and the accounts keep what they hold.
   */
  async completeExplicitLink(
    binding: PluginIdentityBinding,
    input: ExplicitLinkInput
  ): Promise<AttachedExternalIdentity> {
    const identity = stampedIdentityOf(binding, input.identity);

    // The port when a test supplies one, core's own session read otherwise.
    const readSession = this.deps.sessionOf ?? sessionOfCompletingRequest;
    const session = await readSession(input.completingRequest);
    // Which of the three session rules failed, for the operator's log; the
    // person is refused the same generic refusal whichever it was.
    let refusalReason: string | null = null;
    if (session === null) {
      refusalReason = "link-completing-session-invalid";
    } else if (session.userId !== input.context.userId) {
      refusalReason = "link-completing-session-wrong-user";
    } else if (session.sessionJti !== input.context.sessionJti) {
      refusalReason = "link-completing-session-wrong-token";
    }
    if (refusalReason !== null) {
      throw NextlyError.forbidden({
        logContext: {
          reason: refusalReason,
          plugin: binding.pluginName,
          contextUserId: input.context.userId,
        },
      });
    }

    if ((await this.findIdentity(identity)) !== null) {
      throw NextlyError.conflict({
        message: "This identity is already linked to an account.",
        logContext: {
          reason: "identity-already-attached",
          plugin: binding.pluginName,
          providerKey: identity.providerKey,
        },
      });
    }

    const row = {
      id: randomUUID(),
      providerKey: identity.providerKey,
      issuer: identity.issuer,
      subject: identity.subject,
      address: identity.address,
      userId: input.context.userId,
      createdAt: new Date(),
    };
    try {
      await this.db.insert(this.identitiesTable).values(row);
    } catch (error) {
      // Two links for one identity racing each other both pass the read
      // above; the table's unique index is what actually refuses the second,
      // so its violation is the same conflict, not an outage.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    return {
      identity: {
        id: row.id,
        providerKey: row.providerKey,
        issuer: row.issuer,
        subject: row.subject,
        address: row.address,
        userId: row.userId,
      },
    };
  }

  /**
   * The identity row for one stamped key, issuer and subject, or null.
   *
   * The one lookup both doors share, so the sign-in's resolution and the
   * link's duplicate refusal can never disagree about whether an identity is
   * stored.
   */
  private async findIdentity(
    identity: Pick<StampedIdentity, "providerKey" | "issuer" | "subject">
  ): Promise<{ userId: string } | null> {
    const rows = await this.db
      .select({ userId: this.identitiesTable.userId })
      .from(this.identitiesTable)
      .where(
        and(
          eq(this.identitiesTable.providerKey, identity.providerKey),
          eq(this.identitiesTable.issuer, identity.issuer),
          eq(this.identitiesTable.subject, identity.subject)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
