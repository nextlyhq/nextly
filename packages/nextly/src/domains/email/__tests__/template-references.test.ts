/**
 * What sends each email template, from the settings that reference it.
 *
 * Core runs each `email.templateReferences` handler itself, so a plugin that
 * fails is reported as "couldn't be checked" rather than read as "nothing
 * sends this": a template a form still uses must not be deleted on a failed
 * plugin's silence.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  getFilterRegistry,
  resetFilterRegistry,
} from "../../../filters/filter-registry";
import {
  collectTemplateReferences,
  sendersBySlug,
} from "../template-references";

afterEach(() => resetFilterRegistry());

const SEAM = "email.templateReferences";

describe("collecting the references to email templates", () => {
  it("gathers every handler's references", async () => {
    getFilterRegistry().addFilter(SEAM, (refs: unknown[]) => [
      ...refs,
      { slug: "contact", label: "Form: Contact us, Notify team" },
    ]);
    getFilterRegistry().addFilter(SEAM, (refs: unknown[]) => [
      ...refs,
      { slug: "order-note", label: "Shop: an order note" },
    ]);

    expect(await collectTemplateReferences()).toEqual({
      references: [
        { slug: "contact", label: "Form: Contact us, Notify team" },
        { slug: "order-note", label: "Shop: an order note" },
      ],
      complete: true,
    });
  });

  it("says the references couldn't all be checked when a handler throws", async () => {
    const failures: unknown[] = [];
    getFilterRegistry().addFilter(SEAM, () => {
      throw new Error("forms are unreadable");
    });
    getFilterRegistry().addFilter(SEAM, (refs: unknown[]) => [
      ...refs,
      { slug: "contact", label: "Form: Contact us" },
    ]);

    const result = await collectTemplateReferences({}, error =>
      failures.push(error)
    );

    // The handler that answered still counts; the one that failed is known.
    expect(result).toEqual({
      references: [{ slug: "contact", label: "Form: Contact us" }],
      complete: false,
    });
    expect(failures).toHaveLength(1);
  });

  it("drops what isn't a reference, and counts an answer that isn't a list as unchecked", async () => {
    getFilterRegistry().addFilter(SEAM, () => [
      { slug: "contact", label: "" },
      { slug: 7, label: "Form" },
      { slug: "contact", label: "Form: Contact us" },
    ]);
    getFilterRegistry().addFilter(SEAM, () => "not a list");

    expect(await collectTemplateReferences()).toEqual({
      references: [{ slug: "contact", label: "Form: Contact us" }],
      complete: false,
    });
  });

  it("keeps only one template's references when asked for one", async () => {
    getFilterRegistry().addFilter(SEAM, () => [
      { slug: "contact", label: "Form: Contact us" },
      { slug: "order-note", label: "Shop: an order note" },
    ]);

    expect(
      (await collectTemplateReferences({ slug: "contact" })).references
    ).toEqual([{ slug: "contact", label: "Form: Contact us" }]);
  });

  it("has nothing to say, completely, when no plugin answers", async () => {
    expect(await collectTemplateReferences()).toEqual({
      references: [],
      complete: true,
    });
  });
});

describe("the senders of each template", () => {
  it("puts the owner's word beside the settings that send it, each once", () => {
    const senders = sendersBySlug(
      ["welcome", "contact", "unused"],
      slug => (slug === "welcome" ? ["Someone signs up"] : []),
      [
        { slug: "contact", label: "Form: Contact us, Notify team" },
        { slug: "contact", label: "Form: Contact us, Notify team" },
        { slug: "gone", label: "Form: Old" },
      ]
    );

    expect(senders.get("welcome")).toEqual({
      declared: ["Someone signs up"],
      referenced: [],
    });
    expect(senders.get("contact")).toEqual({
      declared: [],
      referenced: ["Form: Contact us, Notify team"],
    });
    expect(senders.get("unused")).toEqual({ declared: [], referenced: [] });
    expect(senders.has("gone")).toBe(false);
  });
});
