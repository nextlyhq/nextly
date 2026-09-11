/**
 * A Single read hides a denied field from the field-level hooks, as a
 * collection read does.
 *
 * The Single read ran `afterRead` first and redacted afterwards, so a denied
 * field's own hook ran and saw its value, and a hook on an allowed sibling
 * could read the denied value and copy it onto its own, where the redaction
 * pass would not look. The collection read had run two passes around its hooks
 * since it existed. Both now do: the first pass hides, the second re-judges
 * the post-hook document and catches a value a hook put back.
 *
 * Asserted through a booted instance and `findSingle`, with a hook that records
 * what it was handed, because the failure was in what reached app code.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineSingle, group, text } from "../../../config";
import { resetHookRegistry } from "../../../hooks/hook-registry";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

const RULE_PATH = new URL(
  "../../collections/__tests__/_fixtures/single-read-rule.ts",
  import.meta.url
).pathname;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetHookRegistry();
});

const NOBODY = { id: "u1", email: "nobody@x.test", roles: [] };

/** Boot a Single with a denied field and hooks that record and reintroduce. */
async function seed(seen: { token: unknown[]; siteName: unknown[] }) {
  const nextly = await createTestNextly({
    singles: [
      defineSingle({
        slug: "site-settings",
        fields: [
          text({
            name: "siteName",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  // What the allowed field's hook can see of its denied sibling.
                  seen.siteName.push((data as { apiToken?: unknown }).apiToken);
                  return value;
                },
              ],
            },
          }),
          text({
            name: "apiToken",
            access: { read: ({ req }) => req.user?.email === "boss@x.test" },
            hooks: {
              afterRead: [
                ({ value }) => {
                  seen.token.push(value);
                  return value;
                },
              ],
            },
          }),
          text({
            name: "leak",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  // A hook that puts a denied value back under the denied key.
                  (data as Record<string, unknown>).apiToken = "reintroduced";
                  return value;
                },
              ],
            },
          }),
        ],
      }),
    ],
  });
  await nextly.nextly.updateSingle({
    slug: "site-settings",
    data: { siteName: "Acme", apiToken: "secret-token", leak: "x" },
  });
  return nextly;
}

describe("a Single read redacts before its field hooks (integration)", () => {
  it("does not run a denied field's afterRead, and hides it from a sibling's", async () => {
    const seen = { token: [] as unknown[], siteName: [] as unknown[] };
    current = await seed(seen);

    const doc = (await current.nextly.findSingle({
      slug: "site-settings",
      overrideAccess: true,
      enforceFieldAccess: true,
      user: NOBODY,
    })) as { siteName?: string; apiToken?: string } | null;

    expect(doc?.siteName).toBe("Acme");
    expect(doc?.apiToken).toBeUndefined();
    // The denied field's own hook never ran: the key was gone before the walk.
    expect(seen.token).toEqual([]);
    // The allowed sibling's hook saw no value for it either.
    expect(seen.siteName).toEqual([undefined]);
  });

  it("strips a denied value a hook put back", async () => {
    const seen = { token: [] as unknown[], siteName: [] as unknown[] };
    current = await seed(seen);

    const doc = (await current.nextly.findSingle({
      slug: "site-settings",
      overrideAccess: true,
      enforceFieldAccess: true,
      user: NOBODY,
    })) as { apiToken?: string } | null;

    // The `leak` hook assigned it after the first pass; the second removed it.
    expect(doc?.apiToken).toBeUndefined();
  });

  it("still runs the hook and shows the value to a user the rule allows", async () => {
    // The positive control: without it the cases above pass against a read
    // that redacts everything or never runs a field hook at all.
    const seen = { token: [] as unknown[], siteName: [] as unknown[] };
    current = await seed(seen);

    const doc = (await current.nextly.findSingle({
      slug: "site-settings",
      overrideAccess: true,
      enforceFieldAccess: true,
      user: { id: "u2", email: "boss@x.test", roles: [] },
    })) as { apiToken?: string } | null;

    expect(seen.token).toEqual(["secret-token"]);
    expect(seen.siteName).toEqual(["secret-token"]);
    // The `leak` hook's reassignment is judged like anything else: allowed
    // for this user, so the post-hook value stands.
    expect(doc?.apiToken).toBe("reintroduced");
  });

  it("lets the document rule see a denied nested value a hook's rebuilt group dropped", async () => {
    // The gate before the hooks judges the stored document and allows it: no
    // flag yet. A hook on `siteName` then flags the document, and the hook on
    // `settings` returns a fresh spread of the redacted group, so the row
    // object the redaction store keyed `visibility` on is gone. The judge
    // after the hooks must still see `settings.visibility`, or "missing means
    // allowed" admits the caller the rule exists to refuse.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "branding",
          fields: [
            text({
              name: "siteName",
              hooks: {
                afterRead: [
                  ({ value, data }) => {
                    (data as Record<string, unknown>).flagged = true;
                    return value;
                  },
                ],
              },
            }),
            group({
              name: "settings",
              fields: [
                text({ name: "visibility", access: { read: () => false } }),
              ],
              hooks: {
                afterRead: [({ value }) => ({ ...(value as object) })],
              },
            }),
          ],
        }),
      ],
    });
    await current.adapter.update(
      "dynamic_singles",
      { access_rules: { read: { type: "custom", functionPath: RULE_PATH } } },
      { and: [{ column: "slug", op: "=", value: "branding" }] }
    );
    const entry = current.getService("singleEntryService");
    await entry.update(
      "branding",
      { siteName: "Acme", settings: { visibility: "private" } },
      { overrideAccess: true }
    );

    const denied = await entry.get("branding", {
      user: { id: "nested-aware" },
      routeAuthorized: true,
    });
    expect(denied.success).toBe(false);
    expect(denied.statusCode).toBe(403);

    // The mirror: a public value passes, and still never reaches the response.
    await entry.update(
      "branding",
      { settings: { visibility: "public" } },
      { overrideAccess: true }
    );
    const allowed = await entry.get("branding", {
      user: { id: "nested-aware" },
      routeAuthorized: true,
    });
    expect(allowed.success).toBe(true);
    expect(
      (allowed.data as { settings?: { visibility?: string } })?.settings
    ).not.toHaveProperty("visibility");
  });
});
