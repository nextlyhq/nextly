/**
 * R4/D56 — `fetchFormBySlug` resolves a form via a service-level `where` query
 * (P7a) + `{as:'system'}` instead of fetching every form and filtering
 * client-side. Focused unit test with a spied collections service.
 */
import { describe, expect, it, vi } from "vitest";

import { fetchFormBySlug } from "../handlers/submit-form";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctxWith(listEntries: any) {
  return {
    services: { collections: { listEntries } },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const config = {
  formOverrides: { slug: "forms" },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe("fetchFormBySlug (R4/D56)", () => {
  it("queries by slug with a where filter under {as:'system'}", async () => {
    const listEntries = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "1", slug: "contact" }] });

    const form = await fetchFormBySlug("contact", config, ctxWith(listEntries));

    expect(listEntries).toHaveBeenCalledWith(
      "forms",
      { where: { slug: { equals: "contact" } }, pagination: { limit: 1 } },
      { as: "system" }
    );
    expect(form).toMatchObject({ slug: "contact" });
  });

  it("returns null when no match", async () => {
    const listEntries = vi.fn().mockResolvedValue({ data: [] });
    expect(
      await fetchFormBySlug("missing", config, ctxWith(listEntries))
    ).toBeNull();
  });
});
