/**
 * The prompt dispatch a committed durable event offers, without a database:
 * it runs after the response, never in the write; a burst of offers runs at
 * most one dispatch at a time with one more queued; a failure is logged and
 * swallowed, whether it comes from scheduling or from the dispatch.
 *
 * @module domains/plugin-events/__tests__/kick.test
 */
import { AsyncResource } from "node:async_hooks";

import { describe, expect, it, vi } from "vitest";

import {
  currentCallerScope,
  currentRequestCaller,
  currentRouteActor,
  runWithCallerScope,
  runWithRequestCaller,
  runWithRouteActor,
} from "../../../auth/caller-scope";
import { DurableEventsKick } from "../kick";
import { createDurableSubscribers } from "../subscribers";

/** An `after()` that keeps each callback to run when the test says. */
function heldAfter() {
  const callbacks: Array<() => void | Promise<void>> = [];
  return {
    callbacks,
    load: () => (callback: () => void | Promise<void>) => {
      callbacks.push(callback);
    },
    runAll: () => Promise.all(callbacks.splice(0).map(callback => callback())),
  };
}

/** A dispatch each call of which waits until the test releases it. */
function gatedDispatch() {
  const releases: Array<() => void> = [];
  const dispatch = vi.fn(
    () =>
      new Promise<void>(resolve => {
        releases.push(resolve);
      })
  );
  return {
    dispatch,
    releaseNext: async () => {
      // Let the waiting run reach its dispatch before releasing it.
      for (let i = 0; i < 5 && releases.length === 0; i++) {
        await Promise.resolve();
      }
      releases.shift()?.();
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

const base = {
  adapter: () => {
    throw new Error("not used: the dispatch is a stand-in");
  },
  subscribers: () => createDurableSubscribers(),
};

describe("DurableEventsKick", () => {
  it("runs nothing in the offer itself: the dispatch waits for after()", () => {
    const after = heldAfter();
    const dispatch = vi.fn(async () => {});
    const kick = new DurableEventsKick({
      ...base,
      loadAfter: after.load,
      dispatch,
    });
    kick.offer();
    expect(after.callbacks).toHaveLength(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("a burst of offers runs one dispatch at a time, with at most one more queued", async () => {
    const after = heldAfter();
    const gate = gatedDispatch();
    const kick = new DurableEventsKick({
      ...base,
      loadAfter: after.load,
      dispatch: gate.dispatch,
    });
    for (let i = 0; i < 5; i++) kick.offer();
    const running = after.runAll();
    await gate.releaseNext();
    // The four offers made while the first ran asked for one more, not four.
    await gate.releaseNext();
    await gate.releaseNext();
    await running;
    expect(gate.dispatch).toHaveBeenCalledTimes(2);

    // Once idle, the next offer dispatches again.
    kick.offer();
    const again = after.runAll();
    await gate.releaseNext();
    await again;
    expect(gate.dispatch).toHaveBeenCalledTimes(3);
  });

  it("a failing dispatch is logged and swallowed, and the next offer still runs", async () => {
    const after = heldAfter();
    const warn = vi.fn();
    const dispatch = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("the database is down"))
      .mockResolvedValueOnce(undefined);
    const kick = new DurableEventsKick({
      ...base,
      logger: { warn },
      loadAfter: after.load,
      dispatch,
    });
    kick.offer();
    await expect(after.runAll()).resolves.toBeDefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("the scheduled dispatch"),
      { error: "the database is down" }
    );
    kick.offer();
    await after.runAll();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("an offer where after() cannot be used neither throws nor dispatches", () => {
    const dispatch = vi.fn(async () => {});
    const outsideRequest = new DurableEventsKick({
      ...base,
      loadAfter: () => () => {
        throw new Error("`after` was called outside a request scope");
      },
      dispatch,
    });
    expect(() => outsideRequest.offer()).not.toThrow();
    const noNext = new DurableEventsKick({
      ...base,
      loadAfter: () => null,
      dispatch,
    });
    expect(() => noNext.offer()).not.toThrow();
    const loaderThrows = new DurableEventsKick({
      ...base,
      loadAfter: () => {
        throw new Error("next is broken");
      },
      dispatch,
    });
    expect(() => loaderThrows.offer()).not.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("runs the pass detached from the request that emitted, as the scheduled dispatch runs", async () => {
    // Next's after() runs its callback in the context it was registered
    // from: the emitting request's, with its caller, scope and route actor.
    const callbacks: Array<() => void | Promise<void>> = [];
    const loadAfter = () => (callback: () => void | Promise<void>) => {
      callbacks.push(AsyncResource.bind(callback));
    };
    const seen: unknown[] = [];
    const dispatch = vi.fn(async () => {
      seen.push({
        scope: currentCallerScope(),
        caller: currentRequestCaller(),
        actor: currentRouteActor(),
      });
    });
    const kick = new DurableEventsKick({ ...base, loadAfter, dispatch });
    runWithCallerScope({ actorType: "apiKey", permissions: [] }, () =>
      runWithRequestCaller(
        { userId: "u1", actor: { type: "user", id: "u1" } },
        () =>
          runWithRouteActor(
            { userId: "u1", actor: { type: "apiKey", id: "key-1" } },
            () => kick.offer()
          )
      )
    );
    await Promise.all(callbacks.map(callback => callback()));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      { scope: undefined, caller: undefined, actor: undefined },
    ]);
  });
});
