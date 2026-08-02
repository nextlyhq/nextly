/**
 * Every request boundary opens the warning scope, and every mutation response
 * builder reads it.
 *
 * A boundary that does not open one leaves the recorder with nowhere to write,
 * and a responder that does not read one discards what was collected before
 * the scope exits. Either way a post-commit hook failure is invisible to the
 * caller while the write is durable.
 */

import { describe, expect, it } from "vitest";

import {
  respondAction,
  respondBulk,
  respondBulkUpload,
} from "../../api/response-shapes";
import { withErrorHandler } from "../../api/with-error-handler";
import { NextlyError } from "../../errors/nextly-error";
import {
  currentFlattenedErrors,
  currentSideEffectWarnings,
  recordFlattenedError,
  recordSideEffectWarning,
  withSideEffectWarnings,
} from "../side-effect-warnings";

function failure() {
  return {
    phase: "afterDelete" as const,
    collection: "notes",
    error: NextlyError.internal({ logContext: { detail: "private-detail" } }),
  };
}

describe("the bulk envelopes carry post-commit warnings", () => {
  it("respondBulk includes them when a hook failed", async () => {
    const { result } = await withSideEffectWarnings(async () => {
      recordSideEffectWarning(failure());
      return respondBulk("Deleted.", [{ id: "1" }], []);
    });

    const body = (await result.json()) as { warnings?: unknown[] };
    expect(body.warnings).toHaveLength(1);
    // `errors` is per-ITEM and means that item did not happen; `warnings` is
    // per-OPERATION and means every item happened and a side effect did not.
    // Conflating them would tell a client a row failed when it is durable.
    expect((body as { errors: unknown[] }).errors).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain("private-detail");
  });

  it("respondBulkUpload includes them too", async () => {
    const { result } = await withSideEffectWarnings(async () => {
      recordSideEffectWarning(failure());
      return respondBulkUpload("Uploaded.", [{ id: "1" }], []);
    });

    const body = (await result.json()) as { warnings?: unknown[] };
    expect(body.warnings).toHaveLength(1);
  });

  it("omits the field entirely when nothing failed", async () => {
    const { result } = await withSideEffectWarnings(async () =>
      respondBulk("Deleted.", [{ id: "1" }], [])
    );

    const body = (await result.json()) as Record<string, unknown>;
    // Absent rather than empty, so an ordinary bulk body is what it always was.
    expect("warnings" in body).toBe(false);
  });
});

describe("the standalone handler boundary opens the scope", () => {
  it("gives a handler wrapped by withErrorHandler a live collector", async () => {
    // The handlers exported for direct re-export (`nextly/api/*`) do not pass
    // through `createDynamicHandlers`, so this wrapper is the only boundary
    // they have.
    let seen: unknown;
    const handler = withErrorHandler(async (_req: Request) => {
      recordSideEffectWarning(failure());
      seen = currentSideEffectWarnings();
      return new Response("{}", {
        headers: { "content-type": "application/json" },
      });
    });

    await handler(new Request("https://example.test/api/singles/site"));

    expect(seen).toHaveLength(1);
  });

  it("collects nothing when no boundary is active", async () => {
    // The control: without a scope the recorder is a no-op rather than
    // throwing, so internal work with no caller to report to still runs.
    expect(() => recordSideEffectWarning(failure())).not.toThrow();
    expect(currentSideEffectWarnings()).toHaveLength(0);
  });
});

describe("the action envelope carries them too", () => {
  it("respondAction includes warnings when a hook failed", async () => {
    // Some actions are writes: a version restore goes through the ordinary
    // update path, so its post-commit hooks run and can fail.
    const { result } = await withSideEffectWarnings(async () => {
      recordSideEffectWarning(failure());
      return respondAction("Restored.", { versionId: "v1" });
    });

    const body = (await result.json()) as Record<string, unknown>;
    expect(body.warnings).toHaveLength(1);
    // The action's own payload survives beside them.
    expect(body.versionId).toBe("v1");
  });

  it("lets an action's own warnings win over the ambient ones", async () => {
    // The spread puts `result` last, so a caller that computes its own
    // `warnings` is not silently overwritten by the collector's.
    const { result } = await withSideEffectWarnings(async () => {
      recordSideEffectWarning(failure());
      return respondAction("Done.", { warnings: ["mine"] });
    });

    const body = (await result.json()) as { warnings: unknown[] };
    expect(body.warnings).toEqual(["mine"]);
  });

  it("omits the field when nothing failed", async () => {
    const { result } = await withSideEffectWarnings(async () =>
      respondAction("Done.", { versionId: "v1" })
    );
    const body = (await result.json()) as Record<string, unknown>;
    expect("warnings" in body).toBe(false);
  });
});

describe("a flattened error's private detail is kept for the log, not the caller", () => {
  it("keeps cause and logContext on the scope", async () => {
    // The public envelope drops both on the way out and the boundary rebuilds
    // an error from what survived, so without this the detail is gone before
    // anything can log it and every unexpected failure looks alike.
    const cause = new Error("driver: duplicate key on users_email_idx");
    const original = NextlyError.internal({
      cause,
      logContext: { userId: "u-42", table: "users" },
    });

    const { result } = await withSideEffectWarnings(async () => {
      recordFlattenedError(original);
      return currentFlattenedErrors();
    });

    expect(result).toHaveLength(1);
    // Unprojected on purpose: the only consumer is the logger.
    expect(result[0]?.logContext).toMatchObject({ userId: "u-42" });
    expect(result[0]?.cause).toBe(cause);
  });

  it("keeps the two dimensions of the scope apart", async () => {
    // One scope holds both, so the risk is that a caller-facing projection
    // starts including diagnostics. The warnings projection must never see
    // them.
    const { result } = await withSideEffectWarnings(async () => {
      recordFlattenedError(
        NextlyError.internal({ logContext: { secret: "never-disclosed" } })
      );
      recordSideEffectWarning(failure());
      return currentSideEffectWarnings();
    });

    expect(result).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("never-disclosed");
    expect(JSON.stringify(result)).not.toContain("private-detail");
  });

  it("records nothing outside a request", async () => {
    // No response for the detail to be missing from, so this is a no-op rather
    // than a throw, and nothing accumulates in a long-lived process.
    expect(() => recordFlattenedError(NextlyError.internal({}))).not.toThrow();
    expect(currentFlattenedErrors()).toHaveLength(0);
  });
});
