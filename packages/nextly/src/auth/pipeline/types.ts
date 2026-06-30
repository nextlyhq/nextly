/**
 * Auth extensibility contracts (D71/D57).
 *
 * The plugin-facing surface for extending authentication: pluggable strategies
 * ("who is this user"), an auth-flow hook pipeline (modify / abort / challenge),
 * and a first-class multi-step challenge protocol. Re-exported `@experimental`
 * from `@nextlyhq/plugin-sdk` (see that package's STABILITY.md).
 *
 * @experimental
 */
import type { PluginContext } from "../../plugins/plugin-context";
import type { AuthUser } from "../../types/auth";

/**
 * @experimental What an auth strategy receives. `body` is the parsed JSON
 * request body; `strategyName` is the strategy currently being attempted.
 */
export interface AuthInput {
  request: Request;
  body: Record<string, unknown>;
  strategyName: string;
}

/**
 * @experimental A pending second factor / step. `id` is the challenge
 * definition id; `userId` is the candidate user this challenge gates (never
 * surfaced to the client raw — only via the signed pending-auth token).
 */
export interface Challenge {
  id: string;
  userId: string;
  /** Opaque hint the UI uses to pick/parameterize the challenge view. */
  uiHint?: Record<string, unknown>;
}

/**
 * @experimental The result of a strategy attempt:
 * - `authenticated` → core issues a session
 * - `challenge` → pause the flow pending a second step
 * - `fail` → deny (generic public message; no user enumeration)
 * - `pass` → "not my credential", try the next strategy
 */
export type AuthOutcome =
  | { type: "authenticated"; user: AuthUser }
  | { type: "challenge"; challenge: Challenge }
  | { type: "fail"; reason?: string }
  | { type: "pass" };

/** @experimental A pluggable authentication strategy (app opt-in). */
export interface AuthStrategy {
  name: string;
  authenticate(input: AuthInput, ctx: PluginContext): Promise<AuthOutcome>;
}

/** @experimental Resolves a challenge given the client's response (e.g. a TOTP code). */
export interface ChallengeDefinition {
  id: string;
  resolve(
    args: { userId: string; response: Record<string, unknown> },
    ctx: PluginContext
  ): Promise<{ ok: true } | { ok: false; reason?: string }>;
}

/** @experimental The names of the auth-flow hook phases. */
export type AuthHookName =
  | "beforeLogin"
  | "afterAuthenticate"
  | "afterLogin"
  | "beforeRegister"
  | "afterRegister"
  | "beforeLogout"
  | "afterLogout"
  | "determineUser"
  | "customizeClaims";

/**
 * @experimental Auth-flow hooks (normal contribution). Each hook may modify
 * (return a new value), abort (throw → generic public error), or — for
 * `afterAuthenticate` — return a `{ challenge }` to require a second step.
 */
export interface AuthHooks {
  /** Runs before any strategy. Throw to abort. */
  beforeLogin?: (input: AuthInput, ctx: PluginContext) => Promise<void> | void;
  /**
   * After a user is identified. Return a `{ challenge }` to require a second
   * step, the (possibly modified) user to continue, or throw to abort.
   */
  afterAuthenticate?: (
    user: AuthUser,
    ctx: PluginContext
  ) =>
    | Promise<AuthUser | { challenge: Challenge }>
    | AuthUser
    | { challenge: Challenge };
  /** Observe-only side effects after the session is issued. */
  afterLogin?: (user: AuthUser, ctx: PluginContext) => Promise<void> | void;
  /** Modify registration data before the user is created. */
  beforeRegister?: (
    data: Record<string, unknown>,
    ctx: PluginContext
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Observe-only side effects after a user registers. */
  afterRegister?: (user: AuthUser, ctx: PluginContext) => Promise<void> | void;
  /** Runs before logout. */
  beforeLogout?: (
    user: AuthUser | null,
    ctx: PluginContext
  ) => Promise<void> | void;
  /** Runs after logout. */
  afterLogout?: (ctx: PluginContext) => Promise<void> | void;
  /**
   * Custom current-user resolution for session/refresh. Return `null` to fall
   * through to core cookie/JWT resolution.
   */
  determineUser?: (
    request: Request,
    ctx: PluginContext
  ) => Promise<AuthUser | null> | AuthUser | null;
  /** Add/rename JWT claims. Receives the core claims, returns the final claims. */
  customizeClaims?: (
    claims: Record<string, unknown>,
    user: AuthUser,
    ctx: PluginContext
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
}
