/**
 * A Single's first read fills the defaults its groups and repeater rows declare.
 *
 * The auto-create resolved top-level defaults only, so a child default inside a
 * group, constant or function, never reached the row the first read creates.
 * It now fills nested defaults through the same walk a collection create uses,
 * over the live code-first field so a function default still resolves.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, group, password, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { definePlugin } from "../../../plugins/plugin-context";
import { clearFieldTypes } from "../../schema/field-types/field-type-registry";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  clearFieldTypes();
});

describe("a Single's first read fills nested defaults (integration)", () => {
  it("fills a group's constant and function defaults, and leaves an undefaulted group absent", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "site",
          fields: [
            text({ name: "siteName", defaultValue: "Acme" }),
            group({
              name: "theme",
              fields: [
                text({ name: "mode", defaultValue: "light" }),
                text({ name: "accent", defaultValue: d => `${d.mode}-blue` }),
              ],
            }),
            group({ name: "social", fields: [text({ name: "handle" })] }),
          ],
        }),
      ],
    });

    const doc = (await current.nextly.findSingle({
      slug: "site",
      overrideAccess: true,
    })) as { siteName?: string; theme?: unknown; social?: unknown } | null;

    expect(doc?.siteName).toBe("Acme");
    // A function default resolves against its own group, after the constant
    // before it.
    expect(doc?.theme).toEqual({ mode: "light", accent: "light-blue" });
    // Nothing declared, nothing invented: not an empty object.
    expect(doc?.social ?? null).toBeNull();
  });

  it("refuses a password default nested in a group, since this insert never hashes", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "vault",
          fields: [
            group({
              name: "creds",
              fields: [password({ name: "secret", defaultValue: "plain" })],
            }),
          ],
        }),
      ],
    });

    await expect(
      current.nextly.findSingle({ slug: "vault", overrideAccess: true })
    ).rejects.toMatchObject({ code: expect.stringMatching(/VALIDATION/) });
  });
  it("shows a later top-level default the group declared before it", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "ordered",
          fields: [
            group({
              name: "theme",
              fields: [text({ name: "mode", defaultValue: "dark" })],
            }),
            // Declared after the group, so it reads a group that is already
            // filled. Resolving every top-level default first and the nested
            // ones afterwards would show it an absent group instead.
            text({
              name: "summary",
              defaultValue: d =>
                `mode=${(d.theme as { mode?: string } | undefined)?.mode ?? "none"}`,
            }),
          ],
        }),
      ],
    });

    const doc = (await current.nextly.findSingle({
      slug: "ordered",
      overrideAccess: true,
    })) as { summary?: string } | null;

    expect(doc?.summary).toBe("mode=dark");
  });

  it("refuses a nested default the contributed type rejects", async () => {
    // Contributed through a plugin, and the single with it: a type registered
    // directly is not what a boot validates the config against.
    const plugin = definePlugin({
      name: "@test/nested-default",
      version: "1.0.0",
      nextly: ">=0.0.0",
      contributes: {
        fieldTypes: [
          {
            type: "doc",
            storage: "json",
            component: "@acme/doc/admin#Input",
            validate: (value: unknown) =>
              (value as { kind?: string })?.kind === "page"
                ? true
                : "content must be a page document.",
          },
        ],
        singles: [
          {
            slug: "docsite",
            fields: [
              {
                name: "body",
                type: "group",
                fields: [
                  {
                    name: "content",
                    type: "doc",
                    defaultValue: { kind: "template" },
                  },
                ],
              },
            ],
          } as never,
        ],
      },
    });

    current = await createTestNextly({ plugins: [plugin] });

    let messages = "";
    try {
      await current.nextly.findSingle({
        slug: "docsite",
        overrideAccess: true,
      });
    } catch (error) {
      // The refusal carries the type's own message in its issues, as the
      // top-level check does; the error's own message is the generic one.
      const data = (error as { publicData?: unknown }).publicData as
        | { errors?: Array<{ path: string; message: string }> }
        | undefined;
      messages = (data?.errors ?? [])
        .map(i => `${i.path}: ${i.message}`)
        .join(" ");
    }

    expect(messages).toContain("must be a page document");
  });
  it("leaves an invented group absent when a required child has no value", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "partial",
          fields: [
            group({
              name: "contact",
              fields: [
                text({ name: "label", defaultValue: "Support" }),
                // Required, with no default and nothing to supply it on a
                // first read: a group created for `label` alone would be a
                // document the next write refuses.
                text({ name: "email", required: true }),
              ],
            }),
          ],
        }),
      ],
    });

    const doc = (await current.nextly.findSingle({
      slug: "partial",
      overrideAccess: true,
    })) as { contact?: unknown } | null;

    expect(doc?.contact ?? null).toBeNull();
  });

  it("still fills a group whose required children are all satisfied", async () => {
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "complete",
          fields: [
            group({
              name: "contact",
              fields: [
                text({ name: "label", defaultValue: "Support" }),
                text({
                  name: "email",
                  required: true,
                  defaultValue: "support@example.test",
                }),
              ],
            }),
          ],
        }),
      ],
    });

    const doc = (await current.nextly.findSingle({
      slug: "complete",
      overrideAccess: true,
    })) as { contact?: { label?: string; email?: string } } | null;

    expect(doc?.contact).toEqual({
      label: "Support",
      email: "support@example.test",
    });
  });
});
