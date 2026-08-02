/**
 * Every request boundary opens the warning scope, and every mutation response
 * builder reads it.
 *
 * The first pass covered one boundary (`createDynamicHandlers`) and one
 * responder (`respondMutation`), which left two shapes silently dropping what
 * they had collected: the standalone handlers this package exports for direct
 * re-export, and the bulk envelopes. Both ran hooks and both discarded the
 * failures.
 */

import { describe, expect, it } from "vitest";

import { respondBulk, respondBulkUpload } from "../../api/response-shapes";
import { withErrorHandler } from "../../api/with-error-handler";
import { NextlyError } from "../../errors/nextly-error";
import {
  currentSideEffectWarnings,
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
    // These handlers are exported for direct re-export (`nextly/api/*`) and
    // never pass through `createDynamicHandlers`, so the dynamic router's
    // scope does not cover them.
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
