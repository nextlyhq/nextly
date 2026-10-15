import type {
  AdmittedReservation,
  EntryVerdict,
  LimitCheck,
  LimitEntry,
  LimitOutcome,
  LimitReservation,
  LimitRule,
  LimitTarget,
  PluginLimiter,
} from "../core/ports";

import {
  FakeCoreMisuse,
  roundTrip,
  type FakeClock,
  type FakeTransactions,
} from "./fake-transactions";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

type WindowRule = Extract<LimitRule, { type: "window" }>;
type BackoffRule = Extract<LimitRule, { type: "backoff" }>;

interface BackoffState {
  count: number;
  /** When the wait in force ends; 0 with none, Infinity until reset or forgotten. */
  waitUntil: number;
  lastCountedAt: number;
  /** Every count ever made on the entry, given back or not: which count came last. */
  counted: number;
}

/** What one counted entry added, so a release can take it back once. */
interface Counted {
  readonly target: LimitTarget;
  /** The run of the entry it was counted in; a release gives back to that run only. */
  readonly epoch: string;
  /** The window's timestamp it added; absent for a backoff rule. */
  readonly at?: number;
  /**
   * For a backoff rule, the wait this count set and the one in force before
   * it, so giving it back lifts a wait only it set; absent when it set none.
   */
  readonly setWait?: { until: number; before: number; atCount: number };
  released: boolean;
}

/**
 * Core's limiter on one shared in-memory store, with core's semantics for
 * the two rule kinds, `enforce`, the three `count` modes, `release` at most
 * once per entry, and the refusal to count inside a transaction. Set
 * `available` to false to make the store stop answering.
 */
export class FakeLimiter implements PluginLimiter {
  readonly #clock: FakeClock;
  readonly #transactions: FakeTransactions;
  readonly #rules: ReadonlyMap<string, LimitRule>;
  readonly #windows = new Map<string, number[]>();
  readonly #backoffs = new Map<string, BackoffState>();
  readonly #reservations = new Map<string, Counted[]>();
  /**
   * Each entry's current run, as core keeps it: a reset, or a backoff
   * forgotten once idle, starts a new one, and a count taken in an earlier
   * run is never given back to it.
   */
  readonly #epochs = new Map<string, string>();
  #nextId = 1;
  #nextEpoch = 1;
  readonly store: { shared: boolean; singleInstance: boolean };
  /** False: the store does not answer, and every call says `unavailable`. */
  available = true;

  constructor(
    clock: FakeClock,
    transactions: FakeTransactions,
    rules: Readonly<Record<string, LimitRule>>,
    store: { shared: boolean; singleInstance: boolean } = {
      shared: true,
      singleInstance: false,
    }
  ) {
    for (const [name, rule] of Object.entries(rules)) checkRule(name, rule);
    this.#clock = clock;
    this.#transactions = transactions;
    this.#rules = new Map(Object.entries(rules));
    this.store = { ...store };
  }

  async reserve(entries: readonly LimitEntry[]): Promise<LimitReservation> {
    await roundTrip();
    this.#transactions.assertNone("limits.reserve");
    if (entries.length < 1 || entries.length > 16) {
      throw new FakeCoreMisuse(
        `a reservation of ${entries.length} entries is outside 1 to 16`
      );
    }
    for (const entry of entries) this.#rule(entry);
    if (!this.available) return { status: "unavailable" };

    const now = this.#clock.now();
    const room = entries.map(entry => this.#hasRoom(entry, now));
    const admitted = entries.every(
      (entry, index) => entry.enforce === false || room[index]
    );
    const unanimous = room.every(Boolean);

    const counted: Counted[] = [];
    const entryVerdicts: EntryVerdict[] = entries.map((entry, index) => {
      const hadRoom = room[index] === true;
      const mode = entry.count ?? "admitted";
      const isCounted =
        mode === "always" ||
        (mode === "unanimous" ? unanimous : admitted && hadRoom);
      if (isCounted) counted.push(this.#count(entry, hadRoom, now));

      return { rule: entry.rule, key: entry.key, hadRoom, counted: isCounted };
    });
    // Per entry, the run it was counted in, empty where it was not counted.
    const countedEpochs = [...counted];
    const epochs = entryVerdicts.map(verdict =>
      verdict.counted ? (countedEpochs.shift()?.epoch ?? "") : ""
    );

    if (!admitted) {
      const refusing = entries.filter(
        (entry, index) => entry.enforce !== false && !room[index]
      );

      return {
        status: "refused",
        retryAfterMs: Math.max(
          ...refusing.map(entry => this.#retryAfter(entry, now))
        ),
        refusedBy: [...new Set(refusing.map(entry => entry.rule))],
        entries: entryVerdicts,
      };
    }
    const id = `fake-reservation-${this.#nextId++}`;
    this.#reservations.set(id, counted);

    return {
      status: "admitted",
      // When it was counted, on the store's clock, as core records it.
      reservation: { id, at: now, entries: entryVerdicts, epochs },
    };
  }

  async release(
    reservation: AdmittedReservation,
    options: { rules?: readonly string[] } = {}
  ): Promise<LimitOutcome> {
    await roundTrip();
    assertAdmitted(reservation, options.rules);
    this.#transactions.assertNone("limits.release");
    if (!this.available) return { status: "unavailable" };
    // As core: each count is given back in the run the caller's reservation
    // names for it, so a copy carrying stale runs gives nothing back.
    const supplied = reservation.epochs.filter(
      (_, index) => reservation.entries[index]?.counted === true
    );
    const counts = this.#reservations.get(reservation.id) ?? [];
    counts.forEach((counted, index) => {
      const named = options.rules?.includes(counted.target.rule) ?? true;
      if (!counted.released && named)
        this.#giveBack(counted, supplied[index] ?? "");
    });

    return { status: "done" };
  }

  /** Takes one counted entry's count back, once, and only in the run it was counted in. */
  #giveBack(counted: Counted, epoch: string): void {
    // A count named by a stale run is not this one's to give back, and stays
    // to be given back by the reservation that holds its real run.
    if (this.#epochs.get(slot(counted.target)) !== epoch) return;
    counted.released = true;
    if (counted.at !== undefined) {
      const times = this.#windows.get(slot(counted.target)) ?? [];
      const index = times.indexOf(counted.at);
      if (index !== -1) times.splice(index, 1);
      return;
    }
    const state = this.#backoffs.get(slot(counted.target));
    if (state === undefined) return;
    state.count = Math.max(0, state.count - 1);
    // A count given back never leaves a wait behind that only it set (an
    // attempt that succeeded is no failure to wait for), but only while
    // nothing was counted on the entry since: a later count would have set
    // a wait of its own.
    if (
      counted.setWait !== undefined &&
      state.waitUntil === counted.setWait.until &&
      state.counted === counted.setWait.atCount
    ) {
      state.waitUntil = counted.setWait.before;
    }
  }

  async reset(target: LimitTarget): Promise<LimitOutcome> {
    await roundTrip();
    this.#transactions.assertNone("limits.reset");
    this.#rule(target);
    if (!this.available) return { status: "unavailable" };
    this.#windows.delete(slot(target));
    this.#backoffs.delete(slot(target));
    this.#epochs.delete(slot(target));

    return { status: "done" };
  }

  async check(targets: readonly LimitTarget[]): Promise<LimitCheck> {
    await roundTrip();
    for (const target of targets) this.#rule(target);
    if (!this.available) return { status: "unavailable" };
    const now = this.#clock.now();

    return {
      status: "ok",
      entries: targets.map(target => {
        const wouldAdmit = this.#hasRoom(target, now);

        return {
          rule: target.rule,
          key: target.key,
          wouldAdmit,
          retryAfterMs: wouldAdmit ? 0 : this.#retryAfter(target, now),
        };
      }),
    };
  }

  /**
   * The first address of `x-forwarded-for`, in core's forms: an IPv4
   * address, the IPv4 inside an IPv4-mapped address, or an IPv6 address's
   * /64. Null without the header.
   */
  clientKey(request: Request): string | null {
    const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (first === undefined || first === "") return null;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(first);
    if (mapped?.[1] !== undefined) return mapped[1];
    if (!first.includes(":")) return first;

    return `${expandIpv6(first).slice(0, 4).join(":")}::/64`;
  }

  #rule(target: LimitTarget): LimitRule {
    const rule = this.#rules.get(target.rule);
    if (rule === undefined)
      throw new FakeCoreMisuse(`the rule "${target.rule}" was never declared`);
    if (target.key.length === 0 || target.key.length > 512) {
      throw new FakeCoreMisuse("a key must be 1 to 512 characters");
    }

    return rule;
  }

  #hasRoom(target: LimitTarget, now: number): boolean {
    const rule = this.#rule(target);
    if (rule.type === "window") {
      const times = this.#windows.get(slot(target)) ?? [];
      return rule.windows.every(
        window => inWindow(times, window.perMs, now) < window.max
      );
    }

    return now >= this.#backoff(target, rule, now).waitUntil;
  }

  #retryAfter(target: LimitTarget, now: number): number {
    const rule = this.#rule(target);
    if (rule.type === "window") {
      const times = [...(this.#windows.get(slot(target)) ?? [])].sort(
        (a, b) => a - b
      );
      return Math.max(
        0,
        ...rule.windows.map(window => {
          const within = times.filter(time => time > now - window.perMs);
          const leaving = within[within.length - window.max];
          return leaving === undefined ? 0 : leaving + window.perMs - now;
        })
      );
    }
    const state = this.#backoff(target, rule, now);

    return state.waitUntil === Infinity
      ? state.lastCountedAt + rule.forgetAfterMs - now
      : Math.max(0, state.waitUntil - now);
  }

  #count(target: LimitTarget, hadRoom: boolean, now: number): Counted {
    const rule = this.#rule(target);
    const epoch = this.#epoch(target, rule, now);
    if (rule.type === "window") {
      const times = this.#windows.get(slot(target)) ?? [];
      times.push(now);
      this.#windows.set(slot(target), times);
      return {
        target: { rule: target.rule, key: target.key },
        epoch,
        at: now,
        released: false,
      };
    }
    const state = this.#backoff(target, rule, now);
    state.count += 1;
    state.counted += 1;
    state.lastCountedAt = now;
    let setWait: Counted["setWait"];
    // Counted with room, an attempt sets the next wait; counted without
    // room ("always"), it leaves the wait in force where it is.
    if (hadRoom && state.count >= rule.free) {
      const wait =
        rule.waitsMs[
          Math.min(state.count - rule.free, rule.waitsMs.length - 1)
        ];
      const before = state.waitUntil;
      state.waitUntil = wait === undefined ? Infinity : now + wait;
      setWait = { until: state.waitUntil, before, atCount: state.counted };
    }
    this.#backoffs.set(slot(target), state);

    return {
      target: { rule: target.rule, key: target.key },
      epoch,
      ...(setWait === undefined ? {} : { setWait }),
      released: false,
    };
  }

  /**
   * The entry's current run, begun anew where it has none: after a reset,
   * or once a backoff is forgotten. Read before the count, so a count that
   * finds its backoff forgotten counts in the new run.
   */
  #epoch(target: LimitTarget, rule: LimitRule, now: number): string {
    if (rule.type === "backoff") this.#backoff(target, rule, now);
    const known = this.#epochs.get(slot(target));
    if (known !== undefined) return known;
    const begun = `fake-epoch-${this.#nextEpoch++}`;
    this.#epochs.set(slot(target), begun);

    return begun;
  }

  /** A backoff key's state, forgotten once idle past `forgetAfterMs` with no wait in force. */
  #backoff(target: LimitTarget, rule: BackoffRule, now: number): BackoffState {
    const state = this.#backoffs.get(slot(target));
    const forgotten =
      state !== undefined &&
      now - state.lastCountedAt >= rule.forgetAfterMs &&
      (state.waitUntil === Infinity || now >= state.waitUntil);
    if (state === undefined || forgotten) {
      this.#backoffs.delete(slot(target));
      if (forgotten) this.#epochs.delete(slot(target));
      return { count: 0, waitUntil: 0, lastCountedAt: now, counted: 0 };
    }

    return state;
  }
}

/**
 * Refuses, as core does before it asks the store anything, a reservation
 * `reserve` did not admit: one without a run per entry, or, when it has a
 * count to give back, without the time it was counted at. A store that does
 * not answer never hides the misuse.
 */
function assertAdmitted(
  reservation: AdmittedReservation,
  rules: readonly string[] | undefined
): void {
  const misuse = new FakeCoreMisuse(
    "limits.release was given a reservation that reserve did not admit"
  );
  if (
    !Array.isArray(reservation.epochs) ||
    reservation.epochs.length !== reservation.entries.length
  )
    throw misuse;
  const giving = reservation.entries.some(
    entry => entry.counted && (rules?.includes(entry.rule) ?? true)
  );
  if (giving && !Number.isFinite(reservation.at)) throw misuse;
}

function slot(target: LimitTarget): string {
  return `${target.rule}\u0000${target.key}`;
}

function inWindow(
  times: readonly number[],
  perMs: number,
  now: number
): number {
  return times.filter(time => time > now - perMs).length;
}

function expandIpv6(address: string): string[] {
  const [head = "", tail] = address.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");
  const zeros = Array.from(
    { length: Math.max(0, 8 - left.length - right.length) },
    () => "0"
  );

  return [...left, ...zeros, ...right].map(group =>
    group.toLowerCase().replace(/^0+(?=.)/, "")
  );
}

function checkRule(name: string, rule: LimitRule): void {
  const bad = (why: string): never => {
    throw new FakeCoreMisuse(`limit rule "${name}": ${why}`);
  };
  if (rule.type === "window") {
    checkWindows(rule, bad);
    return;
  }
  if (!Number.isInteger(rule.free) || rule.free < 0 || rule.free > 1000)
    bad("free is outside 0 to 1,000");
  if (rule.waitsMs.some(wait => wait < 1 || wait > DAY))
    bad("a wait is outside 1 ms to 24 h");
  if (rule.forgetAfterMs < MINUTE || rule.forgetAfterMs > 30 * DAY) {
    bad("forgetAfterMs is outside 1 minute to 30 days");
  }
}

function checkWindows(rule: WindowRule, bad: (why: string) => never): void {
  if (rule.windows.length < 1 || rule.windows.length > 4)
    bad("a rule takes 1 to 4 windows");
  for (const window of rule.windows) {
    if (!Number.isInteger(window.max) || window.max < 1 || window.max > 10_000)
      bad("max is outside 1 to 10,000");
    if (window.perMs < SECOND || window.perMs > 30 * DAY)
      bad("perMs is outside 1 s to 30 days");
  }
}
