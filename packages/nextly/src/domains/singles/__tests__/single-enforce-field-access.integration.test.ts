/**
 * `enforceFieldAccess` on a Single read, against a real database.
 *
 * The option is declared on the configuration BOTH APIs inherit, so a Single
 * read that ignored it would return fields the caller was promised were
 * redacted — a guarantee the type makes and the code does not keep, which is
 * worse than not offering the option at all.
 *
 * The pair is the point. `overrideAccess: true` alone must keep skipping field
 * rules (that is what every trusted caller relies on), and the same read with
 * `enforceFieldAccess: true` must judge them as the named user. Asserting only
 * the second passes against an implementation that redacts unconditionally,
 * which would break every existing trusted read.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const settings = () =>
  defineSingle({
    slug: "site-settings",
    fields: [
      text({ name: "siteName" }),
      text({
        name: "apiToken",
        access: { read: ({ req }) => req.user?.email === "boss@x.test" },
      }),
    ],
  });

async function seed(): Promise<TestNextly> {
  const nextly = await createTestNextly({ singles: [settings()] });
  await nextly.nextly.updateSingle({
    slug: "site-settings",
    data: { siteName: "Acme", apiToken: "secret-token" },
  });
  return nextly;
}

describe("a Single read that keeps its document bypass and gives up the field one", () => {
  it("hides a field the named user cannot read", async () => {
    current = await seed();

    const doc = (await current.nextly.findSingle({
      slug: "site-settings",
      overrideAccess: true,
      enforceFieldAccess: true,
      user: { id: "u1", email: "nobody@x.test", roles: [] },
    })) as { siteName?: string; apiToken?: string } | null;

    expect(doc?.apiToken).toBeUndefined();
    // Field-scoped rather than a blanked document.
    expect(doc?.siteName).toBe("Acme");
  });

  it("shows that same field to a user the rule allows", async () => {
    current = await seed();

    const doc = (await current.nextly.findSingle({
      slug: "site-settings",
      overrideAccess: true,
      enforceFieldAccess: true,
      user: { id: "u1", email: "boss@x.test", roles: [] },
    })) as { apiToken?: string } | null;

    expect(doc?.apiToken).toBe("secret-token");
  });

  // The control that keeps the option a NARROWING one. Every trusted caller in
  // the product reads without it and must keep seeing every field; an
  // implementation that redacted unconditionally would pass the first case and
  // break all of them.
  it("still skips field rules for a trusted read that does not ask", async () => {
    current = await seed();

    const doc = (await current.nextly.findSingle({
      slug: "site-settings",
      overrideAccess: true,
      user: { id: "u1", email: "nobody@x.test", roles: [] },
    })) as { apiToken?: string } | null;

    expect(doc?.apiToken).toBe("secret-token");
  });
});
