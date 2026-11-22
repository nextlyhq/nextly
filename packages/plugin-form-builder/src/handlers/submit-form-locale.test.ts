/**
 * A submission is judged against the form as its visitor saw it: the form
 * is read in the visitor's language, so a field or option a host localized
 * is checked against the words and values that language drew.
 */
import type { PluginContext } from "nextly";
import { describe, expect, it, vi } from "vitest";

import type { ResolvedFormBuilderConfig } from "../types";

import { submitForm } from "./submit-form";

function context(listEntries: ReturnType<typeof vi.fn>) {
  // Only what reading a form by its slug touches: the forms collection's
  // name and the collections service. No form is found, so the submission
  // ends at the read this test watches.
  return {
    pluginContext: {
      services: { collections: { listEntries } },
      logger: { warn: () => undefined },
    } as unknown as PluginContext,
    pluginConfig: {
      formOverrides: { slug: "forms" },
    } as unknown as ResolvedFormBuilderConfig,
  };
}

describe("a submission in a language", () => {
  it("reads the form in the visitor's language", async () => {
    const listEntries = vi.fn(async () => ({ data: [] }));
    await submitForm(
      {
        formSlug: "quote",
        data: {},
        access: { as: "public" },
        locale: "fr",
      },
      context(listEntries)
    );
    expect(listEntries).toHaveBeenCalledTimes(1);
    expect(listEntries.mock.calls[0]?.[2]).toEqual({
      as: "public",
      locale: "fr",
    });
  });

  it("reads the form in the default language when none is named", async () => {
    const listEntries = vi.fn(async () => ({ data: [] }));
    await submitForm(
      { formSlug: "quote", data: {}, access: { as: "public" } },
      context(listEntries)
    );
    expect(listEntries.mock.calls[0]?.[2]).toEqual({ as: "public" });
  });
});
