/**
 * The rules a plugin's limits follow, and what one key's entry holds under
 * each.
 *
 * Two kinds:
 * - a window rule: 1 to 4 rolling windows, an attempt admitted only while
 *   every window has room;
 * - a backoff rule: a number of attempts in a row admitted freely, then a
 *   growing wait after each, forgotten after a while with nothing counted.
 *
 * Everything here is arithmetic on one entry's state and the store's clock,
 * with no store in sight, so the limiter decides a whole reservation inside
 * one atomic store update.
 *
 * @experimental
 * @module domains/limits/limit-rules
 */
import { createHash, randomBytes } from "node:crypto";

/** A rule a plugin declares, by name, in `contributes.limits`. @experimental */
export type LimitRule =
  | {
      type: "window";
      /** 1 to 4 rolling windows; an attempt is admitted only if every window has room. */
      windows: ReadonlyArray<{ max: number; perMs: number }>;
    }
  | {
      type: "backoff";
      /** Attempts in a row admitted with no wait: 1 to 1000. */
      free: number;
      /**
       * Then, once an attempt counted while the rule had room brings the count
       * to `free` or more, the next attempt waits `waitsMs[count - free]` from
       * that moment, the last entry repeating. Never decreasing; each 1 ms to
       * 24 hours. Empty: no room once the count reaches `free`, until the
       * count is reset or forgotten.
       */
      waitsMs: readonly number[];
      /** The count is forgotten once this long passes with nothing counted, and never while a wait is in force. */
      forgetAfterMs: number;
    };

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The bounds `contributes.limits` is held to. */
export const LIMIT_RULE_BOUNDS = {
  windows: { min: 1, max: 4 },
  windowMax: { min: 1, max: 10_000 },
  windowPerMs: { min: SECOND, max: 30 * DAY },
  free: { min: 1, max: 1000 },
  waitMs: { min: 1, max: DAY },
  waits: { max: 32 },
  forgetAfterMs: { min: MINUTE, max: 30 * DAY },
  ruleName: { max: 64 },
} as const;

/** Whether `value` is a whole number from `min` to `max`. */
function within(value: unknown, range: { min: number; max: number }): boolean {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= range.min &&
    value <= range.max
  );
}

/** Why a window rule is outside its bounds, or undefined when it is within them. */
function windowProblem(windows: unknown): string | undefined {
  const { windows: count, windowMax, windowPerMs } = LIMIT_RULE_BOUNDS;
  if (
    !Array.isArray(windows) ||
    windows.length < count.min ||
    windows.length > count.max
  ) {
    return `has ${count.min} to ${count.max} windows`;
  }
  for (const window of windows as unknown[]) {
    const { max, perMs } = (window ?? {}) as { max?: unknown; perMs?: unknown };
    if (!within(max, windowMax)) {
      return `allows ${windowMax.min} to ${windowMax.max} attempts per window`;
    }
    if (!within(perMs, windowPerMs)) {
      return "spans 1 second to 30 days per window";
    }
  }
  return undefined;
}

/** Why a backoff rule is outside its bounds, or undefined when it is within them. */
function backoffProblem(rule: Record<string, unknown>): string | undefined {
  const { free, waitMs, waits, forgetAfterMs } = LIMIT_RULE_BOUNDS;
  // A rule with no free attempts would wait before any attempt at all; it is
  // refused rather than given a first wait no reader could guess.
  if (!within(rule.free, free)) {
    return `admits ${free.min} to ${free.max} attempts in a row freely`;
  }
  if (!Array.isArray(rule.waitsMs) || rule.waitsMs.length > waits.max) {
    return `lists at most ${waits.max} waits`;
  }
  let previous = 0;
  for (const wait of rule.waitsMs as unknown[]) {
    if (!within(wait, waitMs)) return "waits 1 millisecond to 24 hours";
    // A shorter wait after a longer one would reward the attacker for
    // persisting.
    if ((wait as number) < previous) return "never shortens its waits";
    previous = wait as number;
  }
  if (!within(rule.forgetAfterMs, forgetAfterMs)) {
    return "forgets after 1 minute to 30 days";
  }
  return undefined;
}

/**
 * Why `rule`, named `name`, is outside the documented bounds, as the end of a
 * sentence ("must …"), or undefined when it is a valid rule.
 */
export function limitRuleProblem(
  name: string,
  rule: unknown
): string | undefined {
  if (name.length === 0 || name.length > LIMIT_RULE_BOUNDS.ruleName.max) {
    return `have a name of 1 to ${LIMIT_RULE_BOUNDS.ruleName.max} characters`;
  }
  if (typeof rule !== "object" || rule === null) return "be a rule";
  const fields = rule as Record<string, unknown>;
  if (fields.type === "window") {
    const problem = windowProblem(fields.windows);
    return problem === undefined
      ? undefined
      : `be a window rule that ${problem}`;
  }
  if (fields.type === "backoff") {
    const problem = backoffProblem(fields);
    return problem === undefined
      ? undefined
      : `be a backoff rule that ${problem}`;
  }
  return 'be of type "window" or "backoff"';
}

/**
 * How many given-back reservations an entry remembers, so a release retried
 * after its answer was lost gives nothing more back. As many as fit beside
 * four windows' buckets in a value of 4 KB; past them, see `releasedThrough`.
 */
const REMEMBERED_RELEASES = 48;

/**
 * How many counted reservations a backoff entry remembers in order, to tell
 * whether the one given back is the last still standing. Releasability never
 * depends on it: a reservation older than these is still given back.
 */
const REMEMBERED_COUNTS = 32;

/** Buckets a rolling window is kept in: its edge is exact to 1/32 of its span. */
const BUCKETS_PER_WINDOW = 32;

/** One rolling window's counts: bucket indexes relative to `base`, with their counts. */
interface WindowCounts {
  base: number;
  buckets: Array<[number, number]>;
}

/** What every entry holds, whatever its rule's kind. */
interface StateBase {
  /** The fingerprint of the rule the entry was written under. */
  rule: string;
  /**
   * A random name for this run of the entry, from its first count until it
   * is reset, forgotten or rewritten under another rule. A reservation
   * carries the epoch each of its entries counted under, and gives back only
   * to that same run: a reset and a new count in one millisecond start a new
   * epoch, where a time could not tell them apart.
   */
  epoch: string;
  /** Reservations given back here, and when each was counted, oldest first. */
  released: Array<[string, number]>;
  /**
   * Reservations counted at or before this time give nothing back: release
   * markers this old were let go to keep the entry within its size. Failing
   * closed, a client then waits out a count it might have had back, and never
   * gets one back twice. 0 while every marker is kept.
   */
  releasedThrough: number;
}

/** A window rule's entry. */
interface WindowState extends StateBase {
  kind: "window";
  windows: WindowCounts[];
}

/** A backoff rule's entry. */
interface BackoffState extends StateBase {
  kind: "backoff";
  /** Attempts in a row. */
  count: number;
  /** When the wait in force ends; 0 for none. */
  waitUntil: number;
  /** The reservation whose count set the wait in force. */
  waitSetBy: string | null;
  /** When the last attempt was counted. */
  lastCounted: number;
  /** The most recent reservations counted here and not given back, oldest first. */
  recent: string[];
}

/** One key's entry under one rule. */
export type RuleState = WindowState | BackoffState;

type WindowRule = Extract<LimitRule, { type: "window" }>;
type BackoffRule = Extract<LimitRule, { type: "backoff" }>;

/** A window's bucket width: 1/32 of its span, never 0. */
const bucketWidth = (perMs: number) =>
  Math.max(1, Math.ceil(perMs / BUCKETS_PER_WINDOW));

/**
 * The shape an entry's state is written in. Part of every fingerprint, so a
 * state in another shape reads as empty and starts again, as a state written
 * under another rule does, rather than being read without the fields this one
 * relies on. Shape 2 is the first any release writes.
 *
 * A later release changing the shape must not simply raise this: during a
 * rolling deployment, instances of both releases update the same entries, and
 * each would read the other's as empty, so counts would keep starting again
 * for as long as both run. It must read the earlier shape as well, and write
 * the new one.
 */
const STATE_FORMAT = 2;

/** Fingerprints already worked out, by rule object. */
const fingerprints = new WeakMap<LimitRule, string>();

/**
 * A short fingerprint of everything `rule` says, and of the shape its entries
 * are written in. An entry records the one it was written under, since what
 * it holds means something only under that rule and that shape: a window's
 * buckets are offsets in units of the window's span, and a backoff's wait was
 * worked out from its waits.
 */
function ruleFingerprint(rule: LimitRule): string {
  const known = fingerprints.get(rule);
  if (known !== undefined) return known;
  const shape =
    rule.type === "window"
      ? [
          STATE_FORMAT,
          "window",
          rule.windows.map(window => [window.max, window.perMs]),
        ]
      : [
          STATE_FORMAT,
          "backoff",
          rule.free,
          [...rule.waitsMs],
          rule.forgetAfterMs,
        ];
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(shape))
    .digest("base64url")
    .slice(0, 16);
  fingerprints.set(rule, fingerprint);
  return fingerprint;
}

/** An entry under `rule` that has counted nothing, in an epoch of its own. */
function emptyState(rule: LimitRule): RuleState {
  const base = {
    rule: ruleFingerprint(rule),
    epoch: randomBytes(6).toString("base64url"),
    released: [],
    releasedThrough: 0,
  };
  return rule.type === "window"
    ? {
        ...base,
        kind: "window",
        windows: rule.windows.map(() => ({ base: 0, buckets: [] })),
      }
    : {
        ...base,
        kind: "backoff",
        count: 0,
        waitUntil: 0,
        waitSetBy: null,
        lastCounted: 0,
        recent: [],
      };
}

/**
 * The entry a stored value holds under `rule`, as of `now`: empty when there
 * is none, when it was written under any other rule (a rule the plugin has
 * since changed starts its counts again, rather than reading them in units
 * they were not written in), or when a backoff count has been forgotten.
 * Buckets past their window are dropped.
 */
export function readRuleState(
  rule: LimitRule,
  stored: unknown,
  now: number
): RuleState {
  const state = stored as Partial<RuleState> | undefined;
  if (state?.kind !== rule.type || state.rule !== ruleFingerprint(rule)) {
    return emptyState(rule);
  }
  if (rule.type === "window") {
    const window = state as WindowState;
    return {
      ...window,
      windows: window.windows.map((counts, index) =>
        liveBuckets(counts, rule.windows[index]?.perMs ?? 0, now)
      ),
    };
  }
  const backoff = state as BackoffState;
  const forgotten =
    now - backoff.lastCounted >= rule.forgetAfterMs && now >= backoff.waitUntil;
  return forgotten ? emptyState(rule) : backoff;
}

/** The buckets of one window still inside it at `now`. */
function liveBuckets(
  counts: WindowCounts,
  perMs: number,
  now: number
): WindowCounts {
  const width = bucketWidth(perMs);
  return {
    base: counts.base,
    // A bucket counts while any of its span is inside the window, so the
    // window is never under-counted, at worst ending up to a bucket late.
    buckets: counts.buckets.filter(
      ([offset]) => (counts.base + offset + 1) * width > now - perMs
    ),
  };
}

/** Attempts a window's buckets hold. */
const total = (counts: WindowCounts) =>
  counts.buckets.reduce((sum, [, count]) => sum + count, 0);

/** Whether the rule has room for one more attempt at `now`. */
export function hasRoom(
  rule: LimitRule,
  state: RuleState,
  now: number
): boolean {
  if (rule.type === "window" && state.kind === "window") {
    return rule.windows.every(
      (window, index) =>
        total(state.windows[index] ?? { base: 0, buckets: [] }) < window.max
    );
  }
  if (rule.type === "backoff" && state.kind === "backoff") {
    if (rule.waitsMs.length === 0) return state.count < rule.free;
    return now >= state.waitUntil;
  }
  return true;
}

/** How long from `now` until a window has room again. */
function windowRetry(
  window: WindowRule["windows"][number],
  counts: WindowCounts,
  now: number
): number {
  const width = bucketWidth(window.perMs);
  const excess = total(counts) - window.max + 1;
  if (excess <= 0) return 0;
  let gone = 0;
  const ordered = [...counts.buckets].sort(([a], [b]) => a - b);
  for (const [offset, count] of ordered) {
    gone += count;
    if (gone >= excess) {
      return (counts.base + offset + 1) * width + window.perMs - now;
    }
  }
  return window.perMs;
}

/** How long from `now` until the rule has room again; 0 when it has room. */
export function retryAfterMs(
  rule: LimitRule,
  state: RuleState,
  now: number
): number {
  if (hasRoom(rule, state, now)) return 0;
  if (rule.type === "window" && state.kind === "window") {
    return Math.max(
      0,
      ...rule.windows.map((window, index) =>
        windowRetry(
          window,
          state.windows[index] ?? { base: 0, buckets: [] },
          now
        )
      )
    );
  }
  if (rule.type === "backoff" && state.kind === "backoff") {
    return rule.waitsMs.length === 0
      ? Math.max(0, state.lastCounted + rule.forgetAfterMs - now)
      : Math.max(0, state.waitUntil - now);
  }
  return 0;
}

/** Add one attempt at `at` to a window's buckets. */
function addToWindow(
  counts: WindowCounts,
  perMs: number,
  at: number
): WindowCounts {
  const index = Math.floor(at / bucketWidth(perMs));
  const base = counts.buckets.length === 0 ? index : counts.base;
  const offset = index - base;
  const buckets = counts.buckets.map(([at2, count]): [number, number] => [
    at2,
    count,
  ]);
  const bucket = buckets.find(([existing]) => existing === offset);
  if (bucket) bucket[1] += 1;
  else buckets.push([offset, 1]);
  return { base, buckets };
}

/**
 * The entry once one attempt is counted on it at `now` for reservation `id`.
 * Counted with room, an attempt sets the next wait as an admitted one would;
 * counted without room, it never moves the wait in force, and only makes the
 * next wait longer.
 */
export function countAttempt(
  rule: LimitRule,
  state: RuleState,
  now: number,
  withRoom: boolean,
  id: string
): RuleState {
  if (rule.type === "window" && state.kind === "window") {
    return {
      ...state,
      windows: state.windows.map((counts, index) =>
        addToWindow(counts, rule.windows[index]?.perMs ?? 1, now)
      ),
    };
  }
  if (rule.type === "backoff" && state.kind === "backoff") {
    const count = state.count + 1;
    const next: BackoffState = {
      ...state,
      count,
      lastCounted: now,
      recent: [...state.recent, id].slice(-REMEMBERED_COUNTS),
    };
    if (withRoom && rule.waitsMs.length > 0 && count >= rule.free) {
      const index = Math.min(count - rule.free, rule.waitsMs.length - 1);
      next.waitUntil = now + (rule.waitsMs[index] ?? 0);
      next.waitSetBy = id;
    }
    return next;
  }
  return state;
}

/**
 * The entry once reservation `id`, counted at `at` in epoch `epoch`, is given
 * back, or undefined when it holds no such count: counted in an earlier run
 * of the entry (it was reset, forgotten or written under another rule since),
 * given back already, counted no later than the release markers the entry
 * has let go, or for a window, counted in buckets that have all left their
 * windows.
 *
 * Nothing needs the entry to remember what it counted, so a reservation is
 * given back however many others were counted after it: a window takes one
 * from the bucket `at` falls in, and a backoff takes one from its count.
 *
 * A backoff count given back also lifts the wait it set, but only while that
 * wait is still the one in force and nothing has been counted since: a wait
 * set by a later attempt, or in force before, is never moved, and a count made
 * after the released one keeps the wait, since had the released attempt never
 * counted, that later one would have set a wait of its own.
 */
export function releaseAttempt(
  rule: LimitRule,
  state: RuleState,
  id: string,
  at: number,
  epoch: string
): RuleState | undefined {
  if (
    epoch !== state.epoch ||
    at <= state.releasedThrough ||
    state.released.some(([released]) => released === id)
  ) {
    return undefined;
  }
  const { released, releasedThrough } = remembered(state, id, at);
  if (rule.type === "window" && state.kind === "window") {
    const windows = state.windows.map((counts, index) =>
      takeFromWindow(counts, rule.windows[index]?.perMs ?? 1, at)
    );
    const took = windows.some(
      (counts, index) => total(counts) < total(state.windows[index] ?? counts)
    );
    return took ? { ...state, windows, released, releasedThrough } : undefined;
  }
  if (rule.type === "backoff" && state.kind === "backoff") {
    if (state.count === 0) return undefined;
    const lifts = state.waitSetBy === id && state.recent.at(-1) === id;
    return {
      ...state,
      count: state.count - 1,
      waitUntil: lifts ? 0 : state.waitUntil,
      waitSetBy: lifts ? null : state.waitSetBy,
      recent: state.recent.filter(reservation => reservation !== id),
      released,
      releasedThrough,
    };
  }
  return undefined;
}

/**
 * The release markers once `id`, counted at `at`, is added: oldest first,
 * and at most {@link REMEMBERED_RELEASES}. Markers let go past that raise
 * `releasedThrough` to the latest time they held, so a reservation they
 * covered is refused rather than given back again.
 */
function remembered(
  state: RuleState,
  id: string,
  at: number
): Pick<StateBase, "released" | "releasedThrough"> {
  const released: Array<[string, number]> = [
    ...state.released,
    [id, at] as [string, number],
  ].sort(([, a], [, b]) => a - b);
  let releasedThrough = state.releasedThrough;
  while (released.length > REMEMBERED_RELEASES) {
    const [, dropped] = released.shift() ?? ["", 0];
    releasedThrough = Math.max(releasedThrough, dropped);
  }
  return { released, releasedThrough };
}

/**
 * Whether an entry holds nothing a later reservation would read: no count in
 * any window, or no backoff count and no wait in force. Such an entry is
 * removed rather than kept until it would expire, so given-back attempts
 * never hold room in a bounded store.
 */
export function holdsNothing(state: RuleState, now: number): boolean {
  if (state.kind === "window") {
    return state.windows.every(counts => counts.buckets.length === 0);
  }
  return state.count === 0 && state.waitUntil <= now;
}

/** Take back one attempt counted at `at` from a window's buckets. */
function takeFromWindow(
  counts: WindowCounts,
  perMs: number,
  at: number
): WindowCounts {
  const offset = Math.floor(at / bucketWidth(perMs)) - counts.base;
  return {
    base: counts.base,
    buckets: counts.buckets
      .map(([existing, count]): [number, number] =>
        existing === offset ? [existing, count - 1] : [existing, count]
      )
      .filter(([, count]) => count > 0),
  };
}

/**
 * When the entry can be forgotten: the end of its longest window after its
 * last attempt, or for a backoff rule the later of its idle time and the end
 * of the wait in force, so a short idle time never ends a long wait early.
 */
export function stateExpiresAt(rule: LimitRule, state: RuleState): number {
  if (rule.type === "window" && state.kind === "window") {
    return Math.max(
      0,
      ...state.windows.map((counts, index) => {
        const perMs = rule.windows[index]?.perMs ?? 0;
        const last = Math.max(...counts.buckets.map(([offset]) => offset), -1);
        return last < 0
          ? 0
          : (counts.base + last + 1) * bucketWidth(perMs) + perMs;
      })
    );
  }
  if (rule.type === "backoff" && state.kind === "backoff") {
    return Math.max(state.lastCounted + rule.forgetAfterMs, state.waitUntil);
  }
  return 0;
}

export type { WindowRule, BackoffRule };
