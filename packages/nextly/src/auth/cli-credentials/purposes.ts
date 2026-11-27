/**
 * What each credential the command line and agents hold is for, the door it
 * opens, and how long it lasts.
 *
 * A credential has exactly one purpose and each purpose exactly one door:
 * a CLI sign-in and an agent pass open the command door, a chat-app pass
 * opens the chat-app door. One table maps both ways, so the door a credential
 * is issued for and the purposes a door accepts cannot disagree.
 *
 * @module auth/cli-credentials/purposes
 */
import { TOKEN_TYP, type TokenPurpose } from "../jwt/sign";

/** What a stored credential is, as its row spells it. */
export type CliCredentialPurpose =
  | "cli-sign-in"
  | "agent-pass"
  | "chat-app-pass";

/** Where a credential may be used. */
export type CliCredentialDoor = "command" | "chat-app";

/**
 * For each purpose, the door it opens and the access token's `typ` purpose.
 * The access token's header names the purpose, so a token minted for one
 * purpose fails verification as any other (`auth/jwt/verify`).
 */
const PURPOSES = {
  "cli-sign-in": { door: "command", token: "cliSignIn" },
  "agent-pass": { door: "command", token: "agentPass" },
  "chat-app-pass": { door: "chat-app", token: "chatAppPass" },
} as const satisfies Record<
  CliCredentialPurpose,
  { door: CliCredentialDoor; token: TokenPurpose }
>;

/** The door a credential of this purpose opens. */
export function doorOf(purpose: CliCredentialPurpose): CliCredentialDoor {
  return PURPOSES[purpose].door;
}

/** The access token purpose a credential of this purpose is signed with. */
export function tokenPurposeOf(purpose: CliCredentialPurpose): TokenPurpose {
  return PURPOSES[purpose].token;
}

/** Whether a stored string is one of the purposes, read from a row. */
export function isCliCredentialPurpose(
  value: unknown
): value is CliCredentialPurpose {
  return typeof value === "string" && Object.hasOwn(PURPOSES, value);
}

/**
 * The purpose whose access tokens carry this header `typ`, or null when it
 * is none of them (an admin session's, a pending sign-in's, or unknown).
 */
export function purposeOfTokenTyp(typ: unknown): CliCredentialPurpose | null {
  return (
    (Object.keys(PURPOSES) as CliCredentialPurpose[]).find(
      purpose => TOKEN_TYP[PURPOSES[purpose].token] === typ
    ) ?? null
  );
}

/**
 * The purposes a door accepts, derived from the one table above rather than
 * listed again: the command door takes CLI sign-ins and agent passes, the
 * chat-app door takes chat-app passes only.
 */
export function purposesFor(
  door: CliCredentialDoor
): readonly CliCredentialPurpose[] {
  return (Object.keys(PURPOSES) as CliCredentialPurpose[]).filter(
    purpose => PURPOSES[purpose].door === door
  );
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * How long each credential lasts.
 *
 * - A CLI sign-in's access token lasts 15 minutes; its refresh token is
 *   replaced on every use, ends 30 days after it was last used, and the
 *   sign-in ends 90 days after it was made whatever its use.
 * - An agent pass lasts 4 hours, and never past the sign-in it came from.
 */
export const CLI_CREDENTIAL_LIFETIMES = {
  accessTokenSeconds: 15 * 60,
  signInIdleMs: 30 * DAY_MS,
  signInAbsoluteMs: 90 * DAY_MS,
  agentPassMs: 4 * HOUR_MS,
} as const;
