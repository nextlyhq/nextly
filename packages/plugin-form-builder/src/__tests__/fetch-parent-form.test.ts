/**
 * R4/D35 — `fetchParentForm` (used by the afterCreate notification hook) reads
 * the parent form through the secure managed service as system, instead of the
 * legacy `getCollectionsHandler()` + `overrideAccess` runtime path. (The
 * end-to-end path is covered by `before-email-filter.integration.test.ts`.)
 */
import { describe, expect, it, vi } from "vitest";

import { fetchParentForm } from "../plugin";

const config = {
  formOverrides: { slug: "forms" },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function nextlyWith(findEntryById: ReturnType<typeof vi.fn>) {
  return {
    services: { collections: { findEntryById } },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("fetchParentForm (R4/D35)", () => {
  it("reads the form via findEntryById as system", async () => {
    const findEntryById = vi
      .fn()
      .mockResolvedValue({ id: "form1", slug: "contact" });

    const form = await fetchParentForm(
      config,
      "form1",
      nextlyWith(findEntryById)
    );

    expect(findEntryById).toHaveBeenCalledWith("forms", "form1", {
      as: "system",
    });
    expect(form).toMatchObject({ id: "form1" });
  });

  it("returns null (not throws) when the form is missing", async () => {
    const findEntryById = vi.fn().mockRejectedValue(new Error("not found"));
    expect(
      await fetchParentForm(config, "missing", nextlyWith(findEntryById))
    ).toBeNull();
  });
});
