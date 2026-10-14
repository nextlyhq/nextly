import type { PasswordHelper, PluginTransaction } from "@nextlyhq/plugin-sdk";

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

/** A rule the plugin declares for the limiter, by name. */
export type LimitRule =
  | {
      type: "window";
      /**
       * 1 to 4 rolling windows (`max` 1 to 10,000, `perMs` 1 s to 30 days);
       * an attempt is admitted only if every window has room.
       */
      windows: ReadonlyArray<{ max: number; perMs: number }>;
    }
  | {
      type: "backoff";
      /** 0 to 1,000 attempts in a row admitted with no wait. */
      free: number;
      /**
       * Then each attempt waits `waitsMs[count − free]` (each 1 ms to 24 h;
       * the last repeats). A wait in force is never moved. Empty: no room
       * until reset or forgotten.
       */
      waitsMs: readonly number[];
      /**
       * 1 minute to 30 days: the count is forgotten once this long passes
       * with nothing counted, and never while a wait is in force.
       */
      forgetAfterMs: number;
    };

export interface LimitTarget {
  /** A rule this plugin declared. */
  rule: string;
  /** Any non-empty string the plugin chooses, at most 512 characters; a longer one throws. */
  key: string;
}

export interface LimitEntry extends LimitTarget {
  /**
   * Default true: when this entry's rule has no room, the reservation is
   * refused. False: its lack of room refuses nothing. Never decides this
   * entry's own count.
   */
  enforce?: boolean;
  /**
   * When this entry is counted:
   * - "admitted" (default): when the reservation is admitted and this rule
   *   has room;
   * - "unanimous": only when every entry's rule has room, enforced or not;
   * - "always": whatever happens.
   * Without room, an entry is counted only when "always", and then never
   * moves the wait in force.
   */
  count?: "admitted" | "unanimous" | "always";
}

export interface EntryVerdict extends LimitTarget {
  readonly hadRoom: boolean;
  readonly counted: boolean;
}

export interface AdmittedReservation {
  readonly id: string;
  /** Per entry, in the order given: an `enforce: false` entry may have had no room. */
  readonly entries: readonly EntryVerdict[];
}

export type LimitReservation =
  | { status: "admitted"; reservation: AdmittedReservation }
  | {
      status: "refused";
      retryAfterMs: number;
      /** The names of the rules that refused it. */
      refusedBy: readonly string[];
      entries: readonly EntryVerdict[];
    }
  /** The store did not answer: nothing was counted. */
  | { status: "unavailable" };

export type LimitOutcome = { status: "done" } | { status: "unavailable" };

export type LimitCheck =
  | {
      status: "ok";
      entries: ReadonlyArray<
        LimitTarget & { wouldAdmit: boolean; retryAfterMs: number }
      >;
    }
  | { status: "unavailable" };

/**
 * Core's limiter. `reserve`, `release` and `reset` run outside any
 * transaction and throw while the calling flow has one open, since a count
 * must never roll back with the work it guards.
 */
export interface PluginLimiter {
  /**
   * Decides and counts 1 to 16 entries atomically, on a store every instance
   * shares, before the work it guards runs.
   */
  reserve(entries: readonly LimitEntry[]): Promise<LimitReservation>;
  /**
   * Gives back an admitted reservation's count, on all its entries or the
   * rules named, at most once per entry.
   */
  release(
    reservation: AdmittedReservation,
    options?: { rules?: readonly string[] }
  ): Promise<LimitOutcome>;
  /** Forgets a key's count (a backoff rule's success). */
  reset(target: LimitTarget): Promise<LimitOutcome>;
  /** Reads without counting. */
  check(targets: readonly LimitTarget[]): Promise<LimitCheck>;
  /** An IPv4 address; an IPv6 /64; the IPv4 inside an IPv4-mapped address; null when unresolved. */
  clientKey(request: Request): string | null;
  /** Whether every instance shares the store, and whether the site declared it runs one instance. */
  readonly store: {
    readonly shared: boolean;
    readonly singleInstance: boolean;
  };
}

/** Everything the plugin borrows from core's helpers. */
export interface AccountsCore {
  readonly passwords: PasswordHelper;
  readonly secrets: OneTimeSecrets;
  readonly opaque: OpaqueSecrets;
  readonly limits: PluginLimiter;
}
