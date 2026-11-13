// A schema dialog's push tells `writeBuilderSchemaChange` whether it may have
// changed the database: a push that succeeded did, and on MySQL, which commits
// each schema statement as it runs, a push refused part way may have too.

import { describe, expect, it } from "vitest";

import type { PipelineResult } from "../../../domains/schema/pipeline/pushschema-pipeline";
import { landingPush } from "../builder-save-change";

const answered = (success: boolean) => (): Promise<PipelineResult> =>
  Promise.resolve({ success, statementsExecuted: 0, renamesApplied: 0 });

const desired = {} as Parameters<ReturnType<typeof landingPush>["push"]>[0];

describe("landingPush", () => {
  it("counts a push that succeeded as one that changed the database", async () => {
    const tracked = landingPush(answered(true), "postgresql");
    expect(tracked.landed()).toBe(false);
    await tracked.push(desired);
    expect(tracked.landed()).toBe(true);
  });

  it("counts a refused push as nothing applied where the schema change is one transaction", async () => {
    for (const dialect of ["postgresql", "sqlite"] as const) {
      const tracked = landingPush(answered(false), dialect);
      await tracked.push(desired);
      expect(tracked.landed()).toBe(false);
    }
  });

  it("counts a refused push on MySQL as possibly part applied", async () => {
    const refused = landingPush(answered(false), "mysql");
    await refused.push(desired);
    expect(refused.landed()).toBe(true);

    const thrown = landingPush(
      () => Promise.reject(new Error("the statement failed")),
      "mysql"
    );
    await expect(thrown.push(desired)).rejects.toThrow("the statement failed");
    expect(thrown.landed()).toBe(true);
  });
});
