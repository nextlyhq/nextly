import type {
  OneTimeSecrets,
  OpaqueSecrets,
  PasswordHelper,
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

/**
 * Core's one-purpose secrets (`ctx.security.secrets`) and opaque secrets
 * (`ctx.security.opaque`), as the plugin SDK publishes them.
 */
export type {
  OneTimeSecrets,
  OpaqueSecrets,
  SecretData,
  TxOption,
} from "@nextlyhq/plugin-sdk";

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
