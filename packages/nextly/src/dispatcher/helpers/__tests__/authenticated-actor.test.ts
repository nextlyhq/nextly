/**
 * Reading the acting identity off the request caller.
 *
 * The actor is persisted into durable event history, so it is read from the
 * caller the route handler authenticated, never from a value a request could
 * supply, and an unauthenticated request has none.
 */
import { describe, expect, it } from "vitest";

import { runWithRequestCaller } from "../../../auth/caller-scope";
import {
  asCaller,
  keyCaller,
  sessionCaller,
} from "../../__tests__/request-caller";
import { readAuthenticatedActor } from "../authenticated-actor";

describe("readAuthenticatedActor", () => {
  it("reads a user actor", () => {
    expect(
      asCaller(sessionCaller({ userId: "usr_1" }), () =>
        readAuthenticatedActor()
      )
    ).toEqual({ type: "user", id: "usr_1" });
  });

  it("reads an apiKey actor, not the user that owns the key", () => {
    expect(
      asCaller(keyCaller("key_1", { userId: "usr_1" }), () =>
        readAuthenticatedActor()
      )
    ).toEqual({ type: "apiKey", id: "key_1" });
  });

  it("returns undefined when the request has no caller", () => {
    expect(asCaller(undefined, () => readAuthenticatedActor())).toBeUndefined();
  });

  it("keeps the actor when it carries only a type", () => {
    expect(
      runWithRequestCaller({ userId: "u1", actor: { type: "system" } }, () =>
        readAuthenticatedActor()
      )
    ).toEqual({ type: "system" });
  });

  it("hands out a copy, so a write cannot rewrite the request's actor", () => {
    const caller = sessionCaller({ userId: "usr_1" });
    const actor = asCaller(caller, () => readAuthenticatedActor());

    expect(actor).not.toBe(caller.actor);
    expect(actor).toEqual(caller.actor);
  });
});
