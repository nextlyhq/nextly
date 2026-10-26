/**
 * The boot check on plugin email templates: each is one template, in HTML or
 * in blocks.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../errors/nextly-error";

import type { PluginDefinition } from "./plugin-context";
import { assertEmailTemplates } from "./validate-email-templates";

const BLOCKS = {
  version: 1,
  blocks: [{ type: "heading", text: [{ type: "text", text: "Paid" }] }],
};

function plugins(
  template: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): PluginDefinition[] {
  return [
    {
      name: "@acme/plugin-orders",
      version: "1.0.0",
      nextly: "*",
      ...extra,
      contributes: {
        emailTemplates: [
          {
            slug: "orders-paid",
            name: "Order paid",
            subject: "Paid",
            ...template,
          },
        ],
      },
    },
  ] as unknown as PluginDefinition[];
}

function refusal(template: Record<string, unknown>): NextlyError {
  try {
    assertEmailTemplates(plugins(template));
  } catch (error) {
    if (error instanceof NextlyError) return error;
    throw error;
  }
  throw new Error("expected the boot to be refused");
}

describe("a plugin's email template at boot", () => {
  it.each([
    [
      "both HTML and blocks",
      { htmlContent: "<p>Paid</p>", blocks: BLOCKS },
      "gives both HTML and blocks",
    ],
    ["neither HTML nor blocks", {}, "gives neither HTML nor blocks"],
    [
      "blocks that don't pass the written rules",
      {
        blocks: {
          version: 1,
          blocks: [
            {
              type: "button",
              label: [{ type: "text", text: "Go" }],
              link: { url: "javascript:alert(1)" },
            },
          ],
        },
      },
      "blocks.blocks.0.link.url",
    ],
    [
      'blocks declared for the "legacy" engine',
      { blocks: BLOCKS, engine: "legacy" },
      'leave out engine "legacy"',
    ],
  ])(
    "is refused with %s, naming the plugin and the template",
    (_case, template, why) => {
      const error = refusal(template);
      expect(error.code).toBe("PLUGIN_RESOLUTION_ERROR");
      expect(error.logContext).toMatchObject({
        reason: "plugin-email-template-invalid",
        plugin: "@acme/plugin-orders",
        slug: "orders-paid",
      });
      expect(error.logMessage).toContain(
        'Plugin "@acme/plugin-orders" contributes the email template "orders-paid"'
      );
      expect(error.logMessage).toContain(why);
    }
  );

  it("starts with one in HTML, or one in blocks", () => {
    // The control: the refusals above are about the template, not the plugin.
    expect(() =>
      assertEmailTemplates(plugins({ htmlContent: "<p>Paid</p>" }))
    ).not.toThrow();
    expect(() =>
      assertEmailTemplates(plugins({ blocks: BLOCKS }))
    ).not.toThrow();
  });

  it("is not checked for a plugin that is off", () => {
    expect(() =>
      assertEmailTemplates(plugins({}, { enabled: false }))
    ).not.toThrow();
  });
});
