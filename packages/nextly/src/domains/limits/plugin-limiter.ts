/**
 * The limiter a plugin reaches as `ctx.limits`: it reserves an attempt on
 * keys the plugin chooses, before the work it guards runs.
 *
 * A reservation names 1 to 16 entries, each a rule the plugin declared and a
 * key, and is decided and counted in ONE update of the selected limit store,
 * atomically over every entry. So concurrent reservations, on any number of
 * instances sharing the store, are admitted no more than the rules allow.
 * Each entry says whether its lack of room refuses the reservation
 * (`enforce`) and when it is counted (`count`), and comes back with its own
 * verdict.
 *
 * Keys are the plugin's own: each is stored as the plugin's name, the rule's
 * name and an HMAC of the key, keyed by a value derived from the install's
 * secret for this use alone. The store never holds a key as given, and no
 * plugin can name another's.
 *
 * @experimental
 * @module domains/limits/plugin-limiter
 */
import { createHmac, randomBytes } from "node:crypto";

import { genericPublicMessage } from "../../errors/error-codes";
import { NextlyError } from "../../errors/nextly-error";
import { getNextlyLogger } from "../../observability/logger";
import {
  assertNoOpenTransaction,
  type OpenTransactionProbe,
} from "../../shared/lib/open-transaction";

import {
  countAttempt,
  hasRoom,
  holdsNothing,
  readRuleState,
  releaseAttempt,
  retryAfterMs,
  stateExpiresAt,
  type LimitRule,
  type RuleState,
} from "./limit-rules";
import {
  limitStoreUnavailableReason,
  type LimitStore,
  type StoredLimit,
} from "./limit-store";

/** A rule and a key under it. @experimental */
export interface LimitTarget {
  /** A rule this plugin declared in `contributes.limits`. */
  rule: string;
  /** Any non-empty string the caller chooses, at most 512 characters. */
  key: string;
}

/** One entry of a reservation. @experimental */
export interface LimitEntry extends LimitTarget {
  /**
   * Default true: when this entry's rule has no room, the reservation is
   * refused. False: its lack of room refuses nothing. It never decides this
   * entry's own count.
   */
  enforce?: boolean;
  /**
   * When this entry is counted:
   * - `"admitted"` (default): when the reservation is admitted and this
   *   entry's rule has room;
   * - `"unanimous"`: only when every entry's rule in the reservation has room,
   *   enforced or not;
   * - `"always"`: whatever happens.
   *
   * An entry whose rule has no room is never counted unless `"always"`, and a
   * count without room never moves a wait in force.
   */
  count?: "admitted" | "unanimous" | "always";
}

/** What one entry's rule said, and whether the entry was counted. @experimental */
export interface EntryVerdict extends LimitTarget {
  readonly hadRoom: boolean;
  readonly counted: boolean;
}

/** An admitted reservation, to give back with `release`. @experimental */
export interface AdmittedReservation {
  readonly id: string;
  /** When it was counted, on the store's clock: what `release` gives back by. */
  readonly at: number;
  /** Per entry, in the order given: an `enforce: false` entry may have had no room. */
  readonly entries: readonly EntryVerdict[];
}

/**
 * What a reservation came to. `unavailable`: the store did not answer, so the
 * attempt is not admitted; it may have been counted if the failure followed a
 * commit. @experimental
 */
export type LimitReservation =
  | { status: "admitted"; reservation: AdmittedReservation }
  | {
      status: "refused";
      /** Milliseconds after which the reservation would be admitted. */
      retryAfterMs: number;
      /** The rules whose lack of room refused it. */
      refusedBy: readonly string[];
      entries: readonly EntryVerdict[];
    }
  | { status: "unavailable" };

/** What a release or reset came to. @experimental */
export type LimitOutcome = { status: "done" } | { status: "unavailable" };

/** What reading entries without counting came to. @experimental */
export type LimitCheck =
  | {
      status: "ok";
      entries: ReadonlyArray<
        LimitTarget & { wouldAdmit: boolean; retryAfterMs: number }
      >;
    }
  | { status: "unavailable" };

/** A plugin's limiter, `ctx.limits`. @experimental */
export interface PluginLimiter {
  /**
   * Decides and counts atomically over every entry (1 to 16). Call it BEFORE
   * the work it guards, and outside any transaction: it throws when the
   * calling flow has one open, since a count must never roll back with it.
   */
  reserve(entries: readonly LimitEntry[]): Promise<LimitReservation>;
  /**
   * Gives back an admitted reservation's count, on all its entries or those
   * of the rules named, at most once per entry: a repeated release gives back
   * nothing more. A backoff count given back also lifts the wait it set,
   * while that wait is still the one in force. Throws inside a transaction.
   */
  release(
    reservation: AdmittedReservation,
    options?: { rules?: readonly string[] }
  ): Promise<LimitOutcome>;
  /** Forgets a key's count under a rule. Throws inside a transaction. */
  reset(target: LimitTarget): Promise<LimitOutcome>;
  /**
   * Reads entries without counting. Advisory: a wait is judged on this
   * instance's clock, and only `reserve` decides.
   */
  check(targets: readonly LimitTarget[]): Promise<LimitCheck>;
  /**
   * The request's client, to count by: the IPv4 address, an IPv6 address's
   * /64, the IPv4 address inside an IPv4-mapped one, or null when the address
   * cannot be resolved (with `security.trustProxy` unset, always).
   */
  clientKey(request: Request): string | null;
  /** Whether the store is shared by every instance, and whether the site declared one instance. */
  readonly store: {
    readonly shared: boolean;
    readonly singleInstance: boolean;
  };
}

/** The most entries one reservation names. */
export const LIMIT_RESERVATION_MAX_ENTRIES = 16;

/** The longest key a plugin may reserve on, in characters. */
export const LIMIT_KEY_MAX_LENGTH = 512;

/** What a plugin's limiter is built from. */
export interface PluginLimiterDeps {
  /** The plugin's name, namespacing every key. */
  plugin: string;
  /** The rules the plugin declared, by name. */
  rules: ReadonlyMap<string, LimitRule>;
  /** The selected limit store. */
  store: LimitStore;
  /** The install's current secret; keys are hashed under a value derived from it. */
  secret: string | undefined;
  /** Whether the site says it runs one instance. */
  singleInstance: boolean;
  /** Tells whether the calling flow has a transaction open. */
  transactions: OpenTransactionProbe;
  /** The request's client address, as the site's proxy settings resolve it. */
  clientAddress: (request: Request) => string | null;
  /** The client an address counts as: IPv4, an IPv6 /64, or a mapped address's IPv4. */
  clientOf: (address: string) => string;
}

/** A call the plugin got wrong: a programming error, refused before anything is counted. */
function misuse(
  plugin: string,
  logMessage: string,
  logContext: Record<string, unknown> = {}
): NextlyError {
  return new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: genericPublicMessage("INTERNAL_ERROR"),
    logMessage: `Plugin "${plugin}": ${logMessage}`,
    logContext: { plugin, ...logContext },
  });
}

/** The separator between the parts of a store key, which no plugin or rule name holds. */
const PART = "\u001f";

/** Build the limiter for one plugin. */
export function createPluginLimiter(deps: PluginLimiterDeps): PluginLimiter {
  const { plugin, rules, store } = deps;
  // Derived for this use alone, so a key's hash here matches no other value
  // derived from the install's secret.
  const keyHashKey = createHmac("sha256", deps.secret ?? "")
    .update("nextly plugin limit keys")
    .digest();

  /** The rule `name` names, refusing one the plugin never declared. */
  const ruleNamed = (name: string): LimitRule => {
    const rule = rules.get(name);
    if (rule === undefined) {
      throw misuse(plugin, `no limit rule "${name}" is declared.`, {
        rule: name,
      });
    }
    return rule;
  };

  /** Check a target the plugin named, refusing a bad key. */
  const checkTarget = (target: LimitTarget): LimitRule => {
    const rule = ruleNamed(target.rule);
    if (
      typeof target.key !== "string" ||
      target.key.length === 0 ||
      target.key.length > LIMIT_KEY_MAX_LENGTH
    ) {
      throw misuse(
        plugin,
        `a limit key must be a non-empty string of at most ${LIMIT_KEY_MAX_LENGTH} characters.`,
        { rule: target.rule }
      );
    }
    return rule;
  };

  /** The key a target is stored under: plugin, rule and the key's keyed hash. */
  const storeKey = (target: LimitTarget): string =>
    [
      plugin,
      target.rule,
      createHmac("sha256", keyHashKey)
        .update(target.key, "utf8")
        .digest("base64url"),
    ].join(PART);

  /** Check a list of targets: 1 to 16, none twice. */
  const checkTargets = <T extends LimitTarget>(targets: readonly T[]) => {
    if (
      targets.length === 0 ||
      targets.length > LIMIT_RESERVATION_MAX_ENTRIES
    ) {
      throw misuse(
        plugin,
        `a limit call names 1 to ${LIMIT_RESERVATION_MAX_ENTRIES} entries.`,
        { entries: targets.length }
      );
    }
    const checked = targets.map(target => ({
      target,
      rule: checkTarget(target),
      key: storeKey(target),
    }));
    if (new Set(checked.map(entry => entry.key)).size !== checked.length) {
      throw misuse(plugin, "a limit call names one rule and key twice.");
    }
    return checked;
  };

  /** The store's answer as an outcome, logging when it could not answer. */
  const unavailable = (
    operation: string,
    error: unknown
  ): { status: "unavailable" } => {
    const reason = limitStoreUnavailableReason(error);
    if (reason === undefined) throw error;
    getNextlyLogger().warn({
      kind: "plugin-limit-unavailable",
      message: `A plugin limit ${operation} was answered as unavailable: the limit store ${reason === "full" ? "is full" : reason === "timeout" ? "did not answer in time" : "could not be reached"}.`,
      plugin,
      operation,
      reason,
    });
    return { status: "unavailable" };
  };

  /**
   * The entry to write for `state` under `rule`, or null once it holds
   * nothing: removed, rather than kept to its expiry holding room in the store.
   */
  const stored = (
    rule: LimitRule,
    state: RuleState,
    now: number
  ): StoredLimit | null => {
    const expiresAt = stateExpiresAt(rule, state);
    return expiresAt > now && !holdsNothing(state, now)
      ? { value: state, expiresAt }
      : null;
  };

  /**
   * The rules of each reservation this limiter has given back, so releasing
   * the same object again goes no further. The entries remember recent
   * releases too, for a retry after an answer that was lost.
   */
  const givenBack = new WeakMap<AdmittedReservation, Set<string>>();

  return {
    async reserve(entries) {
      const checked = checkTargets(entries);
      assertNoOpenTransaction(deps.transactions, "A plugin limit reservation");
      const id = randomBytes(9).toString("base64url");
      try {
        return await store.update<LimitReservation>(
          checked.map(entry => entry.key),
          (current, now) => {
            const states = checked.map(entry =>
              readRuleState(entry.rule, current.get(entry.key)?.value, now)
            );
            const room = checked.map((entry, index) =>
              hasRoom(entry.rule, states[index], now)
            );
            const refusing = checked
              .map((entry, index) => ({ entry, index }))
              .filter(
                ({ entry, index }) =>
                  entry.target.enforce !== false && !room[index]
              );
            const admitted = refusing.length === 0;
            const unanimous = room.every(Boolean);

            const write = new Map<string, StoredLimit | null>();
            // What each entry holds once this reservation is counted: a
            // refusal's wait is worked out from it, since a count the
            // refusal itself made can push room further off.
            const after = [...states];
            const verdicts = checked.map((entry, index): EntryVerdict => {
              const mode = entry.target.count ?? "admitted";
              const hadRoom = room[index] === true;
              const counted =
                mode === "always" ||
                (mode === "admitted" && admitted && hadRoom) ||
                (mode === "unanimous" && unanimous);
              if (counted) {
                const next = countAttempt(
                  entry.rule,
                  states[index],
                  now,
                  hadRoom,
                  id
                );
                after[index] = next;
                write.set(entry.key, stored(entry.rule, next, now));
              }
              return {
                rule: entry.target.rule,
                key: entry.target.key,
                hadRoom,
                counted,
              };
            });

            if (admitted) {
              return {
                write,
                result: {
                  status: "admitted",
                  reservation: { id, at: now, entries: verdicts },
                },
              };
            }
            return {
              write,
              result: {
                status: "refused",
                retryAfterMs: Math.max(
                  ...refusing.map(({ entry, index }) =>
                    retryAfterMs(entry.rule, after[index], now)
                  )
                ),
                refusedBy: [
                  ...new Set(refusing.map(({ entry }) => entry.target.rule)),
                ],
                entries: verdicts,
              },
            };
          }
        );
      } catch (error) {
        return unavailable("reservation", error);
      }
    },

    async release(reservation, options) {
      const named = options?.rules;
      const done = givenBack.get(reservation);
      const targets = reservation.entries.filter(
        entry =>
          entry.counted &&
          (named === undefined || named.includes(entry.rule)) &&
          !done?.has(entry.rule)
      );
      if (targets.length === 0) return { status: "done" };
      const checked = checkTargets(targets);
      if (!Number.isFinite(reservation.at)) {
        throw misuse(
          plugin,
          "a released reservation must be one `reserve` admitted."
        );
      }
      assertNoOpenTransaction(deps.transactions, "A plugin limit release");
      try {
        const outcome = await store.update(
          checked.map(entry => entry.key),
          (current, now) => {
            const write = new Map<string, StoredLimit | null>();
            for (const entry of checked) {
              const state = readRuleState(
                entry.rule,
                current.get(entry.key)?.value,
                now
              );
              // Held here no longer: given back already, or never counted.
              const released = releaseAttempt(
                entry.rule,
                state,
                reservation.id,
                reservation.at
              );
              if (released)
                write.set(entry.key, stored(entry.rule, released, now));
            }
            return { write, result: { status: "done" } as const };
          }
        );
        givenBack.set(
          reservation,
          new Set([...(done ?? []), ...targets.map(entry => entry.rule)])
        );
        return outcome;
      } catch (error) {
        return unavailable("release", error);
      }
    },

    async reset(target) {
      const [entry] = checkTargets([target]);
      assertNoOpenTransaction(deps.transactions, "A plugin limit reset");
      if (entry === undefined) return { status: "done" };
      try {
        return await store.update([entry.key], () => ({
          write: new Map([[entry.key, null]]),
          result: { status: "done" } as const,
        }));
      } catch (error) {
        return unavailable("reset", error);
      }
    },

    async check(targets) {
      const checked = checkTargets(targets);
      try {
        const found = await store.read(checked.map(entry => entry.key));
        // The store has already left out what expired on its own clock; the
        // wait still in force is judged on this instance's clock. A check
        // only advises, so it stays a read, made inside a transaction or out.
        const now = Date.now();
        return {
          status: "ok",
          entries: checked.map(entry => {
            const state = readRuleState(
              entry.rule,
              found.get(entry.key)?.value,
              now
            );
            return {
              rule: entry.target.rule,
              key: entry.target.key,
              wouldAdmit: hasRoom(entry.rule, state, now),
              retryAfterMs: retryAfterMs(entry.rule, state, now),
            };
          }),
        };
      } catch (error) {
        return unavailable("check", error);
      }
    },

    clientKey(request) {
      const address = deps.clientAddress(request);
      return address === null || address === "" ? null : deps.clientOf(address);
    },

    store: { shared: store.shared, singleInstance: deps.singleInstance },
  };
}
