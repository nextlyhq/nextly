/**
 * IdentityService — core's side of a login plugin's external identities.
 *
 * A listed login plugin authenticates a person at an outside provider and
 * hands the result to core; core owns the identities (the
 * `nextly_external_identities` table) and every decision that turns one into
 * a session. This service is the intake door for that hand-off and the one
 * operation that attaches an identity on purpose: it resolves a handed-over
 * identity to the account it is linked to — creating one where the key's own
 * policy lets it provision, on the primitive that owns every creation
 * refusal — and completes an explicit link a signed-in person started. It never mints a session — resolving hands the
 * caller a user id and nothing more, and a completed link attaches a row and
 * nothing more — so the only way any of this becomes a session is the
 * plugin login the resolution feeds (`ctx.auth.completeLogin`).
 *
 * The same table's read side lives here too: the listing that shows an
 * account the identities it holds, and the unlink that removes one of its
 * rows. Both are scoped to the owning account — one account's door never
 * answers for another's identities — and the unlink touches nothing but the
 * link row it names.
 *
 * The provider key a plugin names is stamped with the plugin's own name
 * before it reaches the table or a lookup, the same way its strategy names
 * are (`plugins/plugin-auth-provider`): one plugin can neither read nor
 * claim a row in another plugin's namespace, whatever key it hands over.
 * The stamped key, the issuer and the subject are then held and compared as
 * one digest (`externalIdentityKeyDigest`) — hex, bytewise-exact under
 * every collation — so a case-variant subject is a different identity on
 * every database alike, never an account the provider never named.
 * Everything a plugin asserts about the identity is parsed at this boundary
 * and refused when malformed — the payload itself, the subject, the
 * address-proof flag, and the statement that the identity passed its
 * provider's admission restriction — because a payload a plugin got wrong
 * is a programming error the plugin author must see, not a login outcome
 * the person is redirected over.
 *
 * @module domains/auth/services/identity-service
 * @since 1.0.0
 */
import { randomUUID } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { asc, eq } from "drizzle-orm";

import { readAccessTokenCookie } from "../../../auth/cookies/access-token-cookie";
import { verifyAccessToken } from "../../../auth/jwt/verify";
import { sessionTokenIsCurrent } from "../../../auth/session/session-standing";
import { loadedDialect } from "../../../database/dialect-tables";
import { toDbError } from "../../../database/errors";
import { appPasswordDigester } from "../../../di/password-digester";
import { NextlyError } from "../../../errors/nextly-error";
import { env } from "../../../lib/env";
import { bootNameOf } from "../../../plugins/plugin-consent";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import { pluginAdminSlug } from "../../../plugins/plugin-slug";
import {
  EXTERNAL_IDENTITIES_TABLE,
  externalIdentityKeyDigest,
} from "../../../schemas/external-identities";
import type { nextlyExternalIdentitiesMysql } from "../../../schemas/external-identities/mysql";
import type { nextlyExternalIdentitiesPg } from "../../../schemas/external-identities/postgres";
import type { nextlyExternalIdentitiesSqlite } from "../../../schemas/external-identities/sqlite";
import { BaseService } from "../../../services/base-service";
import type { Logger } from "../../../services/shared";
import { isUniqueViolation } from "../../../shared/lib/unique-violation";

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
 * enable is refused by `requireEnabled` before any lookup, which is the one
 * call this service makes: the answer it returns carries the branch policy
 * too, so the provisioning branch reads its permission and its roles from
 * what the gate already answered, never from anything the plugin handed
 * over. Whether an unlinked identity may be linked implicitly is another
 * slice's branch, and nothing here reads that answer.
 *
 * The unlink asks the second question, `policyFor`, the policy's
 * non-throwing read: whether an identity the account keeps is at a provider
 * still enabled, and so still a way in.
 */
export interface LinkingPolicyPort {
  requireEnabled(providerKey: string): EnabledProviderKey;
  policyFor(providerKey: string): { readonly enabled: boolean };
}

/**
 * Resolves the role names the app's configuration gives to the roles they
 * name.
 *
 * Structural over the role query service's batch slug lookup, so the real
 * service satisfies this port as it is. The SLUG is the stable identifier a
 * configuration names roles by — a display name is mutable, and a rename
 * would silently re-target what a provisioned account is created with —
 * which is also why this port has no by-name lookup to reach for. The whole
 * set is resolved in one read rather than a read per name.
 */
export interface ProvisioningRoleResolver {
  /**
   * The roles carrying any of the slugs, each with the slug it carries, in
   * no particular order; a slug no role carries is simply absent.
   */
  findRoleIdsBySlugs(
    slugs: readonly string[]
  ): Promise<Array<{ id: string; slug: string }>>;
}

/**
 * The user-creation primitive the provisioning branch runs.
 *
 * Structural over the users mutation service's `createExternalUser`, which
 * owns every refusal the creation itself can meet — the empty install, an
 * address another account already holds, a role id that is not a role,
 * super-admin direct or inherited — in one transaction with the roles it
 * assigns. Provisioning adds only what stands before the primitive: the
 * configuration's role names resolved to roles, and the identity row
 * attached after. There is no second creation path to drift from the first.
 */
export interface ExternalUserCreator {
  createExternalUser(input: {
    email: string;
    name: string;
    image?: string | null;
    roleIds: string[];
    emailVerifiedAt: Date;
    // The id as the users service types it (`MinimalUser.id`); the one
    // reader, `provisionFor`, normalizes it to the string the table stores.
  }): Promise<{ id: string | number }>;
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
 * none), the subject, the address as a column value, and the digest the table
 * holds the identity's uniqueness by.
 */
interface StampedIdentity {
  readonly providerKey: string;
  readonly issuer: string;
  readonly subject: string;
  readonly address: string | null;
  /**
   * Whether the provider proved that address — the flag the provisioning
   * branch stamps the new account's verification against, and which the
   * link never reads.
   */
  readonly addressProved: boolean;
  /** The identity's key as one comparable value, from `externalIdentityKeyDigest`. */
  readonly keyDigest: string;
}

/** One stored identity row, as the lookup reads it whole. */
interface StoredIdentityRow {
  readonly id: string;
  readonly providerKey: string;
  readonly issuer: string;
  readonly subject: string;
  readonly address: string | null;
  readonly userId: string;
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

/** The refusal when a different account holds the identity: it is never moved. */
function identityAlreadyAttached(
  binding: PluginIdentityBinding,
  identity: Pick<StampedIdentity, "providerKey">
): NextlyError {
  return NextlyError.conflict({
    message: "This identity is already linked to an account.",
    logContext: {
      reason: "identity-already-attached",
      plugin: binding.pluginName,
      providerKey: identity.providerKey,
    },
  });
}

/**
 * The answer a link gives, whether the row was just written or had already
 * stood: the stored identity's own facts, and nothing else.
 */
function attachmentOf(row: StoredIdentityRow): AttachedExternalIdentity {
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
 * Stamp and parse what a plugin handed over, refusing every malformed part.
 *
 * Shared by the sign-in hand-off and the explicit link, so the two doors
 * cannot drift apart on what an identity is: both stamp with the same
 * prefix, both refuse the same malformed payload, and only what happens
 * past this point differs. The payload itself is a part of that: a hand-off
 * that is not an object at all — null, undefined, a string — is refused as
 * the same intake validation rather than crashing on the first field read,
 * because a plugin calling with no payload is the same programming error as
 * one calling with a malformed field.
 */
function stampedIdentityOf(
  binding: PluginIdentityBinding,
  handOff: ExternalIdentityHandOff
): StampedIdentity {
  const { providerKeyPrefix } = binding;

  if (typeof handOff !== "object" || handOff === null) {
    throw intakeRefusal({
      binding,
      path: "handOff",
      reason: "identity-handoff-malformed",
      message:
        "A sign-in hand-off must be the identity's facts as an object; nothing else can be read from it.",
    });
  }

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

  const stamped = {
    providerKey: `${providerKeyPrefix}${handOff.providerKey}`,
    // "" where the provider has no issuer: the table's scheme, which keeps
    // the unique index honest on every dialect rather than only where the
    // database compares missing values as equal.
    issuer: handOff.issuer ?? "",
    subject: handOff.subject,
    address: handOff.address ?? null,
  };
  return {
    ...stamped,
    addressProved: handOff.addressProved,
    // The identity's key as one value the table holds uniqueness by. The
    // lookup below compares THIS, never the three text columns: a hex digest
    // is bytewise-identical or a different value under every collation,
    // where MySQL's default folds case and accent in the columns themselves
    // and a case-variant subject would otherwise resolve the wrong account.
    keyDigest: externalIdentityKeyDigest(
      stamped.providerKey,
      stamped.issuer,
      stamped.subject
    ),
  };
}

/**
 * What a handed-over identity resolved to. `userId` null: the identity is
 * linked to no account and the key's policy allowed core to make none — the
 * plugin has no account to finish a sign-in with, and no way to make one
 * itself.
 */
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

/**
 * One stored identity as a listing answers it: the row's own facts, plus when
 * the link was made. The table holds no provider token to leave out — nothing
 * in a listing is anything but the link's own record.
 */
export interface ListedExternalIdentity {
  readonly id: string;
  readonly providerKey: string;
  readonly issuer: string;
  readonly subject: string;
  readonly address: string | null;
  readonly userId: string;
  readonly createdAt: Date;
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
   * Resolves the provisioning roles the configuration names to the roles
   * they are. The provisioning branch refuses a name that resolves to
   * nothing before the creation primitive is reached.
   */
  readonly roles: ProvisioningRoleResolver;
  /**
   * Creates the account a provisioning key mints — active, verified, without
   * a password, with exactly the roles given, in one transaction — and owns
   * every refusal that creation can meet.
   */
  readonly users: ExternalUserCreator;
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
   * account it is linked to — creating that account, on the first sign-in,
   * where the key's own policy lets it provision.
   *
   * A linked identity resolves to its account and nothing is written,
   * whatever session the request carrying it holds and whoever is signed in
   * at the time left alone: trust for implicit linking and permission to
   * provision govern only their own branches, so an identity already linked
   * signs in through a key that has neither. An unlinked identity resolves
   * no user unless the key may provision — the answer the enabled gate
   * already returned, never anything the plugin handed over — and when it
   * may, provisioning creates the account active, verified and without a
   * password on the one primitive that owns every creation refusal, and
   * attaches the identity to it. Implicit linking is another slice's branch
   * and is not built here: a trusted key that may not provision links
   * nothing.
   *
   * Order, preconditions first: the payload is parsed and every malformed
   * part refused; then the stamped key passes the linking policy's enabled
   * gate, before any lookup, so a key the app's configuration doesn't enable
   * is refused whether or not anything is stored under it; only then is the
   * table read. The read is BY the digest of the stamped key, the issuer and
   * the subject: the digest holds all three, bytewise-exact under every
   * collation, so a subject one issuer asserted is not the identity another
   * issuer's word for the same subject would name, nor a case-variant
   * subject the identity the provider actually named, and neither resolves
   * an account here.
   */
  async resolveSignInIdentity(
    binding: PluginIdentityBinding,
    handOff: ExternalIdentityHandOff
  ): Promise<SignInResolution> {
    const identity = stampedIdentityOf(binding, handOff);
    // The one policy question this service asks, before any lookup: the
    // key's own gate. Its answer carries the branch policy too, read only
    // on the branch it governs — a linked identity signs in through a key
    // that has neither answer.
    const key = this.deps.linkingPolicy.requireEnabled(identity.providerKey);
    const row = await this.findIdentity(identity);
    if (row !== null) return { userId: row.userId };
    if (!key.provisioning.mayProvision) return { userId: null };
    return {
      userId: await this.provisionFor(binding, identity, key.provisioning),
    };
  }

  /**
   * Provision an account for an unlinked identity a provisioning key just
   * signed in, and return the account's id.
   *
   * The address is what the account is created around, and the new account
   * is created with its address stamped verified — so a hand-off without
   * one, or one the provider never proved, has nothing core may vouch for
   * and refuses before anything is written. The roles are the
   * configuration's own names for this key, resolved by slug to the roles
   * they are; a name no role carries refuses the provisioning naming the
   * role, and the empty set refuses the same way, both before the creation
   * primitive is reached. What the primitive refuses — the empty install,
   * an address another account already holds, super-admin however it is
   * reached — it refuses itself, writing nothing.
   *
   * The account made, the identity is attached to it under the digest the
   * table holds uniqueness by — the row the person's next sign-in will
   * resolve.
   */
  private async provisionFor(
    binding: PluginIdentityBinding,
    identity: StampedIdentity,
    provisioning: Extract<
      ProviderProvisioningPolicy,
      { readonly mayProvision: true }
    >
  ): Promise<string> {
    if (identity.address === null) {
      throw NextlyError.validation({
        errors: [
          {
            path: "address",
            code: "REQUIRED",
            message:
              "Provisioning needs the address the provider asserted; a hand-off without one has nothing to create the account around.",
          },
        ],
        logContext: {
          reason: "provisioning-address-missing",
          plugin: binding.pluginName,
          providerKey: identity.providerKey,
        },
      });
    }
    if (!identity.addressProved) {
      throw NextlyError.validation({
        errors: [
          {
            path: "addressProved",
            code: "INVALID",
            message:
              "Provisioning creates the account with its address already verified, which a proof the provider never made would counterfeit.",
          },
        ],
        logContext: {
          reason: "provisioning-address-unproved",
          plugin: binding.pluginName,
          providerKey: identity.providerKey,
        },
      });
    }

    const configured = provisioning.roles;
    if (configured.length === 0) {
      throw NextlyError.validation({
        errors: [
          {
            path: "provision.roles",
            code: "REQUIRED",
            message:
              "A provisioning key must name the roles it provisions; an account created by arriving through a provider carries an explicit privilege decision or none is made.",
          },
        ],
        logContext: {
          reason: "provisioning-roles-empty",
          plugin: binding.pluginName,
          providerKey: identity.providerKey,
        },
      });
    }
    // By slug, the stable identifier a configuration names roles by, the
    // whole distinct set resolved in ONE read, then walked in the
    // configuration's own order: the first name that resolves to nothing
    // refuses the whole provisioning here, naming that role, before the
    // creation primitive is reached — its own in-transaction existence
    // check stays the backstop for a role deleted between the mapping and
    // the insert. The answer is matched to the names bytewise, so a
    // case-variant name refuses on every dialect alike rather than
    // resolving on MySQL's case-insensitive collation alone.
    const distinct = [...new Set(configured)];
    const idBySlug = new Map(
      (await this.deps.roles.findRoleIdsBySlugs(distinct)).map(role => [
        role.slug,
        role.id,
      ])
    );
    const roleIds: string[] = [];
    for (const slug of distinct) {
      const id = idBySlug.get(slug);
      if (id === undefined) {
        throw NextlyError.validation({
          errors: [
            {
              path: "provision.roles",
              code: "INVALID",
              message: `The provisioning role "${slug}" does not exist.`,
            },
          ],
          logContext: {
            reason: "provisioning-role-unknown",
            role: slug,
            plugin: binding.pluginName,
            providerKey: identity.providerKey,
          },
        });
      }
      roleIds.push(id);
    }

    // The provider asserted no name for the person — the hand-off carries
    // none — so the account's name is the address it is created around: the
    // one string the provider vouched for, and nothing invented here.
    const created = await this.deps.users.createExternalUser({
      email: identity.address,
      name: identity.address,
      roleIds,
      // The provider proved the address, and the account is created at the
      // sign-in that carries that proof.
      emailVerifiedAt: new Date(),
    });
    // Users ids are text in every dialect; the primitive's type merely admits a number.
    const userId = String(created.id);

    // The identity row, attached to the account it made, under the digest
    // the table holds uniqueness by. Two first sign-ins racing each other
    // both pass the read that precedes this; the digest's unique index is
    // what actually refuses the second, as it refuses the link's race.
    const row = {
      id: randomUUID(),
      providerKey: identity.providerKey,
      issuer: identity.issuer,
      subject: identity.subject,
      keyDigest: identity.keyDigest,
      address: identity.address,
      userId,
      createdAt: new Date(),
    };
    try {
      await this.db.insert(this.identitiesTable).values(row);
    } catch (error) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }
    return userId;
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
   *
   * An identity already stored under the same digest is the link's one
   * repeated case, and who holds it decides: the SAME account's link has
   * already stood, so completing it again answers with the stored row as it
   * is — no error, no second row — while a DIFFERENT account's identity is
   * never moved: it refuses, and the accounts keep what they hold. The
   * unique index on the digest decides the same way for two links that
   * race each other past the read.
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

    // An identity already stored under the same digest is the link's one
    // repeated case, and who holds it decides: the account that started this
    // link has nothing to do — the link already stands, so the operation
    // answers with the row exactly as it is stored and writes no second row —
    // while a different account's identity is never moved: it refuses, and
    // the accounts keep what they hold.
    const existing = await this.findIdentity(identity);
    if (existing !== null) {
      if (existing.userId === input.context.userId) {
        return attachmentOf(existing);
      }
      throw identityAlreadyAttached(binding, identity);
    }

    const row = {
      id: randomUUID(),
      providerKey: identity.providerKey,
      issuer: identity.issuer,
      subject: identity.subject,
      keyDigest: identity.keyDigest,
      address: identity.address,
      userId: input.context.userId,
      createdAt: new Date(),
    };
    try {
      await this.db.insert(this.identitiesTable).values(row);
    } catch (error) {
      // Two links for one identity racing each other both pass the read
      // above; the table's unique index on the digest is what actually
      // refuses the second. Whoever won the race decides the answer by the
      // same rule as that read: the same account's link has already stood —
      // answer with the stored row — and a different account's is the same
      // conflict, not an outage.
      if (isUniqueViolation(error)) {
        const winner = await this.findIdentity(identity);
        if (winner !== null && winner.userId === input.context.userId) {
          return attachmentOf(winner);
        }
        throw identityAlreadyAttached(binding, identity);
      }
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    return attachmentOf(row);
  }

  /**
   * List one account's external identities: every row the account owns, in
   * the order the links were made, and nothing else.
   *
   * Read through the owner index the table carries for exactly this
   * question, so a listing is one query however many identities other
   * accounts hold. No policy is asked — which keys are enabled governs
   * sign-ins, not what a person or an administrator is shown about the links
   * that already exist.
   */
  async listExternalIdentities(
    userId: string
  ): Promise<ListedExternalIdentity[]> {
    const rows = await this.db
      .select({
        id: this.identitiesTable.id,
        providerKey: this.identitiesTable.providerKey,
        issuer: this.identitiesTable.issuer,
        subject: this.identitiesTable.subject,
        address: this.identitiesTable.address,
        userId: this.identitiesTable.userId,
        createdAt: this.identitiesTable.createdAt,
      })
      .from(this.identitiesTable)
      .where(eq(this.identitiesTable.userId, userId))
      // The link order, with the id as the tiebreak: two links made in one
      // stored moment keep a stable order however the database returns them.
      .orderBy(
        asc(this.identitiesTable.createdAt),
        asc(this.identitiesTable.id)
      );
    return rows;
  }

  /**
   * Unlink one external identity: remove the link row, and nothing else.
   *
   * The removal is scoped to the owning account — an identity another
   * account holds is not unlinkable through this door, and answers exactly
   * as an identity nobody holds does, so a caller learns nothing about
   * whose row an id names. No session, token or account is touched: whoever
   * was signed in through the identity stays signed in by the session they
   * hold, and signs in differently only next time.
   *
   * An account is never left with no way in (the single sign-on spec's
   * L8): with no password, the unlink is refused unless the account keeps
   * another identity at a provider the linking policy still enables. An
   * identity at a disabled provider is no way in, so it does not count.
   *
   * The check and the removal are one transaction under the lock on the
   * account's row, so two unlinks for one account take turns: the second
   * reads what the first left, and two at once can never remove the last
   * way in together. SQLite's transactions are already serialized, which
   * the same lock call answers there.
   */
  async unlinkExternalIdentity(
    userId: string,
    identityId: string
  ): Promise<void> {
    await this.adapter.transaction(async tx => {
      await tx.lockRow("users", userId);
      const held = await tx.select<{ id: unknown; providerKey: unknown }>(
        EXTERNAL_IDENTITIES_TABLE,
        {
          columns: ["id", "providerKey"],
          where: { and: [{ column: "userId", op: "=", value: userId }] },
        }
      );
      if (!held.some(row => String(row.id) === identityId)) {
        // The one refusal for a row that is absent and a row another
        // account owns alike: the account's own rows are all that was read,
        // so the answer cannot tell the two apart.
        throw NextlyError.notFound({
          message: "No such identity for this user.",
          logContext: { reason: "identity-not-held", userId, identityId },
        });
      }
      const anotherWayIn = held.some(
        row =>
          String(row.id) !== identityId &&
          this.deps.linkingPolicy.policyFor(String(row.providerKey)).enabled
      );
      if (!anotherWayIn && !(await this.holdsPassword(tx, userId))) {
        throw NextlyError.conflict({
          reason: "state",
          message:
            "This is the account's last way to sign in. Set a password or link another account first.",
          logContext: { reason: "identity-last-way-in", userId, identityId },
        });
      }
      await tx.delete(EXTERNAL_IDENTITIES_TABLE, {
        and: [
          { column: "id", op: "=", value: identityId },
          { column: "userId", op: "=", value: userId },
        ],
      });
    });
  }

  /**
   * Whether the account has a password to sign in with, read in the unlink's
   * transaction: a stored value the app's password digester takes for a
   * hash, the same answer the users service gives an account's
   * `hasPassword`. A value it does not take signs nobody in, so it is no
   * way in.
   */
  private async holdsPassword(
    tx: TransactionContext,
    userId: string
  ): Promise<boolean> {
    const [user] = await tx.select<{ passwordHash: unknown }>("users", {
      columns: ["passwordHash"],
      where: { and: [{ column: "id", op: "=", value: userId }] },
    });
    return appPasswordDigester().isHash(user?.passwordHash);
  }

  /**
   * The identity row for one digest, or null.
   *
   * The one lookup both doors share, so the sign-in's resolution and the
   * link's duplicate refusal can never disagree about whether an identity is
   * stored. It reads BY the digest and never by the key's three text
   * columns: the digest is either bytewise the same or a different value
   * under every collation, where the columns themselves fold case and accent
   * on MySQL and a case-variant subject would resolve an account the
   * provider never named. The whole row comes back, because the link's
   * answer to a repeated link is the stored row as it stands.
   */
  private async findIdentity(
    identity: Pick<StampedIdentity, "keyDigest">
  ): Promise<StoredIdentityRow | null> {
    const rows = await this.db
      .select({
        id: this.identitiesTable.id,
        providerKey: this.identitiesTable.providerKey,
        issuer: this.identitiesTable.issuer,
        subject: this.identitiesTable.subject,
        address: this.identitiesTable.address,
        userId: this.identitiesTable.userId,
      })
      .from(this.identitiesTable)
      .where(eq(this.identitiesTable.keyDigest, identity.keyDigest))
      .limit(1);
    return rows[0] ?? null;
  }
}
