import { describe, expect, it, vi } from "vitest";

import { EventBus, getEventBus } from "./event-bus";

describe("EventBus", () => {
  it("delivers the payload to a subscribed handler", async () => {
    const bus = new EventBus();
    bus.registerDeclaredEvents(["thing.happened"]);
    const received: unknown[] = [];
    bus.on<{ id: string }>("thing.happened", e => {
      received.push(e.payload);
    });

    bus.emit("thing.happened", { id: "a" });
    await bus.settle();

    expect(received).toEqual([{ id: "a" }]);
  });

  it("isolates a throwing handler — other handlers still run and emit never throws", async () => {
    const bus = new EventBus();
    bus.setLogger({ error: vi.fn(), warn: vi.fn() });
    bus.registerDeclaredEvents(["thing.happened"]);
    const ran: string[] = [];
    bus.on("thing.happened", () => {
      throw new Error("boom");
    });
    bus.on("thing.happened", () => {
      ran.push("second");
    });

    expect(() => bus.emit("thing.happened", {})).not.toThrow();
    await bus.settle();

    expect(ran).toEqual(["second"]);
  });

  it("isolates a rejected async handler without surfacing the rejection", async () => {
    const bus = new EventBus();
    const logger = { error: vi.fn(), warn: vi.fn() };
    bus.setLogger(logger);
    bus.registerDeclaredEvents(["thing.happened"]);
    bus.on("thing.happened", () => Promise.reject(new Error("async boom")));

    bus.emit("thing.happened", {});
    await expect(bus.settle()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("settle() resolves only after async handlers complete", async () => {
    const bus = new EventBus();
    bus.registerDeclaredEvents(["thing.happened"]);
    let done = false;
    bus.on("thing.happened", async () => {
      await new Promise(r => setTimeout(r, 5));
      done = true;
    });

    bus.emit("thing.happened", {});
    expect(done).toBe(false);
    await bus.settle();
    expect(done).toBe(true);
  });

  it("off() unsubscribes a handler", async () => {
    const bus = new EventBus();
    bus.registerDeclaredEvents(["thing.happened"]);
    const handler = vi.fn();
    bus.on("thing.happened", handler);
    bus.off("thing.happened", handler);

    bus.emit("thing.happened", {});
    await bus.settle();

    expect(handler).not.toHaveBeenCalled();
  });

  it("warns (does not throw) when emitting an undeclared event, but still delivers", async () => {
    const bus = new EventBus();
    const logger = { error: vi.fn(), warn: vi.fn() };
    bus.setLogger(logger);
    const handler = vi.fn();
    bus.on("never.declared", handler);

    expect(() => bus.emit("never.declared", {})).not.toThrow();
    await bus.settle();

    expect(logger.warn).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not warn for reserved built-in event names", async () => {
    const bus = new EventBus();
    const logger = { error: vi.fn(), warn: vi.fn() };
    bus.setLogger(logger);

    bus.emit("plugin.initialized", { name: "x" });
    bus.emit("collection.posts.created", { id: "1" });
    await bus.settle();

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("getEventBus() returns a stable singleton", () => {
    expect(getEventBus()).toBe(getEventBus());
  });
});

describe("EventBus.settleRunning", () => {
  const later = (ms: number) =>
    new Promise<void>(resolve => setTimeout(resolve, ms));

  it("waits for the handlers running now, and answers true", async () => {
    const bus = new EventBus();
    let finished = false;
    bus.on("x", async () => {
      await later(5);
      finished = true;
    });
    bus.emit("x", {});

    expect(await bus.settleRunning(1_000)).toBe(true);
    expect(finished).toBe(true);
  });

  it("does not wait for a handler started after it was asked", async () => {
    // A producer re-emitting from its own handler never lets the bus empty;
    // only the handler running at the call is waited for.
    const bus = new EventBus();
    let producing = true;
    bus.on("tick", async () => {
      await later(1);
      if (producing) bus.emit("tick", {});
    });
    bus.emit("tick", {});

    expect(await bus.settleRunning(1_000)).toBe(true);
    producing = false;
    await bus.settle();
  });

  it("answers false within its time when a handler never settles", async () => {
    const bus = new EventBus();
    bus.on("x", () => new Promise<void>(() => {}));
    bus.emit("x", {});
    const started = Date.now();

    expect(await bus.settleRunning(50)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
