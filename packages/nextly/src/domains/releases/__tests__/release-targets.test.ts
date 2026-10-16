/**
 * What a document must be to join a release, decided once for every way in.
 *
 * @module domains/releases/__tests__/release-targets.test
 */
import { describe, expect, it, vi } from "vitest";

import {
  resolveReleaseTarget,
  type ReleaseTargetReader,
} from "../release-targets";

function reader(over: Partial<ReleaseTargetReader> = {}): ReleaseTargetReader {
  return {
    readDocument: vi.fn(async () => ({ id: "real-id" })),
    declaresLifecycle: vi.fn(async () => true),
    ...over,
  };
}

const PERSON = { userId: "u1", trusted: false };
const post = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

describe("resolving a release target", () => {
  it("refuses a document that is not there for the caller", async () => {
    // Nothing joins a member to a document, so a typo is accepted by the write
    // path and fails at the scheduled instant instead, with nobody watching.
    await expect(
      resolveReleaseTarget(
        reader({ readDocument: async () => null }),
        post,
        PERSON
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reads the document as the caller, or unchecked for a trusted one", async () => {
    // A document the caller may not read is the same answer as one that is
    // not there, so this cannot be used to probe for ids.
    const r = reader();
    await resolveReleaseTarget(r, post, PERSON);
    expect(r.readDocument).toHaveBeenCalledWith(post, PERSON);
    await resolveReleaseTarget(r, post, { userId: null, trusted: true });
    expect(r.readDocument).toHaveBeenLastCalledWith(post, {
      userId: null,
      trusted: true,
    });
  });

  it("refuses a target whose schema declares no lifecycle", async () => {
    // Read from the schema, not probed on the row: a collection with the
    // lifecycle disabled may legally define an ordinary field called `status`,
    // which materialisation would then overwrite.
    await expect(
      resolveReleaseTarget(
        reader({ declaresLifecycle: async () => false }),
        post,
        PERSON
      )
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("answers a Single's own id, and a collection document's as sent", async () => {
    // A Single is addressed by slug, so any id reaches here, but visibility
    // compares stored decisions against the row's real id.
    await expect(
      resolveReleaseTarget(
        reader(),
        { scopeKind: "single", scopeSlug: "homepage", entryId: "stale" },
        PERSON
      )
    ).resolves.toBe("real-id");
    await expect(resolveReleaseTarget(reader(), post, PERSON)).resolves.toBe(
      "e1"
    );
  });
});
