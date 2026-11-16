/**
 * The hold route: the count taken again before anything is held, a grown
 * count answered instead of a hold, and the caller's own read of the
 * component asked first.
 */
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The Direct API handle the route reaches, its read recorded. */
const nextly = vi.hoisted(() => ({ findByID: vi.fn() }));

vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireNextly: () => nextly,
}));

import type { RemovalHold, RemovalHoldStore } from "./removal-hold";
import { REMOVAL_HOLD_ROUTE_PATH } from "./removal-hold-contract";
import { removalHoldRoutes } from "./removal-hold-route";
import type { UsageCount } from "./usage-count";

/** The site's document bounds: small, so a test can pass them. */
const LIMITS = { maxDepth: 12, maxNodes: 5000, maxBytes: 4_096 };

/** A caller who may read and update components, and, unless said, publish. */
function contextFor(
  options: {
    mayPublish?: boolean;
    /** Whether a filter limits the publish right to some entries. */
    publishFiltered?: boolean;
    localized?: boolean;
  } = {}
): PluginRouteContext {
  return {
    self: { collections: {} },
    user: { id: "u1" },
    services: {
      collections: {
        getCollection: async () => ({
          status: true,
          localized: options.localized === true,
        }),
      },
    },
    caller: {
      authMethod: "session",
      can: async (
        action: string,
        _slug: string,
        asked?: { anyEntry?: boolean }
      ) => {
        if (action !== "publish") return true;
        if (options.mayPublish === false) return false;
        // A filtered right answers yes only to the type-level question.
        return options.publishFiltered !== true || asked?.anyEntry === true;
      },
      identity: async () => ({ user: { id: "u1" } }),
    },
  } as unknown as PluginRouteContext;
}

/** The route over a recording store and a fixed count. */
function route(
  count: UsageCount | (() => Promise<UsageCount>),
  options: {
    mayPublish?: boolean;
    publishFiltered?: boolean;
    localized?: boolean;
    /** Whether the hold is still in force once counted; it is unless said. */
    inForce?: boolean;
    /** How long the count takes, on the route's clock. */
    countTakes?: number;
  } = {}
) {
  const ctx = contextFor(options);
  let now = 1_000;
  const renewed: string[] = [];
  const held: { id: string; hold: RemovalHold }[] = [];
  const released: string[] = [];
  const counted: string[] = [];
  /** Every step the route took, in order. */
  const steps: string[] = [];
  const holds: RemovalHoldStore = {
    hold: async (id, hold) => {
      steps.push("hold");
      held.push({ id, hold });
    },
    of: async () => new Map(),
    renew: async (id, token, until) => {
      steps.push("renew");
      renewed.push(`${id} ${token} ${String(until)}`);
      return options.inForce !== false;
    },
    release: async (id, token) => {
      steps.push("release");
      released.push(`${id} ${token ?? "any"}`);
    },
  };
  const [declared] = removalHoldRoutes({
    store: { field: "content" },
    holds: () => holds,
    countPlacements: () => async id => {
      steps.push("count");
      counted.push(id);
      now += options.countTakes ?? 0;
      return typeof count === "function" ? count() : count;
    },
    limits: () => LIMITS,
    clock: () => now,
  });
  const ask = (body: unknown) =>
    declared!.handler(
      new Request(`http://nextly.test${REMOVAL_HOLD_ROUTE_PATH}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      ctx
    );
  return {
    declared: declared!,
    ask,
    held,
    released,
    renewed,
    counted,
    steps,
  };
}

const BODY = {
  id: "hero",
  properties: ["title"],
  slots: [],
  confirmed: 2,
  confirmedComplete: true,
};

describe("asking for a removal's hold", () => {
  beforeEach(() => {
    nextly.findByID.mockReset();
    nextly.findByID.mockResolvedValue({ id: "hero" });
  });

  it("holds the removal when no more documents place it than confirmed", async () => {
    const { ask, held } = route({ documents: 2, complete: true });

    const answer = await (await ask(BODY)).json();

    expect(answer.item).toEqual({
      kind: "held",
      reach: { count: 2, complete: true },
    });
    expect(held).toEqual([
      {
        id: "hero",
        hold: {
          properties: ["title"],
          slots: [],
          confirmed: 2,
          confirmedComplete: true,
          until: 121_000,
          token: expect.any(String),
        },
      },
    ]);
  });

  it("answers the new count, and leaves nothing held, when it has grown", async () => {
    const { ask, steps } = route({ documents: 3, complete: true });

    const answer = await (await ask(BODY)).json();

    expect(answer.item).toEqual({
      kind: "recount",
      reach: { count: 3, complete: true },
    });
    // Held before the count, so no write judged after it slips through, and
    // ended once the count has grown.
    expect(steps).toEqual(["hold", "count", "release"]);
  });

  it("answers a recount when a whole count confirmed is now only a floor", async () => {
    const { ask } = route({ documents: 2, complete: false });

    const answer = await (await ask(BODY)).json();

    expect(answer.item.kind).toBe("recount");
  });

  it("runs its own lease again from when the count ends", async () => {
    const { ask, held, renewed, steps } = route(
      { documents: 2, complete: true },
      { countTakes: 100_000 }
    );

    const answer = await (await ask(BODY)).json();

    expect(answer.item.kind).toBe("held");
    expect(steps).toEqual(["hold", "count", "renew"]);
    // Counted from 101,000, not from 1,000 when the hold was recorded.
    expect(renewed).toEqual([`hero ${held[0]!.hold.token} 221000`]);
  });

  it("answers no hold, ending its own, when that hold ran out while counting", async () => {
    const { ask, held, released } = route(
      { documents: 2, complete: true },
      { inForce: false, countTakes: 130_000 }
    );

    const error = await ask(BODY).catch((refused: unknown) => refused);

    expect(NextlyError.isCode(error, "CONFLICT")).toBe(true);
    expect(released).toEqual([`hero ${held[0]!.hold.token}`]);
  });

  it("refuses a component the caller cannot read before counting it", async () => {
    nextly.findByID.mockRejectedValue(NextlyError.forbidden());
    const { ask, counted } = route({ documents: 0, complete: true });

    const error = await ask(BODY).catch((refused: unknown) => refused);

    expect(NextlyError.isNotFound(error)).toBe(true);
    expect(counted).toEqual([]);
  });

  it("ends only its own hold when the count has grown", async () => {
    const { ask, held, released } = route({ documents: 3, complete: true });

    await ask(BODY);

    expect(released).toEqual([`hero ${held[0]!.hold.token}`]);
  });

  it("ends its hold, and fails, when the count cannot be taken", async () => {
    const { ask, held, released } = route(() =>
      Promise.reject(new Error("index unreadable"))
    );

    const error = await ask(BODY).catch((refused: unknown) => refused);

    expect(error).toBeInstanceOf(Error);
    expect(released).toEqual([`hero ${held[0]!.hold.token}`]);
  });

  it("refuses a caller who may not publish components, holding nothing", async () => {
    const { ask, held, counted } = route(
      { documents: 0, complete: true },
      { mayPublish: false }
    );

    const error = await ask(BODY).catch((refused: unknown) => refused);

    expect(NextlyError.isForbidden(error)).toBe(true);
    expect(held).toEqual([]);
    expect(counted).toEqual([]);
  });

  it("refuses a caller whose publish right a filter limits, holding nothing", async () => {
    const { ask, held, counted } = route(
      { documents: 2, complete: true },
      { publishFiltered: true }
    );

    const error = await ask(BODY).catch((refused: unknown) => refused);

    // Such a right may not cover this component, and the SDK asks nothing
    // about one named entry, so no hold is taken and no "held" is answered.
    expect(NextlyError.isForbidden(error)).toBe(true);
    expect(held).toEqual([]);
    expect(counted).toEqual([]);
  });

  it("holds nothing for a localized store, which retires nothing", async () => {
    const { ask, held } = route(
      { documents: 4, complete: true },
      { localized: true }
    );

    const answer = await (await ask(BODY)).json();

    expect(answer.item.kind).toBe("held");
    expect(held).toEqual([]);
  });

  it("reads the component as the caller", async () => {
    const { ask } = route({ documents: 0, complete: true });

    await ask(BODY);

    expect(nextly.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ id: "hero", overrideAccess: false })
    );
  });

  it("refuses a body that does not name what is removed", async () => {
    const { ask } = route({ documents: 0, complete: true });

    const error = await ask({ id: "hero", confirmed: -1 }).catch(
      (refused: unknown) => refused
    );

    expect(NextlyError.isCode(error, "VALIDATION_ERROR")).toBe(true);
  });

  it("holds a field id exactly as the envelope stores it", async () => {
    const { ask, held } = route({ documents: 2, complete: true });

    await ask({ ...BODY, properties: [" title "] });

    expect(held[0]!.hold.properties).toEqual([" title "]);
  });

  it("bounds a field id only as the document holding it is bounded", async () => {
    const { ask, held } = route({ documents: 2, complete: true });
    // Longer than the 256 every other id here is held to: an envelope may
    // store one.
    const long = "f".repeat(306);

    await ask({ ...BODY, properties: [long] });
    const tooLong = await ask({
      ...BODY,
      properties: ["f".repeat(LIMITS.maxBytes + 1)],
    }).catch((refused: unknown) => refused);

    expect(held[0]!.hold.properties).toEqual([long]);
    expect(NextlyError.isCode(tooLong, "VALIDATION_ERROR")).toBe(true);
  });

  it("accepts a removal of as many fields as an envelope may hold", async () => {
    const { ask, held } = route({ documents: 2, complete: true });
    const many = Array.from({ length: 1000 }, (_, at) => `f${String(at)}`);

    await ask({ ...BODY, properties: many });

    expect(held[0]!.hold.properties).toHaveLength(1000);
  });

  it("is gated on updating the component store", () => {
    const { declared } = route({ documents: 0, complete: true });

    expect(
      declared.requiredPermission({
        collection: (slug: string, action: string) => `${action}-${slug}`,
      } as never)
    ).toBe("update-components");
  });
});
