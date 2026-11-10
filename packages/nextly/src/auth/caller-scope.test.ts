/**
 * The authenticated caller of a REST request, as request context carries it:
 * present for the dispatch that set it, and nowhere else.
 */
import { describe, expect, it } from "vitest";

import {
  currentCallerScope,
  currentRequestCaller,
  currentRouteActor,
  runDetachedFromRequest,
  runWithCallerScope,
  runWithRequestCaller,
  runWithRouteActor,
  type RequestCaller,
  type RouteActor,
} from "./caller-scope";

const ada: RequestCaller = {
  userId: "u1",
  name: "Ada",
  actor: { type: "user", id: "u1" },
  roles: ["editor"],
};
const bob: RequestCaller = { userId: "u2", actor: { type: "user", id: "u2" } };

describe("the request caller", () => {
  it("is set inside the dispatch that set it and absent outside it", async () => {
    expect(currentRequestCaller()).toBeUndefined();
    await runWithRequestCaller(ada, async () => {
      await Promise.resolve();
      // Still there after an await: it follows the request, not the tick.
      expect(currentRequestCaller()).toBe(ada);
    });
    expect(currentRequestCaller()).toBeUndefined();
  });

  it("never lends one request's caller to another running at the same time", async () => {
    const seen = await Promise.all(
      [ada, bob].map(caller =>
        runWithRequestCaller(caller, async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return currentRequestCaller()?.userId;
        })
      )
    );
    expect(seen).toEqual(["u1", "u2"]);
  });

  it("gives a request handled inside another its own caller, or none", async () => {
    // A nested dispatch with nobody authenticated is anonymous, not the outer
    // request's caller.
    await runWithRequestCaller(ada, () =>
      runWithRequestCaller(undefined, () => {
        expect(currentRequestCaller()).toBeUndefined();
      })
    );
    await runWithRequestCaller(ada, () =>
      runWithRequestCaller(bob, () => {
        expect(currentRequestCaller()).toBe(bob);
      })
    );
  });

  it("is dropped, with the pinned scope, by work detached from the request", async () => {
    // Detached work, a scheduled job's run or a check of a named identity,
    // must not act as whoever happened to send the request around it.
    await runWithCallerScope({ actorType: "apiKey", permissions: [] }, () =>
      runWithRequestCaller(ada, () =>
        runDetachedFromRequest(() => {
          expect(currentRequestCaller()).toBeUndefined();
          expect(currentCallerScope()).toBeUndefined();
        })
      )
    );
  });
});

describe("a plugin route request's actor", () => {
  const key: RouteActor = {
    userId: "u1",
    actor: { type: "apiKey", id: "key-1" },
  };

  it("is set inside the request that set it, and pins no REST caller", async () => {
    expect(currentRouteActor()).toBeUndefined();
    await runWithRouteActor(key, async () => {
      await Promise.resolve();
      expect(currentRouteActor()).toBe(key);
      // Attribution only: nothing a service reads as a gate having run.
      expect(currentRequestCaller()).toBeUndefined();
    });
    expect(currentRouteActor()).toBeUndefined();
  });

  it("gives a request served inside another its own actor, or none", () => {
    runWithRouteActor(key, () => {
      runWithRouteActor(undefined, () => {
        expect(currentRouteActor()).toBeUndefined();
      });
      expect(currentRouteActor()).toBe(key);
    });
  });

  it("is dropped by work detached from the request", () => {
    runWithRouteActor(key, () => {
      runDetachedFromRequest(() => {
        expect(currentRouteActor()).toBeUndefined();
      });
    });
  });
});
