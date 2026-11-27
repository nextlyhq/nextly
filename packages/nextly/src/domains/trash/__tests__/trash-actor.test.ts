/**
 * Who trashed an item, as its record keeps them: a person by id and name,
 * an API key by its id alone (the name a delete is handed is the key
 * owner's), and anyone else by kind.
 *
 * @module domains/trash/__tests__/trash-actor.test
 */
import { describe, expect, it } from "vitest";

import { trashActorColumns } from "../trash-actor";

describe("trashActorColumns", () => {
  it("keeps a person by id and name", () => {
    expect(trashActorColumns({ type: "user", id: "u1" }, "Sara")).toEqual({
      trashedByKind: "user",
      trashedById: "u1",
      trashedByName: "Sara",
    });
  });

  it("keeps an API key by its id, never under its owner's name", () => {
    expect(trashActorColumns({ type: "apiKey", id: "k1" }, "Owner")).toEqual({
      trashedByKind: "apiKey",
      trashedById: "k1",
      trashedByName: null,
    });
  });

  it("keeps a plugin's person by kind alone, and the system as itself", () => {
    expect(
      trashActorColumns(
        { type: "principal", principal: { kind: "member", id: "m1" } },
        "Member"
      )
    ).toEqual({
      trashedByKind: "principal",
      trashedById: null,
      trashedByName: null,
    });
    expect(trashActorColumns({ type: "system" }, null)).toEqual({
      trashedByKind: "system",
      trashedById: null,
      trashedByName: null,
    });
  });
});
