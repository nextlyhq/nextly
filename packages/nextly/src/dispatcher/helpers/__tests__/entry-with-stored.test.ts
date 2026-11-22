import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { entryWithStored } from "../entry-with-stored";

const refused = () => NextlyError.forbidden({ logContext: { test: true } });
const gone = () => NextlyError.notFound({ logContext: { test: true } });
const broken = () => new Error("database unreachable");

describe("entryWithStored", () => {
  it("attaches the stored read to the populated one", async () => {
    const entry = await entryWithStored(
      Promise.resolve({ id: "1", author: { id: "a", name: "Ana" } }),
      Promise.resolve({ id: "1", author: "a" })
    );
    expect(entry).toEqual({
      id: "1",
      author: { id: "a", name: "Ana" },
      _stored: { id: "1", author: "a" },
    });
  });

  it("fails with the populated read's failure when only it fails", async () => {
    const failure = broken();
    await expect(
      entryWithStored(Promise.reject(failure), Promise.resolve({ id: "1" }))
    ).rejects.toBe(failure);
  });

  it("fails the whole answer when only the stored read fails", async () => {
    const failure = broken();
    await expect(
      entryWithStored(Promise.resolve({ id: "1" }), Promise.reject(failure))
    ).rejects.toBe(failure);
  });

  it("puts a refusal or a missing entry first, from either read", async () => {
    const refusal = refused();
    await expect(
      entryWithStored(Promise.reject(broken()), Promise.reject(refusal))
    ).rejects.toBe(refusal);
    const missing = gone();
    await expect(
      entryWithStored(Promise.reject(missing), Promise.reject(refused()))
    ).rejects.toBe(missing);
  });

  it("puts the populated read's failure first when neither ends the entry", async () => {
    const first = broken();
    await expect(
      entryWithStored(Promise.reject(first), Promise.reject(broken()))
    ).rejects.toBe(first);
  });
});
