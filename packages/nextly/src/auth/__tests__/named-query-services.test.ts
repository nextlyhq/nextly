/**
 * Inside a page builder named query's frame, the services plugins contribute
 * refuse to run, as the Direct API does: a query reads only through the
 * reader it is handed, and a service reaching data through its own plugin
 * context would read past it, undeclared, uncounted and untagged. Outside
 * the frame, and through the frame's own door, nothing changes.
 */
import { describe, expect, it } from "vitest";

import {
  buildPluginServicesNamespace,
  registerPluginService,
} from "../../plugins/services/plugin-services-registry";
import { openNamedQueryFrame } from "../named-query-scope";

const PLUGIN = "@test/named-query-services";

class Store {
  readonly #rows = ["SENTINEL"];
  read(): string[] {
    return this.#rows;
  }
}

registerPluginService(PLUGIN, "store", () => ({
  read: () => ["SENTINEL"],
  nested: { read: () => ["SENTINEL"] },
}));
registerPluginService(PLUGIN, "classy", () => new Store());

/** The reason a refusal logs, or the value when the call went through. */
function outcome(call: () => unknown): unknown {
  try {
    return call();
  } catch (error) {
    return (error as { logContext?: { reason?: unknown } }).logContext?.reason;
  }
}

describe("plugin services inside a named query's frame", () => {
  const services = () =>
    buildPluginServicesNamespace()[PLUGIN] as Record<
      string,
      { read: () => string[]; nested?: { read: () => string[] } }
    >;

  it("answer outside the frame as they always did, a class's private state included", () => {
    expect(services().store?.read()).toEqual(["SENTINEL"]);
    expect(services().store?.nested?.read()).toEqual(["SENTINEL"]);
    expect(services().classy?.read()).toEqual(["SENTINEL"]);
  });

  it("refuse every method inside the frame, however deep", () => {
    // Resolved outside the frame first, so the refusal tested is the
    // method's own.
    const store = services().store;
    const classy = services().classy;
    const frame = openNamedQueryFrame("notes.all");
    for (const call of [
      () => store?.read(),
      () => store?.nested?.read(),
      () => classy?.read(),
    ]) {
      expect(outcome(() => frame.run(call))).toBe("named-query-trusted-read");
    }
    for (const call of [
      () => services().store?.read(),
      () => services().store?.nested?.read(),
      () => services().classy?.read(),
    ]) {
      expect(outcome(() => frame.run(call))).toBe("named-query-trusted-read");
    }
  });

  it("refuse a method taken outside the frame and called inside it", () => {
    const read = services().store?.read;
    const frame = openNamedQueryFrame("notes.all");
    expect(outcome(() => frame.run(() => read?.()))).toBe(
      "named-query-trusted-read"
    );
  });

  it("are not even resolved inside the frame, so a factory never runs there", () => {
    let built = 0;
    registerPluginService(PLUGIN, "lazy", () => {
      built += 1;
      return { read: () => ["SENTINEL"] };
    });
    const frame = openNamedQueryFrame("notes.all");
    // First reached inside the frame: refused before its factory runs.
    expect(outcome(() => frame.run(() => services().lazy))).toBe(
      "named-query-trusted-read"
    );
    expect(built).toBe(0);
    // Reached outside it, it resolves as it always did.
    expect(services().lazy?.read()).toEqual(["SENTINEL"]);
    expect(built).toBe(1);
  });

  it("answer through the frame's own door", () => {
    const frame = openNamedQueryFrame("notes.all");
    expect(frame.run(() => frame.read(() => services().store?.read()))).toEqual(
      ["SENTINEL"]
    );
  });
});
