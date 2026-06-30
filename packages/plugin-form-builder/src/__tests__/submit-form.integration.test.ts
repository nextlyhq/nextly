/**
 * R4/D56 — full submission flow end-to-end through the harness: `submitForm`
 * resolves the form via the D56 `where` query, validates, and persists a
 * submission via the secure managed service. Proves a plugin that OWNS its
 * collections (forms/form-submissions) is fully testable with `createTestNextly`
 * (the case P7b mistakenly believed was blocked — it was a stale-dist artifact).
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { submitForm } from "../handlers/submit-form";
import { formBuilder } from "../plugin";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("submitForm end-to-end", () => {
  it("resolves the form, validates, and persists a submission", async () => {
    const fb = formBuilder({
      spamProtection: { honeypot: false, recaptcha: { enabled: false } },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let services: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let logger: any;
    const probe = definePlugin({
      name: "@test/fb-submit",
      version: "1.0.0",
      nextly: ">=0.0.0",
      init: c => {
        services = c.services;
        logger = c.logger;
      },
    });
    current = await createTestNextly({ plugins: [fb.plugin, probe] });

    await current.nextly.create({
      collection: "forms",
      data: {
        name: "Contact",
        slug: "contact",
        status: "published",
        fields: [{ type: "text", name: "message", label: "Message" }],
      },
    });

    const result = await submitForm(
      { formSlug: "contact", data: { message: "hello" } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { pluginContext: { services, logger } as any, pluginConfig: fb.config }
    );

    expect(result.success).toBe(true);
    expect(
      await services.collections.count("form-submissions", {}, { as: "system" })
    ).toBe(1);
  });
});
