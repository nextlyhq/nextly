/**
 * A Forms operation reads and writes on one request, including the lookups it
 * performs on the caller's behalf.
 *
 * `forms.submissions({ form: "<slug>" })` resolves the slug with its own read
 * before the read the caller asked for, and `submit` does the same. Those
 * lookups are part of the operation, so classifying them differently from it
 * would report one call as both a visitor's and a background job's.
 *
 * The request is taken from the MERGED config rather than the arguments, so an
 * instance built as `new Nextly({ request })` counts. Reading the arguments
 * directly compiles and works for a per-call request, which is what makes the
 * instance default easy to drop.
 *
 * @module direct-api/namespaces/__tests__/forms-request-forwarding
 */
import { describe, expect, it, vi } from "vitest";

import { createFormsNamespace } from "../forms";

const request = new Request("https://example.test/api/forms", {
  method: "GET",
  headers: { "x-forwarded-for": "203.0.113.7" },
});

const form = { id: "f1", slug: "contact", status: "published", fields: [] };

function ctxWith(listEntries: ReturnType<typeof vi.fn>, defaults = {}) {
  return {
    collectionsHandler: { listEntries, createEntry: vi.fn() },
    formsCollectionSlug: "forms",
    submissionsCollectionSlug: "form-submissions",
    defaultConfig: defaults,
  } as never;
}

function page(docs: unknown[]) {
  return {
    success: true,
    statusCode: 200,
    data: { docs, totalDocs: docs.length },
  };
}

describe("the Forms namespace forwards one request per operation", () => {
  it("carries it into the slug lookup a submissions read performs", async () => {
    const listEntries = vi.fn().mockResolvedValue(page([form]));
    const forms = createFormsNamespace(ctxWith(listEntries));
    await forms
      .submissions({ form: "contact", request })
      .catch(() => undefined);
    // Both reads: the slug resolution and the submissions page itself.
    expect(listEntries.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of listEntries.mock.calls) {
      expect((call[0] as { request?: unknown }).request).toBe(request);
    }
  });

  it("honours a request configured on the instance", async () => {
    const listEntries = vi.fn().mockResolvedValue(page([]));
    const forms = createFormsNamespace(ctxWith(listEntries, { request }));
    await forms.find().catch(() => undefined);
    expect(
      (listEntries.mock.calls[0]![0] as { request?: unknown }).request
    ).toBe(request);
  });

  it("says nothing when neither the call nor the instance named one", async () => {
    // The control. A namespace that reached for an ambient request would pass
    // both cases above while telling a hook that a script was a visitor.
    const listEntries = vi.fn().mockResolvedValue(page([]));
    const forms = createFormsNamespace(ctxWith(listEntries));
    await forms.find().catch(() => undefined);
    expect(
      (listEntries.mock.calls[0]![0] as { request?: unknown }).request
    ).toBeUndefined();
  });
});
