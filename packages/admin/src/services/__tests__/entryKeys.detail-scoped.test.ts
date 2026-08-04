/**
 * The entry read hook (useEntry) and the mutation hook (useUpdateEntry) build
 * their detail cache key through `entryKeys.detailScoped`. React Query hashes the
 * key object, so if the two ever diverged the optimistic write, rollback, and
 * query cancellation would silently target a query the editor is not reading.
 * These pin the contract: the key carries every read dimension (including draft
 * mode), normalises absent values, and is stable for equal inputs.
 */
import { describe, it, expect } from "vitest";

import { entryKeys } from "../entryApi";

describe("entryKeys.detailScoped", () => {
  it("carries the collection, id, and every read dimension including draft", () => {
    expect(
      entryKeys.detailScoped("posts", "e1", {
        locale: "de",
        fallbackLocale: "none",
        translationStatus: true,
        draft: true,
      })
    ).toEqual([
      ...entryKeys.detail("posts", "e1"),
      {
        locale: "de",
        fallbackLocale: "none",
        translationStatus: true,
        draft: true,
      },
    ]);
  });

  it("normalises absent dimensions to null / false", () => {
    expect(entryKeys.detailScoped("posts", "e1", {})).toEqual([
      ...entryKeys.detail("posts", "e1"),
      {
        locale: null,
        fallbackLocale: null,
        translationStatus: false,
        draft: false,
      },
    ]);
  });

  it("produces equal keys for equal inputs (read and write hooks match)", () => {
    const params = {
      locale: "en",
      fallbackLocale: "none" as const,
      translationStatus: true,
      draft: true,
    };
    expect(entryKeys.detailScoped("posts", "e1", params)).toEqual(
      entryKeys.detailScoped("posts", "e1", params)
    );
  });

  it("distinguishes draft mode from live mode", () => {
    const live = entryKeys.detailScoped("posts", "e1", { draft: false });
    const draft = entryKeys.detailScoped("posts", "e1", { draft: true });
    expect(live).not.toEqual(draft);
  });
});
