import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { getFilterRegistry, resetFilterRegistry } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";
import type { TemplateReference } from "../utils/email-template-references";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetFilterRegistry();
});

describe("form-builder email.templateReferences seam", () => {
  it("registers the email.templateReferences filter and reports templates used by forms", async () => {
    const { plugin } = formBuilder();
    current = await createTestNextly({ plugins: [plugin] });

    expect(getFilterRegistry().hasFilters("email.templateReferences")).toBe(
      true
    );

    // Create forms with notification rules.
    const contact = await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact Us",
        slug: "contact-us",
        fields: [{ type: "text", name: "message", label: "Message" }],
        status: "published",
        notifications: [
          {
            id: "n1",
            name: "Notify team",
            enabled: true,
            recipientType: "static",
            to: "team@example.com",
            templateSlug: "contact-team-alert",
          },
          {
            id: "n2",
            name: "Disabled receipt",
            enabled: false,
            recipientType: "static",
            to: "sender@example.com",
            templateSlug: "contact-receipt",
          },
          {
            id: "n3",
            enabled: true,
            recipientType: "static",
            to: "audit@example.com",
            templateSlug: "audit-notification",
          },
        ],
      },
    });

    const feedback = await current.nextly.create({
      collection: "forms",
      data: {
        name: "Feedback",
        slug: "feedback",
        fields: [{ type: "text", name: "thoughts", label: "Thoughts" }],
        status: "published",
        notifications: [
          {
            id: "n4",
            name: "Autoresponder",
            enabled: true,
            recipientType: "static",
            to: "user@example.com",
            templateSlug: "feedback-thanks",
          },
        ],
      },
    });

    const references = await getFilterRegistry().applyFilters<
      TemplateReference[]
    >("email.templateReferences", [], {});

    // The forms are read in id order, which keeps paging stable; ids are
    // random, so which form comes first is decided here the same way rather
    // than assumed to be the order they were created in. Each form's rules
    // keep their own order.
    const contactReferences = [
      {
        slug: "contact-team-alert",
        label: "Form: Contact Us, Notify team",
      },
      {
        slug: "audit-notification",
        label: "Form: Contact Us",
      },
    ];
    const feedbackReferences = [
      {
        slug: "feedback-thanks",
        label: "Form: Feedback, Autoresponder",
      },
    ];
    const idOf = (created: unknown) =>
      String((created as { item: { id: string } }).item.id);
    expect(references).toEqual(
      idOf(contact) < idOf(feedback)
        ? [...contactReferences, ...feedbackReferences]
        : [...feedbackReferences, ...contactReferences]
    );
  });

  it("reports no references when form notifications are disabled", async () => {
    const { plugin } = formBuilder({
      notifications: { enabled: false },
    });
    current = await createTestNextly({ plugins: [plugin] });

    await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        fields: [{ type: "text", name: "message", label: "Message" }],
        status: "published",
        notifications: [
          {
            id: "n1",
            name: "Notify team",
            enabled: true,
            recipientType: "static",
            to: "team@example.com",
            templateSlug: "contact-team-alert",
          },
        ],
      },
    });

    const initial: TemplateReference[] = [
      { slug: "other-template", label: "Other: setting" },
    ];
    const references = await getFilterRegistry().applyFilters<
      TemplateReference[]
    >("email.templateReferences", initial, {});

    // Left unchanged when notifications are disabled.
    expect(references).toEqual(initial);
  });
});
