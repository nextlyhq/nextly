/**
 * Whether a collection update asks the schema lock for the right to create its table: only a save
 * that reshapes the table, in development, where the Builder runs its DDL as it saves.
 *
 * The predicate is asked directly, and through `updateCollection` to show the lock receives its
 * answer: a label-only save in development asks for no DDL, a fields change does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const excluded = vi.hoisted(() => ({
  calls: [] as Array<{ issuesDdl: boolean }>,
}));

// Records what the lock is asked and runs nothing: the options are the subject.
vi.mock("../../../schema/services/schema-change-exclusion", () => ({
  withSchemaChangeExcluded: vi.fn(async (options: { issuesDdl: boolean }) => {
    excluded.calls.push(options);
    return { success: true, statusCode: 200, message: "", data: null };
  }),
}));

import { CollectionMetadataService } from "../collection-metadata-service";
import { collectionSaveIssuesDdl } from "../collection-save-issues-ddl";

afterEach(() => {
  excluded.calls.length = 0;
  vi.unstubAllEnvs();
});

describe("collectionSaveIssuesDdl", () => {
  // A save body carries any of the collection's options, not only the three the predicate reads.
  it.each<[Record<string, unknown>, boolean]>([
    [{ fields: [] }, true],
    [{ localized: true }, true],
    [{ status: false }, true],
    [{ label: "Posts" }, false],
    [{ icon: "file", hidden: true }, false],
    [{}, false],
  ])("in development, %j issues DDL: %s", (body, expected) => {
    expect(collectionSaveIssuesDdl(body, true)).toBe(expected);
  });

  it("issues no DDL outside development, whatever the save changes", () => {
    expect(
      collectionSaveIssuesDdl(
        { fields: [], localized: true, status: true },
        false
      )
    ).toBe(false);
  });
});

describe("updateCollection's schema lock", () => {
  /** The service's own method, with nothing behind it: the lock is recorded, not taken. */
  function service(): CollectionMetadataService {
    return new CollectionMetadataService(
      {} as never,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
      {} as never,
      {} as never
    );
  }

  it("asks for no DDL for a label-only save in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await service().updateCollection(
      { collectionName: "posts" },
      { label: "Posts" }
    );
    expect(excluded.calls.map(call => call.issuesDdl)).toEqual([false]);
  });

  it("asks for DDL for a fields change in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await service().updateCollection(
      { collectionName: "posts" },
      { fields: [] }
    );
    expect(excluded.calls.map(call => call.issuesDdl)).toEqual([true]);
  });
});
