/**
 * What a judging transaction answers: what the write stored, the site's
 * refusal, or the failure itself when it is a fault rather than a refusal.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { judgeInTransaction } from "./judged-writes";

/** A transaction that runs its work and passes on whatever it throws, wrapped as an adapter wraps it. */
async function wrapping<T>(run: (tx: "tx") => Promise<T>): Promise<T> {
  try {
    return await run("tx");
  } catch (error) {
    throw new Error("database error", { cause: error });
  }
}

describe("judgeInTransaction", () => {
  it("answers what the write returned, once rolled back", async () => {
    const judged = await judgeInTransaction(wrapping, () =>
      Promise.resolve({ content: "as stored" })
    );
    expect(judged).toEqual({
      refusal: null,
      written: { content: "as stored" },
    });
  });

  it("answers a refusal in the site's own words", async () => {
    const judged = await judgeInTransaction(wrapping, () => {
      throw NextlyError.validation({
        errors: [
          { path: "content", code: "INVALID", message: "Not allowed here." },
        ],
      });
    });
    expect(judged).toEqual({ refusal: { messages: ["Not allowed here."] } });
  });

  it("throws a server fault rather than calling it a refusal", async () => {
    const fault = NextlyError.internal({ logContext: { reason: "test" } });
    await expect(
      judgeInTransaction(wrapping, () => {
        throw fault;
      })
    ).rejects.toMatchObject({ cause: fault });
  });

  it("throws a refusal for an item saved since it was read, to be read again", async () => {
    const stale = new NextlyError({
      code: "STALE_VERSION",
      publicMessage: "Someone else saved this.",
      logContext: { reason: "test" },
    });
    await expect(
      judgeInTransaction(wrapping, () => {
        throw stale;
      })
    ).rejects.toMatchObject({ cause: stale });
  });
});
