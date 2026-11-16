/**
 * The canvas's read of its binding sources: answered by the editor reader as
 * the caller, core's gate the only door; and a body no canvas could build is
 * refused at the boundary.
 */
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  CANVAS_BINDINGS_ROUTE_PATH,
  demandFromWire,
  demandToWire,
  type CanvasBindingsRequest,
} from "./canvas-bindings-contract";
import {
  canvasBindingsRoute,
  readCanvasBindings,
} from "./canvas-bindings-route";

const ANSWER = { singles: [], shapes: [] };

const request = (
  singles: CanvasBindingsRequest["demand"]["singles"] = {}
): CanvasBindingsRequest => ({
  source: { kind: "collection", slug: "posts", id: "p1" },
  demand: {
    entry: { fields: ["title"], follows: {} },
    singles,
    site: false,
    formatsDates: false,
  },
  lists: [],
});

describe("the canvas's binding sources", () => {
  it("answers the ask with the sources read as the caller", async () => {
    // Core's gate, in the read, is the only door: a source the caller may
    // not read reads as nothing there, and its bindings show fallbacks.
    const read = vi.fn(async () => ANSWER);
    const ask = request({ home: { fields: ["headline"], follows: {} } });
    await expect(readCanvasBindings(ask, { read })).resolves.toBe(ANSWER);
    expect(read).toHaveBeenCalledWith(ask);
  });

  it("carries what the bindings read over JSON and back", () => {
    const demand = {
      any: true,
      entry: {
        fields: ["title", "author"],
        follows: new Map([["author", ["name"]]]),
      },
      singles: new Map([
        ["home", { fields: ["headline"], follows: new Map() }],
      ]),
      site: true,
      formatsDates: true,
    };
    const back = demandFromWire(
      JSON.parse(JSON.stringify(demandToWire(demand)))
    );
    expect(back.entry?.fields).toEqual(["title", "author"]);
    expect([...(back.entry?.follows ?? new Map()).entries()]).toEqual([
      ["author", ["name"]],
    ]);
    expect([...back.singles.keys()]).toEqual(["home"]);
    expect(back.site).toBe(true);
    expect(back.formatsDates).toBe(true);
  });

  it("is declared authenticated and never stored", () => {
    const route = canvasBindingsRoute();
    expect(route).not.toHaveProperty("public");
    expect(route.noStore).toBe(true);
  });

  it("refuses a body no canvas could build, before anything is read", async () => {
    const ctx = { caller: null } as unknown as PluginRouteContext;
    const post = (body: unknown) =>
      new Request(`http://nextly.test/x${CANVAS_BINDINGS_ROUTE_PATH}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    const valid = request();
    for (const body of [
      { ...valid, source: { ...valid.source, slug: "posts; drop" } },
      {
        ...valid,
        demand: { ...valid.demand, entry: { fields: ["a.b"], follows: {} } },
      },
      { ...valid, demand: { ...valid.demand, extra: true } },
      { ...valid, source: { ...valid.source, kind: "page" } },
      // Each list within its own cap, but too many lookups in all: 150
      // Singles each following a relation, beside the entry.
      request(
        Object.fromEntries(
          Array.from({ length: 150 }, (_, index) => [
            `single_${String(index)}`,
            { fields: ["title"], follows: { author: ["name"] } },
          ])
        )
      ),
      { ...valid, lists: ["posts; drop"] },
      // An empty projection would read the whole entry, every field with it.
      {
        ...valid,
        demand: { ...valid.demand, entry: { fields: [], follows: {} } },
      },
      {
        ...valid,
        demand: {
          ...valid.demand,
          entry: { fields: ["title"], follows: { author: [] } },
        },
      },
    ]) {
      await expect(
        canvasBindingsRoute().handler(post(body), ctx)
      ).rejects.toSatisfy(error =>
        NextlyError.isCode(error, "VALIDATION_ERROR")
      );
    }
  });
});
