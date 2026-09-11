/**
 * R4/D35 — `fetchParentForm` (used by the afterCreate notification hook) reads
 * the parent form through the secure managed service as system, instead of the
 * legacy `getCollectionsHandler()` + `overrideAccess` runtime path. (The
 * end-to-end path is covered by `before-email-filter.integration.test.ts`.)
 */
import { NextlyError } from "nextly";
import { describe, expect, it, vi } from "vitest";

import { fetchParentForm } from "../plugin";

// The slug now arrives RESOLVED: a host that renames the collection takes the
// declared name out of the registry, so the caller resolves it and this reads
// what it is given.
const formsSlug = "forms";

function nextlyWith(findEntryById: ReturnType<typeof vi.fn>) {
  return {
    services: { collections: { findEntryById } },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("fetchParentForm", () => {
  it("reads the form via findEntryById as system", async () => {
    const findEntryById = vi
      .fn()
      .mockResolvedValue({ id: "form1", slug: "contact" });

    const form = await fetchParentForm(
      formsSlug,
      "form1",
      nextlyWith(findEntryById)
    );

    // Asks for the schema alone, so the form's `afterRead` hook can skip the
    // submission count it would otherwise run on every write.
    expect(findEntryById).toHaveBeenCalledWith("forms", "form1", {
      as: "system",
      context: { "formBuilder.schemaOnlyRead": true },
    });
    expect(form).toMatchObject({ id: "form1" });
  });

  it("returns null (not throws) when the form is missing", async () => {
    const findEntryById = vi
      .fn()
      .mockRejectedValue(NextlyError.notFound({ message: "No such form." }));
    expect(
      await fetchParentForm(formsSlug, "missing", nextlyWith(findEntryById))
    ).toBeNull();
  });

  it("lets a failed read stay a failed read", async () => {
    // A form that is not there is an answer. A pool timeout or a throwing
    // `afterRead` hook is not, and answering `null` for it told the writer
    // their submission was invalid, with a status that says not to retry.
    const findEntryById = vi.fn().mockRejectedValue(new Error("pool timeout"));
    await expect(
      fetchParentForm(formsSlug, "form1", nextlyWith(findEntryById))
    ).rejects.toThrow("pool timeout");
  });
});
