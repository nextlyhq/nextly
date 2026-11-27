/**
 * The one token service for the credentials the command line and agents
 * hold: CLI sign-ins, agent passes, and (once the chat-app door issues them)
 * chat-app passes. It issues them, renews sign-ins, revokes them, and
 * verifies an access token for one door.
 *
 * - A sign-in gets a 15-minute access token and a refresh token. Every
 *   renewal replaces the refresh token; an unused sign-in ends 30 days after
 *   its last renewal, and every sign-in ends 90 days after it was made.
 * - A refresh token presented again after it was replaced revokes the
 *   sign-in and every credential issued from it (its family), since one of
 *   the two holders of that token is not its owner and the site cannot tell
 *   which.
 * - An agent pass is made from a live sign-in, lasts 4 hours and never past
 *   that sign-in, and has no refresh token.
 * - Only hashes of refresh tokens are stored. Access tokens are signed, not
 *   stored; each carries its purpose in its header and its credential's id,
 *   and the verifier reads the credential's row on every call, so a revoked
 *   credential is refused at once rather than when its token runs out.
 *
 * Nothing here decides what the caller may do: the door that verifies a
 * token resolves its person and runs every check as that person.
 *
 * @module auth/cli-credentials/service
 */
import { decodeProtectedHeader } from "jose";

import { NextlyError } from "../../errors/nextly-error";
import { signAccessTokenWithExpiry } from "../jwt/sign";
import { verifyToken } from "../jwt/verify";

import {
  CLI_CREDENTIAL_LIFETIMES,
  doorOf,
  purposeOfTokenTyp,
  purposesFor,
  tokenPurposeOf,
  type CliCredentialDoor,
  type CliCredentialPurpose,
} from "./purposes";
import {
  hashRefreshToken,
  mintRefreshToken,
  newCredentialId,
  parseRefreshToken,
  refreshTokenTagHolds,
  type ParsedRefreshToken,
} from "./refresh-token";
import type {
  CliCredentialRevokeReason,
  CliCredentialRow,
  CliCredentialStore,
} from "./store";

/** What a sign-in or a renewal hands the command line. */
export interface CliSignInTokens {
  credentialId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  /** When the sign-in ends whatever its use: 90 days after it was made. */
  signInEndsAt: Date;
}

/** Why a token was refused. Callers answer every reason alike. */
export type CliCredentialRefusal =
  /** Not a token this site issued, or its credential is gone. */
  | "invalid"
  /** Past its end: the access token's, the idle end, or the sign-in's. */
  | "expired"
  /** Its credential, or the sign-in it came from, was revoked. */
  | "revoked"
  /** A refresh token already replaced; the sign-in is now revoked. */
  | "reused"
  /** A credential for another door. */
  | "wrong-door";

/** A credential an access token was accepted for. */
export interface VerifiedCliCredential {
  credentialId: string;
  purpose: CliCredentialPurpose;
  userId: string;
  /** The sign-in it descends from: its own id for a sign-in. */
  familyId: string;
  parentId: string | null;
  agentName: string | null;
  machine: string | null;
}

export type CliCredentialResult<T> =
  | ({ ok: true } & T)
  | { ok: false; reason: CliCredentialRefusal };

export interface CliCredentialService {
  /** Make a sign-in for a person on a machine, after they approved it. */
  signIn(input: {
    userId: string;
    machine: string | null;
  }): Promise<CliSignInTokens>;
  /** Replace a sign-in's refresh token and issue a new access token. */
  renew(refreshToken: string): Promise<CliCredentialResult<CliSignInTokens>>;
  /** Make an agent pass from a live sign-in. */
  issueAgentPass(input: {
    signInId: string;
    agentName: string | null;
    machine: string | null;
  }): Promise<
    CliCredentialResult<{
      credentialId: string;
      accessToken: string;
      expiresAt: Date;
    }>
  >;
  /**
   * Accept an access token at a door: a token of a purpose the door takes,
   * signed by this site, whose credential and sign-in still stand.
   */
  verify(
    accessToken: string,
    door: CliCredentialDoor
  ): Promise<CliCredentialResult<{ credential: VerifiedCliCredential }>>;
  /**
   * End a credential now. Ending a sign-in ends every credential issued from
   * it; ending a pass ends that pass. False when there is no such
   * credential.
   */
  revoke(
    credentialId: string,
    reason: CliCredentialRevokeReason
  ): Promise<boolean>;
}

export interface CliCredentialServiceDeps {
  store: CliCredentialStore;
  /** The site's signing secret, `NEXTLY_SECRET`. */
  secret: string;
}

/** The purpose an access token's header names, or null for any other. */
function purposeOfHeader(token: string): CliCredentialPurpose | null {
  try {
    return purposeOfTokenTyp(decodeProtectedHeader(token).typ);
  } catch {
    return null;
  }
}

type Refused = { ok: false; reason: CliCredentialRefusal };

function refused(reason: CliCredentialRefusal): Refused {
  return { ok: false, reason };
}

/**
 * Why a sign-in can no longer be renewed or make a pass, or null while it
 * stands: revoked, past its 90-day end, or unused past its idle end.
 */
function signInRefusal(
  row: CliCredentialRow,
  now: number
): CliCredentialRefusal | null {
  if (row.revokedAt !== null) return "revoked";
  if (now >= row.endsAt || now >= (row.idleEndsAt ?? row.endsAt)) {
    return "expired";
  }
  return null;
}

/** What an access token claims, once its signature and purpose hold. */
interface AccessClaims {
  purpose: CliCredentialPurpose;
  sub: string;
  cid: string;
}

/**
 * Read an access token presented at a door: its header must name a purpose
 * the door takes, which refuses a token for another door before any row is
 * read, and it must verify as that purpose under the site's secret.
 */
async function readAccessToken(
  token: string,
  door: CliCredentialDoor,
  secret: string
): Promise<AccessClaims | Refused> {
  const purpose = purposeOfHeader(token);
  if (!purpose) return refused("invalid");
  if (!purposesFor(door).includes(purpose)) return refused("wrong-door");
  const verified = await verifyToken(token, secret, tokenPurposeOf(purpose));
  if (!verified.valid) {
    return refused(verified.reason === "expired" ? "expired" : "invalid");
  }
  const { sub, cid } = verified.payload;
  if (typeof sub !== "string" || typeof cid !== "string") {
    return refused("invalid");
  }
  return { purpose, sub, cid };
}

/**
 * Why a credential's row refuses what its token claims at a door, or null
 * when it stands. The row decides, not the token: its purpose, person and
 * door must be the token's, and it must be neither revoked nor ended.
 */
function rowRefusal(
  row: CliCredentialRow | null,
  claims: AccessClaims,
  door: CliCredentialDoor,
  now: number
): CliCredentialRefusal | null {
  if (!row || row.purpose !== claims.purpose || row.userId !== claims.sub) {
    return "invalid";
  }
  if (row.door !== door) return "wrong-door";
  if (row.revokedAt !== null) return "revoked";
  if (now >= row.endsAt) return "expired";
  return null;
}

function verifiedOf(row: CliCredentialRow): VerifiedCliCredential {
  return {
    credentialId: row.id,
    purpose: row.purpose,
    userId: row.userId,
    familyId: row.familyId,
    parentId: row.parentId,
    agentName: row.agentName,
    machine: row.machine,
  };
}

/** The service over a store and the site's secret. */
export function createCliCredentialService(
  deps: CliCredentialServiceDeps
): CliCredentialService {
  const { store, secret } = deps;
  if (!secret) {
    // Without a secret every token would be signed with an empty key.
    throw NextlyError.internal({
      logContext: { reason: "cli-credentials-without-secret" },
    });
  }
  const lifetimes = CLI_CREDENTIAL_LIFETIMES;

  async function accessTokenFor(
    row: Pick<CliCredentialRow, "id" | "userId" | "purpose" | "endsAt">
  ): Promise<{ token: string; expiresAt: Date }> {
    // A sign-in's token lasts 15 minutes and is renewed with its refresh
    // token. A pass has no refresh token, so its token is the pass and runs
    // to the pass's end. Neither is ever valid past the credential's end.
    const ttlSeconds =
      row.purpose === "cli-sign-in"
        ? lifetimes.accessTokenSeconds
        : Math.max(0, Math.ceil((row.endsAt - Date.now()) / 1000));
    return signAccessTokenWithExpiry(
      { sub: row.userId, cid: row.id },
      secret,
      ttlSeconds,
      tokenPurposeOf(row.purpose),
      row.endsAt
    );
  }

  async function findOne(id: string): Promise<CliCredentialRow | null> {
    const [row] = await store.find([id]);
    return row ?? null;
  }

  /**
   * A pass stands only while its sign-in does, whatever its own row says: a
   * revocation of the family that raced the pass's making still ends it.
   */
  async function familyRefusal(
    row: CliCredentialRow
  ): Promise<CliCredentialRefusal | null> {
    if (row.familyId === row.id) return null;
    const root = await findOne(row.familyId);
    return !root || root.revokedAt !== null ? "revoked" : null;
  }

  /**
   * A refresh token that is not the sign-in's current one. One this site
   * issued at an earlier generation was replaced, and its return means two
   * holders: end the sign-in and everything issued from it. Anything else is
   * refused and changes nothing.
   */
  async function refuseStaleToken(
    row: CliCredentialRow,
    parsed: ParsedRefreshToken
  ): Promise<Refused> {
    if (
      parsed.generation < row.refreshGeneration &&
      refreshTokenTagHolds(secret, parsed)
    ) {
      await store.revoke(
        { familyId: row.familyId },
        Date.now(),
        "refresh-reused"
      );
      return refused("reused");
    }
    return refused("invalid");
  }

  /** Replace a standing sign-in's refresh token, and sign a new access token. */
  async function rotate(
    row: CliCredentialRow,
    now: number
  ): Promise<CliCredentialResult<CliSignInTokens>> {
    const replacement = mintRefreshToken(
      secret,
      row.id,
      row.refreshGeneration + 1
    );
    const moved = await store.rotate({
      id: row.id,
      fromGeneration: row.refreshGeneration,
      refreshTokenHash: hashRefreshToken(replacement),
      usedAt: now,
      idleEndsAt: Math.min(now + lifetimes.signInIdleMs, row.endsAt),
    });
    if (!moved) {
      // Another renewal spent this token between the read and the write, or
      // the sign-in was revoked meanwhile. Either way the token was presented
      // twice: the same answer as a replay.
      await store.revoke({ familyId: row.familyId }, now, "refresh-reused");
      return refused("reused");
    }
    const access = await accessTokenFor(row);
    return {
      ok: true,
      credentialId: row.id,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: replacement,
      signInEndsAt: new Date(row.endsAt),
    };
  }

  return {
    async signIn({ userId, machine }) {
      const now = Date.now();
      const id = newCredentialId();
      const refreshToken = mintRefreshToken(secret, id, 0);
      const row: CliCredentialRow = {
        id,
        purpose: "cli-sign-in",
        userId,
        familyId: id,
        parentId: null,
        agentName: null,
        door: doorOf("cli-sign-in"),
        machine,
        refreshTokenHash: hashRefreshToken(refreshToken),
        refreshGeneration: 0,
        createdAt: now,
        lastUsedAt: now,
        endsAt: now + lifetimes.signInAbsoluteMs,
        idleEndsAt: Math.min(
          now + lifetimes.signInIdleMs,
          now + lifetimes.signInAbsoluteMs
        ),
        revokedAt: null,
        revokedReason: null,
      };
      await store.insert(row);
      const access = await accessTokenFor(row);
      return {
        credentialId: id,
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken,
        signInEndsAt: new Date(row.endsAt),
      };
    },

    async renew(refreshToken) {
      const parsed = parseRefreshToken(refreshToken);
      const row = parsed ? await findOne(parsed.credentialId) : null;
      if (!parsed || !row || row.purpose !== "cli-sign-in") {
        return refused("invalid");
      }
      if (row.refreshTokenHash !== hashRefreshToken(refreshToken)) {
        return refuseStaleToken(row, parsed);
      }
      const now = Date.now();
      const standing = signInRefusal(row, now);
      return standing ? refused(standing) : rotate(row, now);
    },

    async issueAgentPass({ signInId, agentName, machine }) {
      const signIn = await findOne(signInId);
      if (!signIn || signIn.purpose !== "cli-sign-in") {
        return refused("invalid");
      }
      const now = Date.now();
      const standing = signInRefusal(signIn, now);
      if (standing) return refused(standing);
      const id = newCredentialId();
      const row: CliCredentialRow = {
        id,
        purpose: "agent-pass",
        userId: signIn.userId,
        familyId: signIn.familyId,
        parentId: signIn.id,
        agentName,
        door: doorOf("agent-pass"),
        machine,
        refreshTokenHash: null,
        refreshGeneration: 0,
        createdAt: now,
        lastUsedAt: null,
        idleEndsAt: null,
        endsAt: Math.min(now + lifetimes.agentPassMs, signIn.endsAt),
        revokedAt: null,
        revokedReason: null,
      };
      await store.insert(row);
      const access = await accessTokenFor(row);
      return {
        ok: true,
        credentialId: id,
        accessToken: access.token,
        expiresAt: access.expiresAt,
      };
    },

    async verify(accessToken, door) {
      const claims = await readAccessToken(accessToken, door, secret);
      if ("ok" in claims) return claims;
      const row = await findOne(claims.cid);
      const refusal =
        rowRefusal(row, claims, door, Date.now()) ??
        (row ? await familyRefusal(row) : "invalid");
      if (refusal || !row) return refused(refusal ?? "invalid");
      return { ok: true, credential: verifiedOf(row) };
    },

    async revoke(credentialId, reason) {
      const row = await findOne(credentialId);
      if (!row) return false;
      const match =
        row.familyId === row.id ? { familyId: row.id } : { id: row.id };
      await store.revoke(match, Date.now(), reason);
      return true;
    },
  };
}
