import { describe, expect, it } from "vitest";

import type { LimitEntry, LimitReservation } from "../core/ports";

import { fakeAccountsCore } from "./fake-core";

const SECOND = 1_000;

function limiter() {
  return fakeAccountsCore({
    rules: {
      tries: { type: "window", windows: [{ max: 2, perMs: 60 * SECOND }] },
      client: { type: "window", windows: [{ max: 1, perMs: 60 * SECOND }] },
      waits: {
        type: "backoff",
        free: 2,
        waitsMs: [SECOND, 5 * SECOND],
        forgetAfterMs: 60 * SECOND,
      },
    },
  });
}

function admitted(result: LimitReservation) {
  if (result.status !== "admitted")
    throw new Error(`expected admitted, got ${result.status}`);
  return result.reservation;
}

describe("the fake limiter's window rule", () => {
  it("admits `max` in the window, refuses the next until the first leaves it", async () => {
    const core = limiter();
    const entry: LimitEntry = { rule: "tries", key: "dana@example.com" };
    admitted(await core.limits.reserve([entry]));
    core.clock.advance(10 * SECOND);
    admitted(await core.limits.reserve([entry]));

    const refused = await core.limits.reserve([entry]);
    expect(refused).toMatchObject({
      status: "refused",
      retryAfterMs: 50 * SECOND,
      refusedBy: ["tries"],
    });

    core.clock.advance(50 * SECOND);
    admitted(await core.limits.reserve([entry]));
  });

  it("gives a released count back once, however often it is released", async () => {
    const core = limiter();
    const entry: LimitEntry = { rule: "tries", key: "dana@example.com" };
    const first = admitted(await core.limits.reserve([entry]));
    admitted(await core.limits.reserve([entry]));

    await core.limits.release(first);
    await core.limits.release(first);
    admitted(await core.limits.reserve([entry]));
    expect((await core.limits.reserve([entry])).status).toBe("refused");
  });
});

describe("the fake limiter's count modes", () => {
  it("counts an unenforced entry without room as nothing and refuses nothing for it", async () => {
    const core = limiter();
    const client: LimitEntry = { rule: "client", key: "203.0.113.9" };
    admitted(await core.limits.reserve([client]));

    const reservation = admitted(
      await core.limits.reserve([
        { rule: "tries", key: "a" },
        { ...client, enforce: false },
      ])
    );
    expect(reservation.entries).toEqual([
      { rule: "tries", key: "a", hadRoom: true, counted: true },
      { rule: "client", key: "203.0.113.9", hadRoom: false, counted: false },
    ]);
  });

  it("counts a unanimous entry only when every entry has room, and an always entry even when refused", async () => {
    const core = limiter();
    const client: LimitEntry = {
      rule: "client",
      key: "203.0.113.9",
      count: "always",
    };
    const address: LimitEntry = {
      rule: "tries",
      key: "dana@example.com",
      count: "unanimous",
    };
    admitted(await core.limits.reserve([address, client]));

    // The client is out of room: refused, the address not counted, the client counted.
    const refused = await core.limits.reserve([address, client]);
    expect(refused).toMatchObject({
      status: "refused",
      refusedBy: ["client"],
      entries: [
        { rule: "tries", hadRoom: true, counted: false },
        { rule: "client", hadRoom: false, counted: true },
      ],
    });
    // The address has one try of its two left: the refusal took none.
    expect(
      await core.limits.check([{ rule: "tries", key: "dana@example.com" }])
    ).toMatchObject({
      status: "ok",
      entries: [{ wouldAdmit: true }],
    });
  });

  it("leaves a unanimous entry uncounted when an unenforced entry lacks room, though admitted", async () => {
    const core = limiter();
    const client: LimitEntry = {
      rule: "client",
      key: "203.0.113.9",
      enforce: false,
      count: "always",
    };
    const address: LimitEntry = {
      rule: "tries",
      key: "dana@example.com",
      enforce: false,
      count: "unanimous",
    };
    admitted(await core.limits.reserve([client]));

    const reservation = admitted(await core.limits.reserve([address, client]));
    expect(reservation.entries).toMatchObject([
      { rule: "tries", hadRoom: true, counted: false },
      { rule: "client", hadRoom: false, counted: true },
    ]);
  });

  it("counts nothing while the store is unavailable", async () => {
    const core = limiter();
    core.limits.available = false;
    expect(await core.limits.reserve([{ rule: "client", key: "x" }])).toEqual({
      status: "unavailable",
    });
    core.limits.available = true;
    admitted(await core.limits.reserve([{ rule: "client", key: "x" }]));
  });
});

describe("the fake limiter's backoff rule", () => {
  it("waits after the free attempts, longer each time, and a reset forgets the count", async () => {
    const core = limiter();
    const entry: LimitEntry = { rule: "waits", key: "dana@example.com" };
    admitted(await core.limits.reserve([entry]));
    admitted(await core.limits.reserve([entry]));
    expect(await core.limits.reserve([entry])).toMatchObject({
      status: "refused",
      retryAfterMs: SECOND,
    });

    core.clock.advance(SECOND);
    admitted(await core.limits.reserve([entry]));
    expect(await core.limits.reserve([entry])).toMatchObject({
      status: "refused",
      retryAfterMs: 5 * SECOND,
    });

    await core.limits.reset(entry);
    admitted(await core.limits.reserve([entry]));
  });

  it("lifts, when a count is given back, a wait only that count set", async () => {
    const core = limiter();
    const entry: LimitEntry = { rule: "waits", key: "dana@example.com" };
    admitted(await core.limits.reserve([entry]));
    const second = admitted(await core.limits.reserve([entry]));

    await core.limits.release(second);
    admitted(await core.limits.reserve([entry]));
    expect((await core.limits.reserve([entry])).status).toBe("refused");
  });

  it("keeps the wait a given-back count set once anything was counted on the entry since", async () => {
    const core = limiter();
    const entry: LimitEntry = { rule: "waits", key: "dana@example.com" };
    admitted(await core.limits.reserve([entry]));
    const second = admitted(await core.limits.reserve([entry]));
    // Counted during the wait the second set, as an "always" entry is.
    expect(
      (await core.limits.reserve([{ ...entry, count: "always" }])).status
    ).toBe("refused");

    await core.limits.release(second);
    expect((await core.limits.reserve([entry])).status).toBe("refused");
  });

  it("never moves the wait in force for an attempt counted without room", async () => {
    const core = limiter();
    const entry: LimitEntry = {
      rule: "waits",
      key: "dana@example.com",
      count: "always",
    };
    admitted(await core.limits.reserve([entry]));
    admitted(await core.limits.reserve([entry]));
    core.clock.advance(SECOND / 2);
    expect(await core.limits.reserve([entry])).toMatchObject({
      status: "refused",
      retryAfterMs: SECOND / 2,
    });
  });

  it("forgets the count once idle past forgetAfterMs", async () => {
    const core = limiter();
    const entry: LimitEntry = { rule: "waits", key: "dana@example.com" };
    admitted(await core.limits.reserve([entry]));
    admitted(await core.limits.reserve([entry]));
    core.clock.advance(60 * SECOND);
    admitted(await core.limits.reserve([entry]));
    admitted(await core.limits.reserve([entry]));
  });
});

describe("the fake limiter's guards", () => {
  it("refuses an undeclared rule, and a declaration out of core's bounds", async () => {
    const core = limiter();
    await expect(
      core.limits.reserve([{ rule: "nope", key: "x" }])
    ).rejects.toThrow(/never declared/);
    expect(() =>
      fakeAccountsCore({
        rules: {
          bad: { type: "window", windows: [{ max: 0, perMs: SECOND }] },
        },
      })
    ).toThrow(/max is outside/);
  });

  it("records when an admitted reservation was counted, and refuses to release one reserve did not admit", async () => {
    const core = limiter();
    const reservation = admitted(
      await core.limits.reserve([{ rule: "tries", key: "a" }])
    );

    expect(reservation.at).toBe(core.clock.now());
    await expect(
      core.limits.release({ ...reservation, at: Number.NaN })
    ).rejects.toThrow(/reserve did not admit/);
    await expect(core.limits.release(reservation)).resolves.toEqual({
      status: "done",
    });
  });

  it("refuses a release reserve did not admit even while the store does not answer, as core does", async () => {
    const core = limiter();
    const reservation = admitted(
      await core.limits.reserve([{ rule: "tries", key: "a" }])
    );
    core.limits.available = false;

    await expect(
      core.limits.release({ ...reservation, at: Number.NaN })
    ).rejects.toThrow(/reserve did not admit/);
    await expect(core.limits.release(reservation)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("gives a count taken before a reset back to nothing, so the new run keeps its counts, as core does", async () => {
    const core = limiter();
    const before = admitted(
      await core.limits.reserve([{ rule: "tries", key: "a" }])
    );
    await core.limits.reset({ rule: "tries", key: "a" });
    for (let n = 0; n < 2; n += 1)
      admitted(await core.limits.reserve([{ rule: "tries", key: "a" }]));

    await core.limits.release(before);
    expect(
      (await core.limits.reserve([{ rule: "tries", key: "a" }])).status
    ).toBe("refused");
  });

  it("names, per entry, the run it was counted in, and refuses a release whose runs do not line up", async () => {
    const core = limiter();
    const reservation = admitted(
      await core.limits.reserve([
        { rule: "tries", key: "a" },
        { rule: "client", key: "c", enforce: false, count: "unanimous" },
        { rule: "client", key: "d", enforce: false },
      ])
    );
    admitted(
      await core.limits.reserve([
        { rule: "client", key: "d", enforce: false, count: "always" },
      ])
    );

    expect(reservation.epochs).toHaveLength(3);
    expect(reservation.epochs.map(epoch => epoch !== "")).toEqual(
      reservation.entries.map(entry => entry.counted)
    );
    await expect(
      core.limits.release({ ...reservation, epochs: [] })
    ).rejects.toThrow(/reserve did not admit/);
  });

  it("reads a client's key in core's forms", () => {
    const { limits } = limiter();
    const from = (address?: string) =>
      limits.clientKey(
        new Request("https://shop.example.com", {
          headers: address ? { "x-forwarded-for": address } : {},
        })
      );

    expect(from("203.0.113.9, 10.0.0.1")).toBe("203.0.113.9");
    expect(from("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(from("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(from("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(from()).toBeNull();
  });
});
