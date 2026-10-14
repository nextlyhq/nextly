import type {
  PasswordHelper,
  PluginLimiter,
  PluginTransaction,
} from "@nextlyhq/plugin-sdk";

/**
 * What the accounts plugin borrows from core: the password, one-purpose
 * secret, opaque secret and limiter helpers core lends every plugin, in the
 * shapes the platform's sign-in design states for them. Every flow is written
 * against these shapes and nothing else, and `./adapter` is the one module
 * that finds them on the plugin context, so a move of where core hangs them
 * changes that module alone. A type the plugin SDK publishes is re-exported
 * from it; the rest are declared here until core publishes them.
 */

/**
 * Core's password hashing and rules, as the plugin SDK publishes them
 * (`ctx.security.passwords`).
 */
export type {
  PasswordCheck,
  PasswordHelper,
  PasswordRules,
} from "@nextlyhq/plugin-sdk";

/** Kept beside a one-purpose secret, in clear, at most 1 KB serialised. */
export type SecretData = Record<string, string | number | boolean | null>;

export interface TxOption {
  /**
   * The plugin's own open transaction, the `tx` that `ctx.db.transaction`
   * hands its callback: the write commits or rolls back with it. Without
   * one, the write runs in a transaction of its own, and is refused while
   * the calling flow has a transaction open.
   */
  tx?: PluginTransaction;
}

/** Core's one-purpose secrets: a long token for a link, a short code to type. */
export interface OneTimeSecrets {
  mintToken(
    input: {
      /** `[a-z][a-z0-9.-]{0,63}`; core prefixes the plugin's name. */
      purpose: string;
      /** The plugin's choice, such as an account id; at most 255 characters. */
      subject: string;
      /** 1 minute to 30 days. */
      expiresInMs: number;
      data?: SecretData;
      /** Voids this plugin's unspent tokens of this purpose and subject. */
      voidEarlier?: boolean;
    },
    options?: TxOption
  ): Promise<{ token: string; expiresAt: Date }>;

  /** A new code always voids the earlier unspent code of its purpose and subject. */
  mintCode(
    input: {
      purpose: string;
      subject: string;
      /** 1 to 60 minutes. */
      expiresInMs: number;
      /** Default 6. */
      digits?: 6 | 7 | 8;
      /** 1 to 10: the code's own backstop. */
      maxWrongTries: number;
      data?: SecretData;
    },
    options?: TxOption
  ): Promise<{ code: string; expiresAt: Date }>;

  /** Reads without spending, for a page that shows what a link will do. */
  peekToken(input: {
    purpose: string;
    token: string;
  }): Promise<
    | { ok: true; subject: string; data: SecretData | null; expiresAt: Date }
    | { ok: false; reason: "invalid" | "expired" | "spent" }
  >;

  /** Spends it once, by one write only one caller can win, on every instance. */
  consumeToken(
    input: { purpose: string; token: string },
    options?: TxOption
  ): Promise<
    | { ok: true; subject: string; data: SecretData | null }
    | { ok: false; reason: "invalid" | "expired" | "spent" }
  >;

  /**
   * Takes no transaction: a wrong code's charge and a right code's spend
   * commit on their own, so no rollback gives a wrong try back. Throws while
   * the calling flow has a transaction open. A flow spends the code first and
   * then opens the transaction that applies it; if that fails, the code stays
   * spent and the visitor asks for another.
   */
  consumeCode(input: {
    purpose: string;
    subject: string;
    code: string;
  }): Promise<
    | { ok: true; data: SecretData | null }
    /** At 0 tries left, the code is void. */
    | { ok: false; reason: "wrong"; triesLeft: number }
    | { ok: false; reason: "none" | "expired" | "spent" }
  >;

  /** Voids a subject's unspent secrets, of every purpose or the ones named. */
  voidFor(
    input: { subject: string; purposes?: readonly string[] },
    options?: TxOption
  ): Promise<{ voided: number }>;
}

/** Core's opaque secrets, for the plugin's own records such as session tokens. */
export interface OpaqueSecrets {
  /** At least 32 random bytes, base64url; `hash` is its SHA-256 in hex. */
  create(options?: { bytes?: number }): { secret: string; hash: string };
  /** The hash `create` gave, the same across restarts and secret rotation. */
  hash(secret: string): string;
  /**
   * Takes a time that depends only on the two lengths; strings of different
   * lengths are unequal.
   */
  equal(a: string, b: string): boolean;
}

/**
 * Core's limiter and the rules a plugin declares for it, as the plugin SDK
 * publishes them (`ctx.limits`, `contributes.limits`).
 */
export type {
  AdmittedReservation,
  EntryVerdict,
  LimitCheck,
  LimitEntry,
  LimitOutcome,
  LimitReservation,
  LimitRule,
  LimitTarget,
  PluginLimiter,
} from "@nextlyhq/plugin-sdk";

/** Everything the plugin borrows from core's helpers. */
export interface AccountsCore {
  readonly passwords: PasswordHelper;
  readonly secrets: OneTimeSecrets;
  readonly opaque: OpaqueSecrets;
  readonly limits: PluginLimiter;
}
