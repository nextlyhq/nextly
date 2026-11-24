/**
 * A Builder save that went through is answered as it landed, even where the settle after it fails.
 *
 * The settle after a save judges again the records that stood before it (a save that finished one
 * left part-way clears it there). It runs once the save has committed: its definition, its files,
 * its statements and its registry row. Answered as a failure, the save would be saved again and its
 * change written twice, so a settle that fails there is logged, naming the record it leaves.
 */
import { describe, expect, it, vi } from "vitest";

const settleAfter = vi.hoisted(() => ({
  standing: undefined as readonly string[] | undefined,
}));

vi.mock("../../migrate-create/writer-hold", () => ({
  withBuilderWriterScope: (_label: string, work: () => Promise<unknown>) =>
    work(),
}));

vi.mock("../../builder-save/save-in-progress", () => ({
  withSaveRecords: (work: () => Promise<unknown>) => work(),
}));

vi.mock("../../builder-save/settle-left-save", () => ({
  settleBeforeBuilderSave: vi.fn(async () => [
    {
      id: "a-record-standing-before",
      kind: "collection",
      slug: "posts",
      outcome: "left",
      notes: [],
    },
  ]),
  settleAfterBuilderSave: vi.fn(
    async (
      _adapter: unknown,
      _migrationsDir: string,
      _logger: unknown,
      standing: readonly string[]
    ) => {
      settleAfter.standing = standing;
      throw new Error("the save-in-progress folder could not be read");
    }
  ),
}));

vi.mock("../../../field-groups/migration/sync-guard", () => ({
  withMigrationExcluded: (_args: unknown, work: () => Promise<unknown>) =>
    work(),
}));

import { withSchemaChangeExcluded } from "../schema-change-exclusion";

describe("the settle after a Builder save", () => {
  it("answers a save that went through as it landed when the settle after it fails, logging the failure", async () => {
    const warnings: string[] = [];
    const logger = {
      info: () => undefined,
      warn: (message: string) => {
        warnings.push(message);
      },
      error: () => undefined,
      debug: () => undefined,
    };

    const answer = await withSchemaChangeExcluded(
      {
        adapter: {} as never,
        logger: logger as never,
        label: 'update collection "posts"',
        issuesDdl: true,
        migrationsDir: "/project/migrations",
      },
      async () => "saved"
    ).catch((error: unknown) => error);

    expect(settleAfter.standing, "the settle after the save never ran").toEqual(
      ["a-record-standing-before"]
    );
    expect(answer).toBe("saved");
    expect(warnings.join("\n")).toContain(
      "the save-in-progress folder could not be read"
    );
    expect(warnings.join("\n")).toContain("Its record stays");
  });
});
