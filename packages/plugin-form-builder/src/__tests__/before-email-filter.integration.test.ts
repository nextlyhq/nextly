import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { getFilterRegistry, resetFilterRegistry } from "nextly";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formBuilder } from "../plugin";
import type { FormEmailNotification } from "../types";

let current: TestNextly | undefined;

beforeEach(() => {
  // form-builder's init guards against duplicate hook registration in dev mode
  // via a globalThis flag; clear it so each boot re-registers the hook + filter.
  delete (globalThis as Record<string, unknown>)[
    "__formBuilder_afterCreate_form-submissions"
  ];
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetFilterRegistry();
});

describe("form-builder.beforeEmail D63 filter seam (A8)", () => {
  it("registers the beforeEmail config as a filter and runs it through the registry", async () => {
    const { plugin } = formBuilder({
      beforeEmail: ({ emails }) =>
        emails.map(e => ({ ...e, to: "redirected@example.com" })),
    });

    current = await createTestNextly({ plugins: [plugin] });

    // init() registered the config callback on the seam.
    expect(getFilterRegistry().hasFilters("form-builder.beforeEmail")).toBe(
      true
    );

    // The registered config runs through the registry and transforms the value.
    const result = await getFilterRegistry().applyFilters<
      FormEmailNotification[]
    >(
      "form-builder.beforeEmail",
      [{ to: "a@b.com", templateSlug: "t", variables: {} }],
      { form: { name: "F" }, submission: { id: "s1" } }
    );

    expect(result[0].to).toBe("redirected@example.com");
  });

  it("transforms the outgoing notification through the real submission flow", async () => {
    const recorded: FormEmailNotification[][] = [];

    const { plugin, collections } = formBuilder({
      beforeEmail: ({ emails }) => {
        recorded.push(emails);
        return emails.map(e => ({ ...e, to: "redirected@example.com" }));
      },
    });

    // Pass the plugin's collections via `collections:` too, so the harness
    // physically creates their SQLite tables (the runtime auto-sync can't do
    // this non-interactively). The plugin's `setup` dedupes by slug, so they
    // aren't double-registered.
    current = await createTestNextly({ plugins: [plugin], collections });

    const email = current.getService("emailService");
    const sendSpy = vi
      .spyOn(email, "sendWithTemplate")
      .mockResolvedValue({ success: true, messageId: "x" } as never);

    // Create a parent form with one enabled static-recipient notification.
    const form = await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        fields: [{ type: "text", name: "message", label: "Message" }],
        status: "published",
        notifications: [
          {
            id: "n1",
            name: "Admin",
            enabled: true,
            recipientType: "static",
            to: "admin@example.com",
            cc: [],
            bcc: [],
            templateSlug: "form-notification",
          },
        ],
      },
    });

    expect(form).toMatchObject({ item: { id: expect.any(String) } });
    const formId = (form as { item: { id: string } }).item.id;

    // Creating a submission fires the awaited afterCreate hook →
    // handleSubmissionCreated → seam → sendWithTemplate.
    await current.nextly.create({
      collection: "form-submissions",
      data: {
        form: formId,
        data: { message: "hello" },
        status: "new",
        submittedAt: new Date(),
      },
    });

    // The config ran (recorded the built outgoing notifications)...
    expect(recorded).toHaveLength(1);
    expect(recorded[0][0].templateSlug).toBe("form-notification");

    // ...and the seam's transformation reached the actual send.
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [templateArg, toArg] = sendSpy.mock.calls[0];
    expect(templateArg).toBe("form-notification");
    expect(toArg).toBe("redirected@example.com");
  });
});
