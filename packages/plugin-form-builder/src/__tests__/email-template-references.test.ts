import { describe, expect, it } from "vitest";

import { formTemplateReferences } from "../utils/email-template-references";

describe("formTemplateReferences", () => {
  it("returns an empty list when given no forms", () => {
    expect(formTemplateReferences([])).toEqual([]);
  });

  it("names each enabled notification rule's template with its form and rule name", () => {
    const references = formTemplateReferences([
      {
        name: "Contact us",
        notifications: [
          {
            name: "Autoresponder",
            enabled: true,
            templateSlug: "contact-autoresponder",
          },
          {
            name: "Notify team",
            enabled: true,
            templateSlug: "team-alert",
          },
        ],
      },
      {
        name: "Newsletter signup",
        notifications: [
          {
            name: "Welcome email",
            enabled: true,
            templateSlug: "welcome",
          },
        ],
      },
    ]);

    expect(references).toEqual([
      {
        slug: "contact-autoresponder",
        label: "Form: Contact us, Autoresponder",
      },
      {
        slug: "team-alert",
        label: "Form: Contact us, Notify team",
      },
      {
        slug: "welcome",
        label: "Form: Newsletter signup, Welcome email",
      },
    ]);
  });

  it("omits the rule name when it is absent or blank", () => {
    const references = formTemplateReferences([
      {
        name: "Contact us",
        notifications: [
          {
            enabled: true,
            templateSlug: "contact-autoresponder",
          },
          {
            name: "   ",
            enabled: true,
            templateSlug: "team-alert",
          },
        ],
      },
    ]);

    expect(references).toEqual([
      {
        slug: "contact-autoresponder",
        label: "Form: Contact us",
      },
      {
        slug: "team-alert",
        label: "Form: Contact us",
      },
    ]);
  });

  it("uses 'Untitled form' when the form name is missing or blank", () => {
    const references = formTemplateReferences([
      {
        notifications: [
          {
            name: "Notify team",
            enabled: true,
            templateSlug: "team-alert",
          },
        ],
      },
      {
        name: "   ",
        notifications: [
          {
            enabled: true,
            templateSlug: "general-alert",
          },
        ],
      },
    ]);

    expect(references).toEqual([
      {
        slug: "team-alert",
        label: "Form: Untitled form, Notify team",
      },
      {
        slug: "general-alert",
        label: "Form: Untitled form",
      },
    ]);
  });

  it("skips disabled rules and rules without a template slug", () => {
    const references = formTemplateReferences([
      {
        name: "Feedback",
        notifications: [
          {
            name: "Disabled rule",
            enabled: false,
            templateSlug: "disabled-template",
          },
          {
            name: "No slug",
            enabled: true,
            templateSlug: "",
          },
          {
            name: "Whitespace slug",
            enabled: true,
            templateSlug: "   ",
          },
          {
            name: "Missing slug",
            enabled: true,
          },
        ],
      },
    ]);

    expect(references).toEqual([]);
  });

  it("parses notifications stored as JSON strings", () => {
    const references = formTemplateReferences([
      {
        name: "Quote request",
        notifications: JSON.stringify([
          {
            name: "Receipt",
            enabled: true,
            templateSlug: "quote-receipt",
          },
        ]),
      },
    ]);

    expect(references).toEqual([
      {
        slug: "quote-receipt",
        label: "Form: Quote request, Receipt",
      },
    ]);
  });

  it("ignores invalid or non-array notifications safely", () => {
    expect(
      formTemplateReferences([
        { name: "Broken 1", notifications: "not-json" },
        { name: "Broken 2", notifications: 42 },
        { name: "Broken 3", notifications: null },
        { name: "Broken 4", notifications: [null, undefined, "not an object"] },
      ])
    ).toEqual([]);
  });
});
