/**
 * The plugin limiter: its rules with a clock, the atomic reservation over
 * several entries, the counting modes, giving back, and what it answers when
 * the store cannot.
 */
import { afterEach, describe, expect, it } from "vitest";

import { setNextlyLogger } from "../../../observability/logger";
import { rateLimitClient } from "../../../plugins/routes/route-options";
import {
  limitStoreUnavailable,
  type LimitStore,
  type StoredLimit,
} from "../limit-store";
import { limitRuleProblem, type LimitRule } from "../limit-rules";
import { createMemoryLimitStore } from "../memory-limit-store";
import {
  createPluginLimiter,
  type LimitEntry,
  type LimitReservation,
  type PluginLimiter,
} from "../plugin-limiter";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** A clock a test moves by hand. */
function clock(start = 1_700_000_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** The rules the tests' plugin declares. */
const RULES: Record<string, LimitRule> = {
  // 3 attempts in 15 minutes.
  window: { type: "window", windows: [{ max: 3, perMs: 15 * MINUTE }] },
  // 2 free, then 1 s, 2 s, 4 s, repeating 4 s; forgotten after an hour idle.
  backoff: {
    type: "backoff",
    free: 2,
    waitsMs: [SECOND, 2 * SECOND, 4 * SECOND],
    forgetAfterMs: HOUR,
  },
  // 5 free, then waits that grow to a minute.
  address: {
    type: "backoff",
    free: 5,
    waitsMs: [SECOND, 2 * SECOND, 4 * SECOND, 60 * SECOND],
    forgetAfterMs: 24 * HOUR,
  },
  client: {
    type: "backoff",
    free: 5,
    waitsMs: [SECOND, 2 * SECOND, 4 * SECOND, 60 * SECOND],
    forgetAfterMs: 24 * HOUR,
  },
  token: { type: "window", windows: [{ max: 10, perMs: HOUR }] },
  // Free 20, counted always, released on success.
  signin: {
    type: "backoff",
    free: 20,
    waitsMs: [MINUTE, 5 * MINUTE],
    forgetAfterMs: 24 * HOUR,
  },
  stuck: { type: "backoff", free: 2, waitsMs: [], forgetAfterMs: HOUR },
  perAddress: { type: "window", windows: [{ max: 5, perMs: 24 * HOUR }] },
};

/** What each test builds the limiter from. */
function setup(
  options: {
    store?: LimitStore;
    plugin?: string;
    transactionOpen?: () => boolean;
    trustProxy?: boolean;
  } = {}
) {
  const time = clock();
  const memory = options.store ?? createMemoryLimitStore({ clock: time.now });
  // Every entry each update writes, in order: `null` for one it deletes.
  const writes: Array<[string, StoredLimit | null]> = [];
  const store: LimitStore = {
    shared: memory.shared,
    update: (keys, apply) =>
      memory.update(keys, (current, now) => {
        const outcome = apply(current, now);
        writes.push(...outcome.write);
        return outcome;
      }),
    read: keys => memory.read(keys),
    sweep: () => memory.sweep(),
  };
  const limiter = (
    plugin = options.plugin ?? "@test/limits",
    rules: Record<string, LimitRule> = RULES
  ) =>
    createPluginLimiter({
      plugin,
      rules: new Map(Object.entries(rules)),
      store,
      secret: "install secret",
      singleInstance: false,
      transactions: {
        transactionOpenInFlow: options.transactionOpen ?? (() => false),
      },
      clientAddress: request =>
        options.trustProxy ? request.headers.get("x-forwarded-for") : null,
      clientOf: rateLimitClient,
    });
  return { time, store, writes, limits: limiter(), limiter };
}

/** Reserve, expecting an answer of `status`. */
async function reserve(
  limits: PluginLimiter,
  entries: LimitEntry[]
): Promise<LimitReservation> {
  return limits.reserve(entries);
}

afterEach(() => {
  setNextlyLogger(undefined);
});

describe("rule bounds", () => {
  it("accepts a rule within its bounds", () => {
    for (const [name, rule] of Object.entries(RULES)) {
      expect(limitRuleProblem(name, rule)).toBeUndefined();
    }
  });

  it("refuses a backoff rule with no free attempts", () => {
    expect(
      limitRuleProblem("r", {
        type: "backoff",
        free: 0,
        waitsMs: [SECOND],
        forgetAfterMs: HOUR,
      })
    ).toMatch(/admits 1 to 1000 attempts/);
  });

  it("refuses waits that shorten anywhere along the list, and accepts equal ones", () => {
    const rule = (waitsMs: number[]) => ({
      type: "backoff",
      free: 1,
      waitsMs,
      forgetAfterMs: HOUR,
    });
    expect(limitRuleProblem("r", rule([1000, 4000, 2000]))).toMatch(
      /never shortens/
    );
    expect(limitRuleProblem("r", rule([1000, 1000, 4000]))).toBeUndefined();
  });

  it("refuses each bound it is held to", () => {
    const window = (windows: unknown) => ({ type: "window", windows });
    expect(limitRuleProblem("r", window([]))).toMatch(/1 to 4 windows/);
    expect(
      limitRuleProblem("r", window(Array(5).fill({ max: 1, perMs: SECOND })))
    ).toMatch(/1 to 4 windows/);
    expect(limitRuleProblem("r", window([{ max: 0, perMs: SECOND }]))).toMatch(
      /attempts per window/
    );
    expect(
      limitRuleProblem("r", window([{ max: 10_001, perMs: SECOND }]))
    ).toMatch(/attempts per window/);
    expect(limitRuleProblem("r", window([{ max: 1, perMs: 999 }]))).toMatch(
      /1 second to 30 days/
    );
    expect(
      limitRuleProblem("r", {
        type: "backoff",
        free: 1,
        waitsMs: [25 * HOUR],
        forgetAfterMs: HOUR,
      })
    ).toMatch(/1 millisecond to 24 hours/);
    expect(
      limitRuleProblem("r", {
        type: "backoff",
        free: 1,
        waitsMs: [],
        forgetAfterMs: SECOND,
      })
    ).toMatch(/1 minute to 30 days/);
    expect(limitRuleProblem("r", { type: "other" })).toMatch(
      /"window" or "backoff"/
    );
    expect(limitRuleProblem("", RULES.window)).toMatch(/name of 1 to 64/);
  });
});

describe("a window rule", () => {
  it("admits its max in the window, refuses the next with the time it waits, and admits again once the window passes", async () => {
    const { limits, time } = setup();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(
        (await reserve(limits, [{ rule: "window", key: "k" }])).status
      ).toBe("admitted");
      time.advance(MINUTE);
    }

    const refused = await reserve(limits, [{ rule: "window", key: "k" }]);

    expect(refused).toMatchObject({ status: "refused", refusedBy: ["window"] });
    // The first attempt leaves the window 15 minutes after it, to within one
    // of the window's 32 buckets.
    const wait = refused.status === "refused" ? refused.retryAfterMs : 0;
    expect(wait).toBeGreaterThanOrEqual(12 * MINUTE);
    expect(wait).toBeLessThanOrEqual(12 * MINUTE + (15 * MINUTE) / 32);
    time.advance(wait);
    expect((await reserve(limits, [{ rule: "window", key: "k" }])).status).toBe(
      "admitted"
    );
  });
});

describe("a backoff rule", () => {
  it("admits its free attempts, then waits each listed wait in turn, the last repeating", async () => {
    const { limits, time } = setup();
    const at = () => reserve(limits, [{ rule: "backoff", key: "k" }]);
    expect((await at()).status).toBe("admitted");
    expect((await at()).status).toBe("admitted");
    // The second attempt reached `free`: the next waits a second.
    expect(await at()).toMatchObject({
      status: "refused",
      retryAfterMs: SECOND,
    });
    time.advance(SECOND);
    expect((await at()).status).toBe("admitted");
    expect(await at()).toMatchObject({ retryAfterMs: 2 * SECOND });
    time.advance(2 * SECOND);
    expect((await at()).status).toBe("admitted");
    expect(await at()).toMatchObject({ retryAfterMs: 4 * SECOND });
    time.advance(4 * SECOND);
    expect((await at()).status).toBe("admitted");
    expect(await at()).toMatchObject({ retryAfterMs: 4 * SECOND });
  });

  it("forgets the count after its idle time", async () => {
    const { limits, time } = setup();
    const at = () => reserve(limits, [{ rule: "backoff", key: "k" }]);
    await at();
    await at();
    time.advance(HOUR);
    expect((await at()).status).toBe("admitted");
    expect((await at()).status).toBe("admitted");
  });

  it("with no waits listed, has no room once the count reaches free, until reset", async () => {
    const { limits } = setup();
    const at = () => reserve(limits, [{ rule: "stuck", key: "k" }]);
    await at();
    await at();
    expect(await at()).toMatchObject({ status: "refused", retryAfterMs: HOUR });
    await limits.reset({ rule: "stuck", key: "k" });
    expect((await at()).status).toBe("admitted");
  });

  it("keeps its entry past an idle time shorter than the wait in force, and the wait to its end", async () => {
    const time = clock();
    const store = createMemoryLimitStore({ clock: time.now });
    const limits = createPluginLimiter({
      plugin: "@test/limits",
      rules: new Map([
        [
          "long",
          {
            type: "backoff",
            free: 1,
            waitsMs: [2 * HOUR],
            forgetAfterMs: MINUTE,
          },
        ],
      ]),
      store,
      secret: "s",
      singleInstance: false,
      transactions: { transactionOpenInFlow: () => false },
      clientAddress: () => null,
      clientOf: rateLimitClient,
    });
    await limits.reserve([{ rule: "long", key: "k" }]);
    time.advance(HOUR);

    expect(await limits.reserve([{ rule: "long", key: "k" }])).toMatchObject({
      status: "refused",
      retryAfterMs: HOUR,
    });
    time.advance(HOUR);
    expect((await limits.reserve([{ rule: "long", key: "k" }])).status).toBe(
      "admitted"
    );
  });
});

describe("a reservation", () => {
  it("admits exactly a rule's number of 50 simultaneous reservations through two limiters sharing one store", async () => {
    const { limiter } = setup();
    const first = limiter();
    const second = limiter();

    const outcomes = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        (index % 2 === 0 ? first : second).reserve([
          { rule: "window", key: "k" },
        ])
      )
    );

    expect(
      outcomes.filter(outcome => outcome.status === "admitted")
    ).toHaveLength(3);
  });

  it("is atomic across 12 entries, and refuses 17 entries", async () => {
    const { limits } = setup();
    const entries = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        rule: "token",
        key: `t${index}`,
      }));
    // One key full: the whole reservation is refused, and nothing counted.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await limits.reserve([{ rule: "token", key: "t11" }]);
    }

    const refused = await limits.reserve(entries(12));

    expect(refused).toMatchObject({ status: "refused", refusedBy: ["token"] });
    const checked = await limits.check(entries(11));
    expect(
      checked.status === "ok" &&
        checked.entries.every(entry => entry.wouldAdmit)
    ).toBe(true);
    await expect(limits.reserve(entries(17))).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("refuses a key longer than 512 characters, an empty one, and a rule never declared", async () => {
    const { limits } = setup();
    expect(
      (await limits.reserve([{ rule: "window", key: "k".repeat(512) }])).status
    ).toBe("admitted");
    await expect(
      limits.reserve([{ rule: "window", key: "k".repeat(513) }])
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    await expect(
      limits.reserve([{ rule: "window", key: "" }])
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
    await expect(
      limits.reserve([{ rule: "nope", key: "k" }])
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("refuses with each rule kind's own time", async () => {
    const { limits } = setup();
    await limits.reserve([{ rule: "backoff", key: "k" }]);
    await limits.reserve([{ rule: "backoff", key: "k" }]);

    expect(
      await limits.reserve([
        { rule: "backoff", key: "k" },
        { rule: "window", key: "w" },
      ])
    ).toMatchObject({
      status: "refused",
      retryAfterMs: SECOND,
      refusedBy: ["backoff"],
    });
  });

  it("reports an enforce: false entry with no room, and still admits", async () => {
    const { limits } = setup();
    await limits.reserve([{ rule: "backoff", key: "a" }]);
    await limits.reserve([{ rule: "backoff", key: "a" }]);

    const admitted = await limits.reserve([
      { rule: "backoff", key: "a", enforce: false },
      { rule: "window", key: "w" },
    ]);

    expect(admitted.status).toBe("admitted");
    expect(
      admitted.status === "admitted" && admitted.reservation.entries
    ).toEqual([
      { rule: "backoff", key: "a", hadRoom: false, counted: false },
      { rule: "window", key: "w", hadRoom: true, counted: true },
    ]);
  });

  it("can skip an address's wait while its attempt still counts for the address", async () => {
    const { limits } = setup();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await limits.reserve([{ rule: "backoff", key: "a" }]);
    }

    const admitted = await limits.reserve([
      { rule: "backoff", key: "a", enforce: false, count: "always" },
    ]);

    expect(admitted.status).toBe("admitted");
    expect(
      admitted.status === "admitted" && admitted.reservation.entries[0]
    ).toEqual({ rule: "backoff", key: "a", hadRoom: false, counted: true });
  });
});

/** Both sign-in entries, as `check` reads them. */
const SIGN_IN_TARGETS = [
  { rule: "address", key: "a" },
  { rule: "client", key: "c" },
];

/**
 * One sign-in attempt, the address "unanimous" and the client "always", a
 * matching token setting `enforce: false` on both, after the address and the
 * client are brought to waiting as asked. Answers the counts it leaves, having
 * checked that no wait in force moved.
 */
async function signInTrace(
  addressWaiting: boolean,
  clientWaiting: boolean,
  token: boolean
): Promise<string> {
  const { limits } = setup();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (addressWaiting) await limits.reserve([{ rule: "address", key: "a" }]);
    if (clientWaiting) await limits.reserve([{ rule: "client", key: "c" }]);
  }
  const before = await limits.check(SIGN_IN_TARGETS);
  await limits.reserve([
    { rule: "address", key: "a", count: "unanimous", enforce: !token },
    { rule: "client", key: "c", count: "always", enforce: !token },
  ]);
  const after = await limits.check(SIGN_IN_TARGETS);
  const waits = (check: typeof before) =>
    check.status === "ok"
      ? check.entries.map(entry =>
          entry.wouldAdmit ? null : entry.retryAfterMs
        )
      : [];
  // A wait in force before the attempt ends exactly when it would have.
  waits(before).forEach((wait, index) => {
    if (wait !== null) expect(waits(after)[index]).toBe(wait);
  });
  return JSON.stringify(after);
}

describe("the counting modes", () => {
  it('leaves the refusing address\'s count as it was and adds one to an "always" client', async () => {
    const { limits, time } = setup();
    // The address waiting.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await limits.reserve([{ rule: "address", key: "a@x" }]);
    }
    const before = await limits.check([{ rule: "address", key: "a@x" }]);

    const refused = await limits.reserve([
      { rule: "address", key: "a@x", count: "unanimous" },
      { rule: "client", key: "1.2.3.4", count: "always" },
    ]);

    expect(refused.status).toBe("refused");
    expect(refused.status === "refused" && refused.entries).toEqual([
      { rule: "address", key: "a@x", hadRoom: false, counted: false },
      { rule: "client", key: "1.2.3.4", hadRoom: true, counted: true },
    ]);
    // The address's wait ends when it would have.
    expect(await limits.check([{ rule: "address", key: "a@x" }])).toEqual(
      before
    );
    time.advance(SECOND);
    expect(
      (await limits.reserve([{ rule: "address", key: "a@x" }])).status
    ).toBe("admitted");
  });

  it('counts an enforce: false "unanimous" address only when neither it nor the client is waiting', async () => {
    const { limits } = setup();
    const signIn = () =>
      limits.reserve([
        { rule: "address", key: "a@x", enforce: false, count: "unanimous" },
        { rule: "client", key: "c", count: "always" },
      ]);
    // Five attempts with room count on both; the fifth sets both waits.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const outcome = await signIn();
      expect(
        outcome.status === "admitted" && outcome.reservation.entries[0]?.counted
      ).toBe(true);
    }

    const whileWaiting = await signIn();

    // The client waits, so the reservation is refused and the address is not counted.
    expect(whileWaiting.status).toBe("refused");
    expect(
      whileWaiting.status === "refused" && whileWaiting.entries[0]?.counted
    ).toBe(false);
  });

  it('does not count a "unanimous" entry when another entry, not enforced, has no room, though the reservation is admitted', async () => {
    const { limits } = setup();
    // The client's rule has no room; it is not enforced, so it refuses nothing.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await limits.reserve([{ rule: "backoff", key: "client" }]);
    }

    const admitted = await limits.reserve([
      { rule: "window", key: "address", count: "unanimous" },
      { rule: "backoff", key: "client", enforce: false },
    ]);

    expect(admitted.status).toBe("admitted");
    expect(
      admitted.status === "admitted" && admitted.reservation.entries[0]
    ).toEqual({
      rule: "window",
      key: "address",
      hadRoom: true,
      counted: false,
    });
  });

  it('counts an "always" backoff entry during its wait without moving it, and sets the longer wait next', async () => {
    const { limits, time } = setup();
    const at = () =>
      limits.reserve([{ rule: "backoff", key: "k", count: "always" }]);
    await at();
    await at(); // sets a 1 s wait
    time.advance(500);
    // Counted during the wait: the wait still ends at 1 s.
    expect(await at()).toMatchObject({ status: "refused", retryAfterMs: 500 });
    time.advance(500);
    // Room again; this attempt is the fourth in a row: waitsMs[4 - 2] = 4 s.
    expect((await at()).status).toBe("admitted");
    expect(await at()).toMatchObject({ retryAfterMs: 4 * SECOND });
  });

  it("leaves the same counts with and without a matching token's enforce: false, and moves no wait in force", async () => {
    // address waiting or not × client waiting or not × with or without token.
    for (const addressWaiting of [false, true]) {
      for (const clientWaiting of [false, true]) {
        const without = await signInTrace(addressWaiting, clientWaiting, false);
        const withToken = await signInTrace(
          addressWaiting,
          clientWaiting,
          true
        );
        expect(withToken).toBe(without);
      }
    }
  });

  it("releases a waiting address on schedule while a waiting client probes it every few seconds for 24 hours", async () => {
    const { limits, time } = setup();
    // Both waiting at their longest.
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await limits.reserve([
        { rule: "address", key: "victim", count: "always" },
        { rule: "client", key: "attacker", count: "always" },
      ]);
    }
    const until = time.now() + 24 * HOUR;
    let addressAdmitted = false;
    while (time.now() < until) {
      const probe = await limits.reserve([
        { rule: "address", key: "victim", count: "unanimous" },
        { rule: "client", key: "attacker", count: "always" },
      ]);
      expect(probe.status === "admitted" || probe.status === "refused").toBe(
        true
      );
      time.advance(5 * SECOND);
      const owner = await limits.check([{ rule: "address", key: "victim" }]);
      if (owner.status === "ok" && owner.entries[0]?.wouldAdmit) {
        addressAdmitted = true;
        break;
      }
    }
    // The address's own wait ends within its longest wait, probes or not.
    expect(addressAdmitted).toBe(true);
  });
});

describe("giving back and forgetting", () => {
  it("gives back a reservation once, however often it is released", async () => {
    const { limits } = setup();
    await limits.reserve([{ rule: "window", key: "k" }]);
    await limits.reserve([{ rule: "window", key: "k" }]);
    const third = await limits.reserve([{ rule: "window", key: "k" }]);
    if (third.status !== "admitted") throw new Error("not admitted");

    expect(await limits.release(third.reservation)).toEqual({ status: "done" });
    expect(await limits.release(third.reservation)).toEqual({ status: "done" });

    expect((await limits.reserve([{ rule: "window", key: "k" }])).status).toBe(
      "admitted"
    );
    expect((await limits.reserve([{ rule: "window", key: "k" }])).status).toBe(
      "refused"
    );
  });

  it("gives back a backoff count once, however often it is released", async () => {
    const { limits } = setup();
    const at = () => limits.reserve([{ rule: "stuck", key: "k" }]);
    await at();
    const second = await at();
    if (second.status !== "admitted") throw new Error("not admitted");

    await limits.release(second.reservation);
    await limits.release(second.reservation);

    // One count given back: room for one attempt, not two.
    expect((await at()).status).toBe("admitted");
    expect((await at()).status).toBe("refused");
  });

  it("gives back only the rules named", async () => {
    const { limits } = setup();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await limits.reserve([
        { rule: "window", key: "w" },
        { rule: "token", key: "t" },
      ]);
    }
    const third = await limits.reserve([
      { rule: "window", key: "w" },
      { rule: "token", key: "t" },
    ]);
    if (third.status !== "admitted") throw new Error("not admitted");

    await limits.release(third.reservation, { rules: ["token"] });

    expect((await limits.reserve([{ rule: "window", key: "w" }])).status).toBe(
      "refused"
    );
  });

  it("lifts the wait a released count set: 19 failures and a released success leave no wait", async () => {
    const { limits } = setup();
    const signIn = () =>
      limits.reserve([{ rule: "signin", key: "c", count: "always" }]);
    for (let attempt = 0; attempt < 19; attempt += 1) await signIn();
    const success = await signIn();
    if (success.status !== "admitted") throw new Error("not admitted");

    await limits.release(success.reservation);

    expect((await signIn()).status).toBe("admitted");
  });

  it("never lifts a wait set by a later attempt, or one in force before the released count", async () => {
    const { limits, time } = setup();
    const at = () =>
      limits.reserve([{ rule: "backoff", key: "k", count: "always" }]);
    const first = await at();
    await at(); // sets the 1 s wait
    if (first.status !== "admitted") throw new Error("not admitted");
    // The first count set no wait: releasing it leaves the wait in force.
    await limits.release(first.reservation);
    expect(await at()).toMatchObject({ status: "refused" });

    time.advance(10 * SECOND);
    const setter = await at(); // with room: sets a new wait
    if (setter.status !== "admitted") throw new Error("not admitted");
    time.advance(10 * SECOND);
    await at(); // a later attempt with room sets its own wait
    await limits.release(setter.reservation);
    expect(await at()).toMatchObject({ status: "refused" });
  });

  it("keeps the wait a released count set when another attempt was counted after it", async () => {
    const { limits } = setup();
    const signIn = () =>
      limits.reserve([{ rule: "signin", key: "c", count: "always" }]);
    for (let attempt = 0; attempt < 19; attempt += 1) await signIn();
    const success = await signIn(); // the 20th: sets the wait
    if (success.status !== "admitted") throw new Error("not admitted");
    await signIn(); // the 21st, counted during the wait

    await limits.release(success.reservation);

    // 20 attempts still counted: had the success never counted, the 21st
    // would have set a wait of its own.
    expect((await signIn()).status).toBe("refused");
  });

  it("lifts the wait once a later count, released first, no longer stands", async () => {
    const { limits } = setup();
    const signIn = (enforce = true) =>
      limits.reserve([{ rule: "signin", key: "c", count: "always", enforce }]);
    for (let attempt = 0; attempt < 19; attempt += 1) await signIn();
    const earlier = await signIn(); // the 20th: sets the wait
    const later = await signIn(false); // admitted unenforced, counted during it
    if (earlier.status !== "admitted" || later.status !== "admitted") {
      throw new Error("not admitted");
    }

    // Both succeed; the later one is given back first.
    await limits.release(later.reservation);
    await limits.release(earlier.reservation);

    // Back to 19 counted, as if neither attempt had counted: no wait.
    expect((await signIn()).status).toBe("admitted");
  });

  it("forgets a key's count on reset", async () => {
    const { limits } = setup();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await limits.reserve([{ rule: "window", key: "k" }]);
    }
    await limits.reset({ rule: "window", key: "k" });
    expect((await limits.reserve([{ rule: "window", key: "k" }])).status).toBe(
      "admitted"
    );
  });

  it("reads without counting", async () => {
    const { limits } = setup();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await limits.check([{ rule: "window", key: "k" }]);
    }
    expect((await limits.reserve([{ rule: "window", key: "k" }])).status).toBe(
      "admitted"
    );
  });
});

describe("a rule that changes while its entries live", () => {
  it("starts a window rule's counts again when its windows change, with an expiry the new rule bounds", async () => {
    const { limiter, time, writes } = setup();
    const before = limiter("@test/limits", {
      r: { type: "window", windows: [{ max: 1, perMs: 10 * MINUTE }] },
    });
    await before.reserve([{ rule: "r", key: "k" }]);
    expect((await before.reserve([{ rule: "r", key: "k" }])).status).toBe(
      "refused"
    );

    const after = limiter("@test/limits", {
      r: { type: "window", windows: [{ max: 1, perMs: 20 * MINUTE }] },
    });

    expect((await after.reserve([{ rule: "r", key: "k" }])).status).toBe(
      "admitted"
    );
    const [, written] = writes.at(-1) ?? [];
    // At most the new window and one bucket of it past now.
    expect(written?.expiresAt).toBeLessThanOrEqual(
      time.now() + 20 * MINUTE + Math.ceil((20 * MINUTE) / 32)
    );
  });

  it("starts a backoff rule's count again when its waits change, leaving no wait set under the old ones", async () => {
    const { limiter } = setup();
    const before = limiter("@test/limits", {
      r: { type: "backoff", free: 1, waitsMs: [HOUR], forgetAfterMs: HOUR },
    });
    await before.reserve([{ rule: "r", key: "k" }]); // sets the hour's wait
    expect((await before.reserve([{ rule: "r", key: "k" }])).status).toBe(
      "refused"
    );

    const after = limiter("@test/limits", {
      r: { type: "backoff", free: 1, waitsMs: [MINUTE], forgetAfterMs: HOUR },
    });

    expect((await after.reserve([{ rule: "r", key: "k" }])).status).toBe(
      "admitted"
    );
  });
});

describe("giving back however many reservations are outstanding", () => {
  it("gives back the first of 40 admitted reservations on a window", async () => {
    const { limiter } = setup();
    const limits = limiter("@test/limits", {
      r: { type: "window", windows: [{ max: 100, perMs: HOUR }] },
    });
    const first = await limits.reserve([{ rule: "r", key: "k" }]);
    if (first.status !== "admitted") throw new Error("not admitted");
    for (let attempt = 1; attempt < 40; attempt += 1) {
      await limits.reserve([{ rule: "r", key: "k" }]);
    }

    await limits.release(first.reservation);

    let admitted = 0;
    while (
      (await limits.reserve([{ rule: "r", key: "k" }])).status === "admitted"
    ) {
      admitted += 1;
    }
    // 39 still counted of 100: 61 more fit.
    expect(admitted).toBe(61);
  });

  it("gives back the first of 40 admitted reservations on a backoff count", async () => {
    const { limiter } = setup();
    const limits = limiter("@test/limits", {
      r: { type: "backoff", free: 40, waitsMs: [], forgetAfterMs: HOUR },
    });
    const first = await limits.reserve([{ rule: "r", key: "k" }]);
    if (first.status !== "admitted") throw new Error("not admitted");
    for (let attempt = 1; attempt < 40; attempt += 1) {
      await limits.reserve([{ rule: "r", key: "k" }]);
    }
    expect((await limits.reserve([{ rule: "r", key: "k" }])).status).toBe(
      "refused"
    );

    await limits.release(first.reservation);

    expect((await limits.reserve([{ rule: "r", key: "k" }])).status).toBe(
      "admitted"
    );
  });

  it("gives back once when a release whose answer was lost is retried", async () => {
    const memory = createMemoryLimitStore();
    let loseNextAnswer = false;
    const store: LimitStore = {
      shared: true,
      update: async (keys, apply) => {
        const result = await memory.update(keys, apply);
        if (loseNextAnswer) {
          loseNextAnswer = false;
          throw limitStoreUnavailable("timeout");
        }
        return result;
      },
      read: keys => memory.read(keys),
      sweep: () => memory.sweep(),
    };
    const { limits } = setup({ store });
    await limits.reserve([{ rule: "window", key: "k" }]);
    const second = await limits.reserve([{ rule: "window", key: "k" }]);
    await limits.reserve([{ rule: "window", key: "k" }]);
    if (second.status !== "admitted") throw new Error("not admitted");

    loseNextAnswer = true;
    expect(await limits.release(second.reservation)).toEqual({
      status: "unavailable",
    });
    expect(await limits.release(second.reservation)).toEqual({
      status: "done",
    });

    // One count given back of three: room for one more, not two.
    expect((await limits.reserve([{ rule: "window", key: "k" }])).status).toBe(
      "admitted"
    );
    expect((await limits.reserve([{ rule: "window", key: "k" }])).status).toBe(
      "refused"
    );
  });
});

describe("the time a counted refusal says to wait", () => {
  it("counts a window's refused attempt in the time it says, so a retry then is admitted", async () => {
    const { limiter, time } = setup();
    const limits = limiter("@test/limits", {
      r: { type: "window", windows: [{ max: 1, perMs: 10 * SECOND }] },
    });
    await limits.reserve([{ rule: "r", key: "k" }]);
    time.advance(9 * SECOND);
    const refused = await limits.reserve([
      { rule: "r", key: "k", count: "always" },
    ]);
    if (refused.status !== "refused") throw new Error("not refused");

    time.advance(refused.retryAfterMs);

    expect((await limits.reserve([{ rule: "r", key: "k" }])).status).toBe(
      "admitted"
    );
  });

  it("counts a backoff refusal with no waits in the time it says, so a retry then is admitted", async () => {
    const { limiter, time } = setup();
    const limits = limiter("@test/limits", {
      r: { type: "backoff", free: 1, waitsMs: [], forgetAfterMs: MINUTE },
    });
    await limits.reserve([{ rule: "r", key: "k" }]);
    time.advance(30 * SECOND);
    const refused = await limits.reserve([
      { rule: "r", key: "k", count: "always" },
    ]);
    if (refused.status !== "refused") throw new Error("not refused");

    time.advance(refused.retryAfterMs);

    expect((await limits.reserve([{ rule: "r", key: "k" }])).status).toBe(
      "admitted"
    );
  });
});

describe("an entry that holds nothing", () => {
  it("is removed once its only backoff count is given back", async () => {
    const { limits, writes } = setup();
    const success = await limits.reserve([{ rule: "signin", key: "c" }]);
    if (success.status !== "admitted") throw new Error("not admitted");

    await limits.release(success.reservation);

    expect(writes.at(-1)?.[1]).toBeNull();
  });

  it("is removed once its only window count is given back", async () => {
    const { limits, writes } = setup();
    const only = await limits.reserve([{ rule: "window", key: "k" }]);
    if (only.status !== "admitted") throw new Error("not admitted");

    await limits.release(only.reservation);

    expect(writes.at(-1)?.[1]).toBeNull();
  });
});

describe("keys and transactions", () => {
  it("refuses to reserve, release or reset while the calling flow has a transaction open", async () => {
    let open = false;
    const { limits } = setup({ transactionOpen: () => open });
    const admitted = await limits.reserve([{ rule: "window", key: "k" }]);
    if (admitted.status !== "admitted") throw new Error("not admitted");
    open = true;

    await expect(
      limits.reserve([{ rule: "window", key: "k" }])
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
    await expect(limits.release(admitted.reservation)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
    await expect(
      limits.reset({ rule: "window", key: "k" })
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("counts two plugins' same rule and key apart, and stores no key as given", async () => {
    const seen: string[] = [];
    const memory = createMemoryLimitStore();
    const store: LimitStore = {
      shared: false,
      update: (keys, apply) => {
        seen.push(...keys);
        return memory.update(keys, apply);
      },
      read: keys => memory.read(keys),
      sweep: () => memory.sweep(),
    };
    const { limiter } = setup({ store });
    const one = limiter("@test/one");
    const two = limiter("@test/two");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await one.reserve([{ rule: "window", key: "alice@example.com" }]);
    }

    expect(
      (await two.reserve([{ rule: "window", key: "alice@example.com" }])).status
    ).toBe("admitted");
    expect(seen.some(key => key.includes("alice@example.com"))).toBe(false);
    expect(new Set(seen).size).toBe(2);
  });
});

describe("clientKey", () => {
  const request = (address: string) =>
    new Request("https://site.test/", {
      headers: { "x-forwarded-for": address },
    });

  it("is the IPv4 address, an IPv6 address's /64, or a mapped address's IPv4", () => {
    const { limits } = setup({ trustProxy: true });
    expect(limits.clientKey(request("203.0.113.7"))).toBe("203.0.113.7");
    // Core's one spelling of a /64, shared with plugin routes' rate limits;
    // another address in the same /64 is the same client.
    expect(limits.clientKey(request("2001:db8:1:2:3:4:5:6"))).toBe(
      "20010db800010002::/64"
    );
    expect(limits.clientKey(request("2001:db8:1:2:ffff::1"))).toBe(
      limits.clientKey(request("2001:db8:1:2:3:4:5:6"))
    );
    expect(limits.clientKey(request("::ffff:203.0.113.7"))).toBe("203.0.113.7");
  });

  it("is null when the address cannot be resolved, as with trustProxy unset", () => {
    const { limits } = setup({ trustProxy: false });
    expect(limits.clientKey(request("203.0.113.7"))).toBeNull();
  });
});

describe("when the store cannot answer", () => {
  /** A store whose calls fail as an unreachable one does. */
  const failing: LimitStore = {
    shared: true,
    update: () => Promise.reject(limitStoreUnavailable("unreachable")),
    read: () => Promise.reject(limitStoreUnavailable("unreachable")),
    sweep: () => Promise.reject(limitStoreUnavailable("unreachable")),
  };

  it("answers every call as unavailable, distinct from admitted and refused, and logs it", async () => {
    const lines: object[] = [];
    setNextlyLogger({
      error: line => lines.push(line),
      warn: line => lines.push(line),
      info: () => undefined,
      debug: () => undefined,
    });
    const { limits } = setup({ store: failing });
    const reservation = {
      id: "r",
      at: 0,
      entries: [{ rule: "window", key: "k", hadRoom: true, counted: true }],
    };

    expect(await limits.reserve([{ rule: "window", key: "k" }])).toEqual({
      status: "unavailable",
    });
    expect(await limits.release(reservation)).toEqual({
      status: "unavailable",
    });
    expect(await limits.reset({ rule: "window", key: "k" })).toEqual({
      status: "unavailable",
    });
    expect(await limits.check([{ rule: "window", key: "k" }])).toEqual({
      status: "unavailable",
    });
    expect(lines).toHaveLength(4);
  });

  it("does not admit when the store counted and then failed to answer", async () => {
    const memory = createMemoryLimitStore();
    const store: LimitStore = {
      shared: true,
      update: async (keys, apply) => {
        await memory.update(keys, apply);
        throw limitStoreUnavailable("timeout");
      },
      read: keys => memory.read(keys),
      sweep: () => memory.sweep(),
    };
    const { limits } = setup({ store });

    expect(await limits.reserve([{ rule: "window", key: "k" }])).toEqual({
      status: "unavailable",
    });
  });

  it("says whether its store is shared, and whether the site runs one instance", () => {
    expect(setup().limits.store).toEqual({
      shared: false,
      singleInstance: false,
    });
    expect(setup({ store: failing }).limits.store.shared).toBe(true);
  });
});
