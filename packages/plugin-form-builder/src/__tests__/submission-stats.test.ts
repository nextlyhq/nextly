/**
 * R4/D56 — `getFormSubmissionStats` counts submissions per status via the
 * service-level `count` (P7a) under `{as:'system'}`, instead of listing every
 * submission and counting client-side. Focused unit test with a spied service.
 */
import { describe, expect, it, vi } from "vitest";

import { getFormSubmissionStats } from "../handlers/submit-form";

describe("getFormSubmissionStats (R4/D56)", () => {
  it("counts per status with where filters and assembles the totals", async () => {
    // fetchFormBySlug resolves the parent form via listEntries.
    const listEntries = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "form1", slug: "contact" }] });
    // total, new, read, archived (Promise.all order).
    const count = vi
      .fn()
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3);

    const context = {
      pluginContext: {
        services: { collections: { listEntries, count } },
        logger: {
          warn: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
        },
      },
      pluginConfig: {
        formOverrides: { slug: "forms" },
        formSubmissionOverrides: { slug: "form-submissions" },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const stats = await getFormSubmissionStats("contact", context);

    expect(stats).toEqual({ total: 10, new: 4, read: 3, archived: 3 });
    // Every count runs as system, scoped to the form, with the right status.
    expect(count).toHaveBeenCalledWith(
      "form-submissions",
      { where: { form: { equals: "form1" } } },
      { as: "system" }
    );
    expect(count).toHaveBeenCalledWith(
      "form-submissions",
      { where: { form: { equals: "form1" }, status: { equals: "new" } } },
      { as: "system" }
    );
    expect(count).toHaveBeenCalledTimes(4);
  });
});
