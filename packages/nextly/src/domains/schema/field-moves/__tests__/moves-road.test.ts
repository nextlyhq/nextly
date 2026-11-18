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
});
