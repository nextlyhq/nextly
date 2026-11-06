/**
 * The canvas's read of its binding sources: refused for a source the caller
 * may not read, before anything is read; a Single they may not read is left
 * out before the read; and a body no canvas could build is refused at the
 * boundary.
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
});

describe("the canvas's binding sources", () => {
  it("refuses a source the caller may not read, reading nothing", async () => {
    const read = vi.fn(async () => ANSWER);
    await expect(
      readCanvasBindings(request(), { mayRead: async () => false, read })
    ).rejects.toSatisfy(error => NextlyError.isCode(error, "FORBIDDEN"));
    expect(read).not.toHaveBeenCalled();
  });

  it("leaves out, before the read, a Single the caller may not read", async () => {
    const read = vi.fn(async () => ANSWER);
    await readCanvasBindings(
      request({
        home: { fields: ["headline"], follows: {} },
        payroll: { fields: ["total"], follows: {} },
      }),
      { mayRead: async slug => slug !== "payroll", read }
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(Object.keys(read.mock.calls[0]?.[0].demand.singles ?? {})).toEqual([
      "home",
    ]);
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

  it("refuses a body no canvas could build, before the caller is asked", async () => {
    const can = vi.fn(async () => true);
    const ctx = { caller: { can } } as unknown as PluginRouteContext;
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
    ]) {
      await expect(
        canvasBindingsRoute().handler(post(body), ctx)
      ).rejects.toSatisfy(error =>
        NextlyError.isCode(error, "VALIDATION_ERROR")
      );
    }
    expect(can).not.toHaveBeenCalled();
  });
});
