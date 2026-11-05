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

const ctx = {
  self: { collections: {} },
  user: { id: "u1" },
  caller: {
    authMethod: "session",
    can: async () => true,
    identity: async () => ({ user: { id: "u1" } }),
  },
} as unknown as PluginRouteContext;

/** The route over a recording store and a fixed count. */
function route(count: UsageCount) {
  const held: { id: string; hold: RemovalHold }[] = [];
  const released: string[] = [];
  const counted: string[] = [];
  const holds: RemovalHoldStore = {
    hold: async (id, hold) => {
      held.push({ id, hold });
    },
    of: async () => new Map(),
    release: async id => {
      released.push(id);
    },
  };
  const [declared] = removalHoldRoutes({
    store: { field: "content" },
    holds: () => holds,
    countPlacements: () => async id => {
      counted.push(id);
      return count;
    },
    clock: () => 1_000,
  });
  const ask = (body: unknown) =>
    declared!.handler(
      new Request(`http://nextly.test${REMOVAL_HOLD_ROUTE_PATH}`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      ctx
    );
  return { declared: declared!, ask, held, released, counted };
}

const BODY = { id: "hero", properties: ["title"], slots: [], confirmed: 2 };

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
          until: 121_000,
        },
      },
    ]);
  });

  it("answers the new count, and holds nothing, when it has grown", async () => {
    const { ask, held, released } = route({ documents: 3, complete: false });

    const answer = await (await ask(BODY)).json();

    expect(answer.item).toEqual({
      kind: "recount",
      reach: { count: 3, complete: false },
    });
    expect(held).toEqual([]);
    expect(released).toEqual(["hero"]);
  });

  it("refuses a component the caller cannot read before counting it", async () => {
    nextly.findByID.mockRejectedValue(NextlyError.forbidden());
    const { ask, counted } = route({ documents: 0, complete: true });

    const error = await ask(BODY).catch((refused: unknown) => refused);

    expect(NextlyError.isNotFound(error)).toBe(true);
    expect(counted).toEqual([]);
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

  it("is gated on updating the component store", () => {
    const { declared } = route({ documents: 0, complete: true });

    expect(
      declared.requiredPermission({
        collection: (slug: string, action: string) => `${action}-${slug}`,
      } as never)
    ).toBe("update-components");
  });
});
