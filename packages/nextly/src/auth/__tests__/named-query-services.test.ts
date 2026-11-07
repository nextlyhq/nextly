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

  it("run no getter inside the frame, read as a property or through its descriptor", () => {
    let evaluated = 0;
    registerPluginService(PLUGIN, "withGetter", () => ({
      get count() {
        evaluated += 1;
        return 7;
      },
    }));
    // Resolved outside the frame, as a query's module might capture it.
    const service = services().withGetter as unknown as { count: number };
    const frame = openNamedQueryFrame("notes.all");
    expect(outcome(() => frame.run(() => service.count))).toBe(
      "named-query-trusted-read"
    );
    expect(
      outcome(() =>
        frame.run(() => Object.getOwnPropertyDescriptor(service, "count"))
      )
    ).toBe("named-query-trusted-read");
    expect(evaluated).toBe(0);
    // Outside the frame the getter runs as it always did.
    expect(service.count).toBe(7);
    expect(evaluated).toBe(1);
  });

  it("guard a handle a service method hands out, kept outside the frame and used in it", async () => {
    class Repository {
      readonly #rows = ["SENTINEL"];
      read(): string[] {
        return this.#rows;
      }
    }
    registerPluginService(PLUGIN, "factory", () => ({
      repository: () => new Repository(),
      reader: () => () => ["SENTINEL"],
      later: () => Promise.resolve(new Repository()),
      data: () => ({ rows: ["plain"] }),
    }));
    const service = services().factory as unknown as {
      repository: () => Repository;
      reader: () => () => string[];
      later: () => Promise<Repository>;
      data: () => { rows: string[] };
    };
    // Taken outside the frame, as a query's module might keep them.
    const repository = service.repository();
    const reader = service.reader();
    const later = await service.later();
    const frame = openNamedQueryFrame("notes.all");
    for (const call of [
      () => repository.read(),
      () => reader(),
      () => later.read(),
    ]) {
      expect(outcome(() => frame.run(call))).toBe("named-query-trusted-read");
    }
    // Outside the frame each works as it always did, a class's private
    // state included, and plain data passes through as it is.
    expect(repository.read()).toEqual(["SENTINEL"]);
    expect(reader()).toEqual(["SENTINEL"]);
    expect(later.read()).toEqual(["SENTINEL"]);
    const data = service.data();
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
    expect(data).toEqual({ rows: ["plain"] });
  });

  it("guard a handle held inside plain data a service method returns", () => {
    class Repository {
      readonly #rows = ["SENTINEL"];
      read(): string[] {
        return this.#rows;
      }
    }
    registerPluginService(PLUGIN, "nested", () => ({
      open: () => ({
        repository: new Repository(),
        read: () => ["SENTINEL"],
        deep: { list: [{ read: () => ["SENTINEL"] }] },
        rows: ["plain", "rows"],
      }),
    }));
    const service = services().nested as unknown as {
      open: () => {
        repository: Repository;
        read: () => string[];
        deep: { list: { read: () => string[] }[] };
        rows: string[];
      };
    };
    // Taken outside the frame, as a query's module might keep it.
    const opened = service.open();
    const frame = openNamedQueryFrame("notes.all");
    for (const call of [
      () => opened.repository.read(),
      () => opened.read(),
      () => opened.deep.list[0]?.read(),
    ]) {
      expect(outcome(() => frame.run(call))).toBe("named-query-trusted-read");
    }
    // Plain data inside it stays usable inside the frame.
    expect(frame.run(() => opened.rows.map(row => row.toUpperCase()))).toEqual([
      "PLAIN",
      "ROWS",
    ]);
    // Outside the frame every handle works as it always did.
    expect(opened.repository.read()).toEqual(["SENTINEL"]);
    expect(opened.read()).toEqual(["SENTINEL"]);
    expect(opened.deep.list[0]?.read()).toEqual(["SENTINEL"]);
  });

  it("read a frozen service and frozen data as they are outside the frame, and refuse them inside", () => {
    registerPluginService(PLUGIN, "frozen", () =>
      Object.freeze({
        read: () => ["SENTINEL"],
        open: () => Object.freeze({ read: () => ["SENTINEL"], count: 2 }),
      })
    );
    const service = services().frozen as unknown as {
      read: () => string[];
      open: () => { read: () => string[]; count: number };
    };
    // Outside the frame: no proxy invariant is broken, and all works.
    expect(service.read()).toEqual(["SENTINEL"]);
    const opened = service.open();
    expect(opened.read()).toEqual(["SENTINEL"]);
    expect(opened.count).toBe(2);
    // Inside it: the frozen method, and a handle in frozen data, refuse.
    const frame = openNamedQueryFrame("notes.all");
    expect(outcome(() => frame.run(() => service.read()))).toBe(
      "named-query-trusted-read"
    );
    expect(outcome(() => frame.run(() => opened.read()))).toBe(
      "named-query-trusted-read"
    );
    // Plain values in frozen data still read.
    expect(frame.run(() => opened.count)).toBe(2);
  });

  it("answer through the frame's own door", () => {
    const frame = openNamedQueryFrame("notes.all");
    expect(frame.run(() => frame.read(() => services().store?.read()))).toEqual(
      ["SENTINEL"]
    );
  });
});
