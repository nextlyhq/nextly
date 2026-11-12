/**
 * How many times code waits on the database one after another: every round trip the driver
 * makes (each statement, and each new connection it opens) is held for a fixed time, as a
 * database that far away would hold it, and recorded with when it began and ended. The waits
 * one after another are then the longest chain of round trips in which each began after the one
 * before it ended. Round trips sent together overlap, so a chain counts them once; SQLite's
 * driver blocks, so there every statement is a wait of its own.
 *
 * Counted from the round trips themselves rather than from the wall time, so time the code
 * spends computing, which varies from machine to machine, never reads as a wait.
 *
 * @module __tests__/helpers/sequential-waits
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { TestDialect } from "../../plugins/test-nextly";

import { driverEntryPoints, ownerOf } from "./record-statements";

/** One round trip: a statement, or a connection the driver opened. */
export interface RoundTrip {
  kind: "statement" | "connection";
  /** The statement's text, or `connect`. */
  text: string;
  startedAt: number;
  /** When its answer came; undefined while it is still on its way. */
  endedAt?: number;
  /** What `context` answered when it was sent. */
  context?: unknown;
}

export interface RoundTripRecorder {
  readonly trips: RoundTrip[];
  uninstall(): void;
}

/** Sleep the thread, for a synchronous driver call. */
function blockFor(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Hold every round trip the driver under `adapter` makes for `delayMs`, and record it, from now
 * until `uninstall`, whichever connection of that driver makes it.
 */
export async function recordRoundTrips(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  options: { delayMs: number; context?: () => unknown }
): Promise<RoundTripRecorder> {
  const trips: RoundTrip[] = [];
  const restores: Array<() => void> = [];
  const begin = (kind: RoundTrip["kind"], text: string): RoundTrip => {
    const trip: RoundTrip = {
      kind,
      text,
      startedAt: performance.now(),
      ...(options.context ? { context: options.context() } : {}),
    };
    trips.push(trip);
    return trip;
  };
  const end = (trip: RoundTrip) => {
    trip.endedAt = performance.now();
  };
  const replace = (
    owner: Record<string, unknown>,
    method: string,
    wrap: (
      original: (...args: unknown[]) => unknown
    ) => (...args: unknown[]) => unknown
  ) => {
    const original = owner[method] as (...args: unknown[]) => unknown;
    owner[method] = wrap(original);
    restores.push(() => {
      owner[method] = original;
    });
  };
  /** An asynchronous call held for the delay before it is sent. */
  const heldAsync =
    (
      kind: RoundTrip["kind"],
      textOf: (args: unknown[]) => string | undefined
    ) =>
    (original: (...args: unknown[]) => unknown) =>
      function (this: unknown, ...args: unknown[]): unknown {
        const text = textOf(args);
        if (text === undefined) return original.apply(this, args);
        const trip = begin(kind, text);
        const last = args[args.length - 1];
        if (typeof last === "function") {
          args[args.length - 1] = (...result: unknown[]) => {
            end(trip);
            return (last as (...a: unknown[]) => unknown)(...result);
          };
          setTimeout(() => original.apply(this, args), options.delayMs);
          return undefined;
        }
        const first = args[0] as { once?: unknown } | undefined;
        if (
          first &&
          typeof first === "object" &&
          typeof first.once === "function"
        ) {
          // mysql2's pool hands the connection a ready query command and reads the
          // return value at once: the command now, sent after the delay.
          (first as { once(event: string, f: () => void): void }).once(
            "end",
            () => end(trip)
          );
          setTimeout(() => original.apply(this, args), options.delayMs);
          return first;
        }
        return new Promise(resolve => setTimeout(resolve, options.delayMs))
          .then(() => original.apply(this, args))
          .then(
            value => {
              end(trip);
              return value;
            },
            (error: unknown) => {
              end(trip);
              throw error;
            }
          );
      };
  const textOfStatement = (args: unknown[]): string | undefined => {
    const [first] = args;
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      const shaped = first as { text?: unknown; sql?: unknown };
      if (typeof shaped.text === "string") return shaped.text;
      if (typeof shaped.sql === "string") return shaped.sql;
    }
    return undefined;
  };

  for (const { instance, methods, sqlite } of await driverEntryPoints(
    adapter,
    dialect
  )) {
    for (const method of methods) {
      const owner = ownerOf(instance, method);
      if (dialect === "sqlite") {
        replace(
          owner,
          method,
          original =>
            function (this: unknown, ...args: unknown[]): unknown {
              const text = sqlite
                ? (this as { source?: string }).source
                : textOfStatement(args);
              if (text === undefined) return original.apply(this, args);
              const trip = begin("statement", text);
              blockFor(options.delayMs);
              try {
                return original.apply(this, args);
              } finally {
                end(trip);
              }
            }
        );
      } else {
        replace(owner, method, heldAsync("statement", textOfStatement));
      }
    }
    // A new connection is a round trip too (more than one, on a real network).
    if (dialect === "postgresql" && !sqlite) {
      replace(
        ownerOf(instance, "connect"),
        "connect",
        heldAsync("connection", () => "connect")
      );
    }
  }
  if (dialect === "mysql") {
    type CorePool = {
      _freeConnections?: { length: number };
      _allConnections?: { length: number };
      config?: { connectionLimit?: number };
    };
    const client = (adapter.getDrizzle() as { $client: unknown }).$client as {
      pool?: object;
    };
    const pool = (client.pool ?? client) as object;
    replace(ownerOf(pool, "getConnection"), "getConnection", original => {
      const held = heldAsync("connection", () => "connect")(original);
      return function (this: CorePool, ...args: unknown[]): unknown {
        const opensOne =
          (this._freeConnections?.length ?? 0) === 0 &&
          (this._allConnections?.length ?? 0) <
            (this.config?.connectionLimit ?? 10);
        return (opensOne ? held : original).apply(this, args);
      };
    });
  }
  return {
    trips,
    uninstall: () => restores.reverse().forEach(restore => restore()),
  };
}

/**
 * The longest chain of `trips` in which each began after the one before it ended: how many times
 * the code waited on the database one after another.
 */
export function sequentialWaits(trips: readonly RoundTrip[]): number {
  const finished = trips
    .filter(
      (trip): trip is RoundTrip & { endedAt: number } =>
        trip.endedAt !== undefined
    )
    .sort((a, b) => a.endedAt - b.endedAt);
  const depth = new Map<RoundTrip, number>();
  let longest = 0;
  for (const trip of finished) {
    let before = 0;
    for (const earlier of finished) {
      if (earlier.endedAt > trip.startedAt) break;
      before = Math.max(before, depth.get(earlier) ?? 0);
    }
    depth.set(trip, before + 1);
    longest = Math.max(longest, before + 1);
  }
  return longest;
}
