/**
 * C2 / D65 — plugin-contributed email providers + templates, end-to-end.
 *
 * A plugin registers a custom provider `type` (built via the provider registry,
 * replacing core's hardcoded switch) and an email template (seeded idempotently
 * into the DB on boot).
 */
import { afterEach, describe, expect, it } from "vitest";

import { getEmailProviderRegistry } from "../../domains/email/services/email-provider-registry";
import { runPostInitTasks } from "../../init/post-init-tasks";
import { definePlugin } from "../plugin-context";
import { createTestNextly, type TestNextly } from "../test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const sent: Array<{ to: string; subject: string }> = [];

const emailPlugin = () =>
  definePlugin({
    name: "@test/email",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: {
      emailProviders: [
        {
          type: "fake-mailer",
          createAdapter: () => ({
            send: async (opts: { to: string; subject: string }) => {
              sent.push({ to: opts.to, subject: opts.subject });
              return { success: true, messageId: "fake-1" };
            },
          }),
        },
      ],
      emailTemplates: [
        {
          slug: "plugin-welcome",
          name: "Plugin Welcome",
          subject: "Hi {{name}}",
          htmlContent: "<p>Hi {{name}}</p>",
        },
      ],
    },
  });

describe("plugin email providers + templates", () => {
  it("registers a contributed provider type that builds + sends", async () => {
    sent.length = 0;
    current = await createTestNextly({ plugins: [emailPlugin()] });

    const registry = getEmailProviderRegistry();
    expect(registry.has("fake-mailer")).toBe(true);

    const adapter = registry.create("fake-mailer", {});
    const res = await adapter.send({
      to: "x@y.com",
      from: "a@b.com",
      subject: "Hello",
      html: "<p>hi</p>",
    });
    expect(res.success).toBe(true);
    expect(sent).toContainEqual({ to: "x@y.com", subject: "Hello" });
  });

  it("seeds a contributed email template (resolvable by slug, idempotent)", async () => {
    current = await createTestNextly({ plugins: [emailPlugin()] });
    await runPostInitTasks();
    await runPostInitTasks(); // idempotent

    const tpl = await current.nextly.emailTemplates.findBySlug({
      slug: "plugin-welcome",
    });
    expect(tpl).not.toBeNull();
    expect(tpl?.subject).toBe("Hi {{name}}");
  });
});
