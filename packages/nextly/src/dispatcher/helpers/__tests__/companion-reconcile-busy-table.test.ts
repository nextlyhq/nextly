/**
 * A translations table's change that stops on a busy table reaches the dialog as the busy-table
 * stop, which the API answers with 409 and the stop's report, not as an internal error: the push
 * landed, and the stop says what to do next.
 */
import { describe, expect, it, vi } from "vitest";

import { tableBusyError } from "../../../domains/schema/busy-table/report";
import type { PipelineResult } from "../../../domains/schema/pipeline/pushschema-pipeline";
import type { DesiredSchema } from "../../../domains/schema/pipeline/types";
import { NextlyError } from "../../../errors/nextly-error";
import {
  companionReconcileFailure,
  pushAndReconcileCompanion,
  type BuilderCompanionReconcile,
} from "../builder-schema-push";

const busy = (): NextlyError =>
  tableBusyError({
    change: "the localization change",
    ended: {
      table: "dc_home_locales",
      holder: { kind: "unnamed", reason: "not looked up" },
    },
    tries: 2,
    elapsedMs: 3_000,
    appliedBefore: [],
    outcome: { kind: "nothing-changed" },
    cause: "table-busy",
    endedAtLease: false,
  });

const reconcile = vi.hoisted(() => ({ fails: (): unknown => undefined }));

vi.mock("../../../domains/singles/services/reconcile-single-companion", () => ({
  reconcileSingleCompanion: async () => {
    throw reconcile.fails();
  },
}));

const desired: DesiredSchema = { collections: {}, singles: {}, components: {} };
const pushed = async (): Promise<PipelineResult> =>
  ({
    success: true,
    statementsExecuted: 1,
    renamesApplied: 0,
  }) as PipelineResult;
const companion = {
  slug: "home",
  tableName: "dc_home",
  oldFields: [],
  newFields: [],
  localized: true,
  wasLocalized: true,
  adapter: {},
} as unknown as BuilderCompanionReconcile;

describe("a companion reconcile stopped by a busy table", () => {
  it("reaches a Single's dialog as NEXTLY_TABLE_BUSY", async () => {
    const stop = busy();
    reconcile.fails = () => stop;
    const error = await pushAndReconcileCompanion(
      pushed,
      desired,
      "single",
      companion
    ).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(error).toBe(stop);
  });

  it("is passed on as it is by the collection save's reconcile too", () => {
    const stop = busy();
    expect(companionReconcileFailure(stop, { op: "x", slug: "posts" })).toBe(
      stop
    );
  });

  it("any other failure still says the companion is out of step", () => {
    const failure = companionReconcileFailure(new Error("disk full"), {
      op: "companionReconcile",
      slug: "posts",
    });
    expect(NextlyError.is(failure) ? failure.code : failure).toBe(
      "INTERNAL_ERROR"
    );
  });
});
