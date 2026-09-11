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

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
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
});
