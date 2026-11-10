/**
 * Inside a page builder named query's frame, resolving a service a plugin
 * contributes is refused before its factory runs, as the Direct API is: a
 * query reads only through the reader it is handed. Nothing a plugin service
 * is or returns is ever wrapped: outside the frame, and resolved before one,
 * a service and everything it hands out is the plugin's own object, frozen,
 * written to, sealed and called exactly as the plugin made it.
 */
import { describe, expect, it } from "vitest";

import {
  buildPluginServicesNamespace,
  registerPluginService,
} from "../../plugins/services/plugin-services-registry";
import { openNamedQueryFrame } from "../named-query-scope";

const PLUGIN = "@test/named-query-services";

/** The reason a refusal logs, or the value when the call went through. */
function outcome(call: () => unknown): unknown {
  try {
    return call();
  } catch (error) {
    return (error as { logContext?: { reason?: unknown } }).logContext?.reason;
  }
}

const services = () =>
  buildPluginServicesNamespace()[PLUGIN] as Record<string, unknown>;

describe("plugin services and a named query's frame", () => {
  it("refuses resolving a service inside the frame, before its factory runs, and resolves it outside", () => {
    let built = 0;
    registerPluginService(PLUGIN, "lazy", () => {
      built += 1;
      return { read: () => ["SENTINEL"] };
    });
    const frame = openNamedQueryFrame("notes.all");
    expect(outcome(() => frame.run(() => services().lazy))).toBe(
      "named-query-trusted-read"
    );
    expect(built).toBe(0);
    const service = services().lazy as { read: () => string[] };
    expect(service.read()).toEqual(["SENTINEL"]);
    expect(built).toBe(1);
  });

  it("hands out the plugin's own service and results, untouched", () => {
    class Repository {
      readonly #rows = ["SENTINEL"];
      read(): string[] {
        return this.#rows;
      }
    }
    const repository = new Repository();
    const data = {
      rows: ["a"],
      read() {
        return this.rows;
      },
    };
    const own = {
      setting: "before",
      repository: () => repository,
      data: () => data,
    };
    registerPluginService(PLUGIN, "own", () => own);
    const service = services().own as typeof own;
    // The very objects the plugin made.
    expect(service).toBe(own);
    expect(service.repository()).toBe(repository);
    expect(service.data()).toBe(data);
    // Each behaves natively: private state, `this`, writes, freeze, seal.
    expect(service.repository().read()).toEqual(["SENTINEL"]);
    expect(service.data().read()).toEqual(["a"]);
    service.setting = "after";
    expect(own.setting).toBe("after");
    expect(Object.isSealed(Object.seal(service.data()))).toBe(true);
    expect(Object.isFrozen(Object.freeze(service))).toBe(true);
  });

  it("works normally when frozen, outside the frame and resolved before one", async () => {
    const frozen = Object.freeze({
      read: () => ["SENTINEL"],
      open: () => Object.freeze({ count: 2 }),
    });
    registerPluginService(PLUGIN, "frozen", () => frozen);
    // Outside the frame: read, call, freeze again.
    const service = services().frozen as typeof frozen;
    expect(service).toBe(frozen);
    expect(service.read()).toEqual(["SENTINEL"]);
    expect(service.open().count).toBe(2);
    expect(Object.isFrozen(Object.freeze(service))).toBe(true);
    // Resolved before a frame, it is still the plain frozen object inside
    // it: what the frame refuses is reaching the service, not the object.
    const frame = openNamedQueryFrame("notes.all");
    expect(await frame.run(() => Promise.resolve(service.read()))).toEqual([
      "SENTINEL",
    ]);
  });

  it("answers through the frame's own door", () => {
    registerPluginService(PLUGIN, "door", () => ({ read: () => ["SENTINEL"] }));
    const frame = openNamedQueryFrame("notes.all");
    expect(
      frame.run(() =>
        frame.read(() => (services().door as { read: () => string[] }).read())
      )
    ).toEqual(["SENTINEL"]);
  });
});
