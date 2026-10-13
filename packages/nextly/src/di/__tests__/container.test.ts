import { describe, expect, it } from "vitest";

import { Container } from "../container";

describe("Container.detach", () => {
  it("moves every registration out, leaving the container empty", () => {
    const original = new Container();
    original.registerSingleton("adapter", () => ({ connection: 1 }));

    const detached = original.detach();

    expect(original.has("adapter")).toBe(false);
    expect(() => original.get("adapter")).toThrow();
    expect(detached.get("adapter")).toEqual({ connection: 1 });
  });

  it("hands back the instance already built, not a second one", () => {
    // A teardown must close the connection the plugin opened, not a new one.
    const original = new Container();
    let built = 0;
    original.registerSingleton("adapter", () => ({ connection: ++built }));
    const before = original.get("adapter");

    const detached = original.detach();

    expect(detached.get("adapter")).toBe(before);
    expect(built).toBe(1);
  });

  it("caches a singleton first built after the move in the detached container", () => {
    // A factory that wrote to the container it was registered in would put
    // the instance back into the emptied one, where the next registration's
    // own would then collide with it.
    const original = new Container();
    original.registerSingleton("logger", () => ({ id: "old" }));
    const detached = original.detach();

    const first = detached.get("logger");
    original.registerSingleton("logger", () => ({ id: "new" }));

    expect(detached.get("logger")).toBe(first);
    expect(original.get("logger")).toEqual({ id: "new" });
  });
});

describe("Container.restore", () => {
  it("puts back what detach moved out, the same instances", () => {
    const original = new Container();
    original.registerSingleton("adapter", () => ({ connection: 1 }));
    const before = original.get("adapter");
    const detached = original.detach();

    original.restore(detached);

    expect(original.get("adapter")).toBe(before);
  });

  it("leaves a name registered since with its own registration", () => {
    const original = new Container();
    original.registerSingleton("logger", () => ({ id: "old" }));
    const detached = original.detach();
    original.registerSingleton("logger", () => ({ id: "new" }));

    original.restore(detached);

    expect(original.get("logger")).toEqual({ id: "new" });
  });
});

describe("Container.withdraw", () => {
  it("takes out what restore put back", () => {
    const original = new Container();
    original.registerSingleton("adapter", () => ({ connection: 1 }));
    const detached = original.detach();
    original.restore(detached);

    original.withdraw(detached);

    expect(original.has("adapter")).toBe(false);
  });

  it("leaves a service registered since the detach, under a name of its own", () => {
    // Registered by whoever cleared the container, for the registration
    // that follows the teardown to find.
    const original = new Container();
    original.registerSingleton("adapter", () => ({ connection: 1 }));
    const detached = original.detach();
    original.registerSingleton("custom", () => ({ mine: true }));
    original.restore(detached);

    original.withdraw(detached);

    expect(original.get("custom")).toEqual({ mine: true });
  });

  it("leaves a service registered over a restored one", () => {
    const original = new Container();
    original.registerSingleton("logger", () => ({ id: "old" }));
    const detached = original.detach();
    original.restore(detached);
    original.registerSingleton("logger", () => ({ id: "new" }));

    original.withdraw(detached);

    expect(original.get("logger")).toEqual({ id: "new" });
  });
});
