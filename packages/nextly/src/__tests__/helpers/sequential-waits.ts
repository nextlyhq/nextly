/**
 * How many times code waits on the database one after another: every round trip the driver
 * makes (each statement, and each new connection it opens) is answered a fixed time after it was
 * sent, as a database that far away would answer it, and recorded with when it began and ended.
 * The waits one after another are then the longest chain of round trips in which each began after
 * the one before it ended. Round trips sent together overlap, so a chain counts them once;
 * SQLite's driver blocks, so there every statement is a wait of its own.
 *
 * Counted from the round trips themselves rather than from the wall time, so time the code
 * spends computing, which varies from machine to machine, never reads as a wait. Nor does the
 * time the database under the test takes: an answer it gives sooner than the fixed time is held
 * until then, so two round trips sent together come back in the order they were sent, however
 * the database's own speed varies between them.
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
 * Answer every round trip the driver under `adapter` makes `delayMs` after it was sent, and record
 * it, from now until `uninstall`, whichever connection of that driver makes it. A new connection is
 * answered after `connectionDelayMs` where given: a pool hands a waiting statement whichever client
 * is free first, a released one or a newly connected one, and where both are held alike they come
 * free at the same moment and the machine's timing decides which, and with it the chain.
 *
 * The round trip is sent at once and its answer held until it is due, rather than held before it
 * is sent: held before, its answer came at the delay plus the time the database took, so of two
 * round trips sent together the one the database happened to answer a millisecond sooner came
 * back first, and with it which statement found a client free and which waited for a new
 * connection. Each answer's timer is set as its round trip is sent, so answers due together come
 * back in the order they were sent. A database slower than the delay still answers when it does.
 */
export async function recordRoundTrips(
  adapter: DrizzleAdapter,
  dialect: TestDialect,
  options: {
    delayMs: number;
    connectionDelayMs?: number;
    context?: () => unknown;
  }
): Promise<RoundTripRecorder> {
  const holdOf = (kind: RoundTrip["kind"]): number =>
    kind === "connection"
      ? (options.connectionDelayMs ?? options.delayMs)
      : options.delayMs;
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
  /** An asynchronous call sent at once, its answer held until the delay after it was sent. */
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
        // Set now, so answers due at the same moment come back in the order they were sent.
        const due = new Promise<void>(resolve =>
          setTimeout(resolve, holdOf(kind))
        );
        const whenDue =
          (deliver: (...result: unknown[]) => unknown) =>
          (...result: unknown[]): void => {
            void due.then(() => {
              end(trip);
              deliver(...result);
            });
          };
        const last = args[args.length - 1];
        if (typeof last === "function") {
          args[args.length - 1] = whenDue(
            last as (...result: unknown[]) => unknown
          );
          return original.apply(this, args);
        }
        const first = args[0] as
          | {
              once?: unknown;
              emit?: (event: string, ...rest: unknown[]) => boolean;
              onResult?: (...result: unknown[]) => unknown;
            }
          | undefined;
        if (
          first &&
          typeof first === "object" &&
          typeof first.once === "function" &&
          typeof first.emit === "function"
        ) {
          // mysql2's pool hands the connection a ready query command and reads the return value
          // at once. The command calls its own result callback and then says `end`, on which the
          // pool takes the connection back: both wait until the answer is due.
          const command = first as {
            emit: (event: string, ...rest: unknown[]) => boolean;
            onResult?: (...result: unknown[]) => unknown;
          };
          const emit = command.emit;
          command.emit = function (
            this: unknown,
            event: string,
            ...rest: unknown[]
          ): boolean {
            if (event !== "end") return emit.call(this, event, ...rest);
            whenDue(() => emit.call(this, event, ...rest))();
            return true;
          };
          const onResult = command.onResult;
          if (typeof onResult === "function") {
            command.onResult = (...result: unknown[]) => {
              void due.then(() => onResult.apply(command, result));
            };
          }
          original.apply(this, args);
          return first;
        }
        let sent: unknown;
        try {
          sent = original.apply(this, args);
        } catch (error) {
          sent = Promise.reject(error);
        }
        return new Promise((resolve, reject) => {
          Promise.resolve(sent).then(whenDue(resolve), whenDue(reject));
        });
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
