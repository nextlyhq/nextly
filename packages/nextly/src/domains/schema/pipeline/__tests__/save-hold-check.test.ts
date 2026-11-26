/**
 * A deleting save's hold of its collection, asked before each statement the save sends: only in that
 * save's flow, and taken as lost where it cannot be shown kept.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import {
  assertSaveHoldKept,
  isSaveHoldLost,
  withSaveHoldAsked,
} from "../save-hold-check";

/** What `asked` ends with: nothing, or its failure. */
const outcomeOf = (asked: Promise<void>): Promise<unknown> =>
  asked.then(
    () => undefined,
    (error: unknown) => error
  );

describe("a deleting save's hold, asked before each statement", () => {
  it("asks nothing outside such a save, nor of one whose statements run on the holding connection", async () => {
    expect(await outcomeOf(assertSaveHoldKept())).toBeUndefined();
    expect(
      await withSaveHoldAsked(undefined, () => outcomeOf(assertSaveHoldKept()))
    ).toBeUndefined();
  });

  it("asks each time while the save runs, and no more once it has ended", async () => {
    let asked = 0;
    const kept = () => {
      asked += 1;
      return Promise.resolve(true);
    };
    const left = await withSaveHoldAsked(kept, async () => {
      await assertSaveHoldKept();
      await assertSaveHoldKept();
      return assertSaveHoldKept;
    });
    expect(asked).toBe(2);
    await left();
    expect(asked).toBe(2);
  });

  it.each([
    { how: "is gone", kept: () => Promise.resolve(false) },
    {
      how: "can't be asked",
      kept: () => Promise.reject(new Error("the connection is closed")),
    },
  ])("stops the statement where the hold $how", async ({ kept }) => {
    const failure = await withSaveHoldAsked(kept, () =>
      outcomeOf(assertSaveHoldKept())
    );
    expect(failure).toMatchObject({ code: "COLLECTION_BEING_CHANGED" });
    expect(isSaveHoldLost(failure)).toBe(true);
  });

  it("tells that stop from another refusal of the same code", () => {
    expect(
      isSaveHoldLost(
        new NextlyError({
          code: "COLLECTION_BEING_CHANGED",
          publicMessage: "This collection is being changed elsewhere.",
        })
      )
    ).toBe(false);
    expect(isSaveHoldLost(new Error("refused"))).toBe(false);
  });
});
