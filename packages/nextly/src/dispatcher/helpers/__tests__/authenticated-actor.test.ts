/**
 * Decoding the acting identity forwarded through route params.
 *
 * The actor is persisted into durable event history, so a malformed or
 * unrecognized value must degrade to "no actor" rather than being stored.
 */
import { describe, expect, it } from "vitest";

import type { Params } from "../../types";
import { readAuthenticatedActor } from "../authenticated-actor";

function params(values: Record<string, string>): Params {
  return values as unknown as Params;
}

describe("readAuthenticatedActor", () => {
  it("decodes a user actor", () => {
    expect(
      readAuthenticatedActor(
        params({
          _authenticatedActorType: "user",
          _authenticatedActorId: "usr_1",
        })
      )
    ).toEqual({ type: "user", id: "usr_1" });
  });

  it("decodes an apiKey actor", () => {
    expect(
      readAuthenticatedActor(
        params({
          _authenticatedActorType: "apiKey",
          _authenticatedActorId: "key_1",
        })
      )
    ).toEqual({ type: "apiKey", id: "key_1" });
  });

  it("returns undefined when no actor was forwarded", () => {
    expect(readAuthenticatedActor(params({}))).toBeUndefined();
  });

  it("rejects an unrecognized actor type rather than storing it", () => {
    expect(
      readAuthenticatedActor(
        params({
          _authenticatedActorType: "root",
          _authenticatedActorId: "x",
        })
      )
    ).toBeUndefined();
  });

  it("keeps the actor when only a type was forwarded", () => {
    expect(
      readAuthenticatedActor(params({ _authenticatedActorType: "system" }))
    ).toEqual({ type: "system" });
  });
});
