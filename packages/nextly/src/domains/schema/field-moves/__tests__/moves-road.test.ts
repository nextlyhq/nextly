/**
 * A save with moves keeps their values only through its migration file: one the push would apply
 * instead, or one in an app that writes no file, is refused, with a sentence naming why.
 */
import { describe, expect, it, vi } from "vitest";

import { refuseMovesOffTheFile, type PushReason } from "../moves-road";

const moves = [{ from: ["title"], to: ["meta", "title"] }];
const reason = (answer: PushReason) => vi.fn(async () => answer);

function refusal(message: string) {
  return expect.objectContaining({
    publicData: {
      errors: [{ path: "meta.title", code: "FIELD_MOVE_REFUSED", message }],
    },
  });
}

describe("refuseMovesOffTheFile", () => {
  it("asks nothing of a save that moves nothing", async () => {
    const pushReason = reason("translated");
    await refuseMovesOffTheFile({ moves: [], writes: false, pushReason });
    expect(pushReason).not.toHaveBeenCalled();
  });

  it("asks nothing of a move that keeps its path, into or out of a group with no name", async () => {
    const pushReason = reason("carries-values");
    await refuseMovesOffTheFile({
      moves: [{ from: ["title"], to: ["title"] }],
      writes: false,
      pushReason,
    });
    expect(pushReason).not.toHaveBeenCalled();
  });

  it("lets a save whose moves take the file through", async () => {
    await expect(
      refuseMovesOffTheFile({ moves, writes: true, pushReason: reason(null) })
    ).resolves.toBeUndefined();
  });

  it("refuses moves in a translated collection, every save of which takes the push", async () => {
    await expect(
      refuseMovesOffTheFile({
        moves,
        writes: true,
        pushReason: reason("translated"),
      })
    ).rejects.toThrow(
      refusal("Fields in a translated collection can't be moved yet.")
    );
  });

  it("refuses moves in a save whose other change only the push carries", async () => {
    await expect(
      refuseMovesOffTheFile({
        moves,
        writes: true,
        pushReason: reason("carries-values"),
      })
    ).rejects.toThrow(
      refusal(
        "Moving a field keeps its values only through the migration file, and this save also makes a change that needs a direct apply. Save the move on its own."
      )
    );
  });

  it("refuses moves in an app that writes no migration file", async () => {
    await expect(
      refuseMovesOffTheFile({ moves, writes: false, pushReason: reason(null) })
    ).rejects.toThrow(
      refusal(
        "Moving a field keeps its values only through a migration file, and this app writes none for the Schema Builder."
      )
    );
  });

  // A move that can never be made as it is (a field kept unique, into a group) is told so, where the
  // road would only say it waits: asked first, and of the moves that travel alone.
  describe("with a refusal asked first", () => {
    it("gives the move's own words, at its path", async () => {
      await expect(
        refuseMovesOffTheFile({
          moves,
          writes: true,
          pushReason: reason("translated"),
          refusedFirst: async () => ({
            path: "meta.title",
            message: "title cannot be moved into the group meta: it is unique.",
          }),
        })
      ).rejects.toThrow(
        refusal("title cannot be moved into the group meta: it is unique.")
      );
    });

    it("keeps the road's words where it answers none", async () => {
      await expect(
        refuseMovesOffTheFile({
          moves,
          writes: true,
          pushReason: reason("translated"),
          refusedFirst: async () => undefined,
        })
      ).rejects.toThrow(
        refusal("Fields in a translated collection can't be moved yet.")
      );
    });

    it("is not asked where the save takes the file, or moves nothing that travels", async () => {
      const refusedFirst = vi.fn(async () => ({ path: "x", message: "x" }));
      await refuseMovesOffTheFile({
        moves,
        writes: true,
        pushReason: reason(null),
        refusedFirst,
      });
      await refuseMovesOffTheFile({
        moves: [{ from: ["title"], to: ["title"] }],
        writes: false,
        pushReason: reason("translated"),
        refusedFirst,
      });
      expect(refusedFirst).not.toHaveBeenCalled();
    });

    it("is asked of the moves that travel alone", async () => {
      const refusedFirst = vi.fn(async () => undefined);
      await refuseMovesOffTheFile({
        moves: [...moves, { from: ["slug"], to: ["slug"] }],
        writes: true,
        pushReason: reason("translated"),
        refusedFirst,
      }).catch(() => undefined);
      expect(refusedFirst).toHaveBeenCalledWith(moves);
    });
  });
});
