/**
 * Publishing a Single re-judges the pending change it is about to promote.
 *
 * A Single's publish folds its held draft into the live row. Both the field
 * rules and the schema's rules ran when the caller's payload arrived, and for
 * a publish that payload is just `{ status: "published" }` — so the draft's
 * own content reached the live row having been judged only when it was SAVED.
 *
 * Two things can have changed since. The publisher may not be the author: a
 * field rule can deny them a value the author was allowed to write. And the
 * schema can have tightened under a value that was legal when it was held.
 * The collection publish path gates its promotion for both reasons; this is
 * the same gate on the Singles path.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineSingle, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

const SLUG = "prefs";
const BOSS = { id: "boss", email: "boss@x.test" };
const CLERK = { id: "clerk", email: "clerk@x.test" };

let dir: string;
let dbPath: string;
let current: TestNextly | undefined;
let previousDialect: string | undefined;

beforeEach(() => {
  previousDialect = process.env.DB_DIALECT;
  dir = mkdtempSync(join(tmpdir(), "nextly-single-promote-"));
  dbPath = join(dir, "test.db");
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  if (previousDialect === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = previousDialect;
  rmSync(dir, { recursive: true, force: true });
});

/**
 * `strict` decides whether `checked` carries a rule. Booting twice against one
 * database file, once without it and once with, is how a draft held under an
 * older schema is reproduced: the value was legal when it was saved.
 */
async function boot(strict: boolean): Promise<SingleEntryService> {
  process.env.DB_DIALECT = "sqlite";
  const adapter = await createAdapter({
    type: "sqlite",
    url: `file:${dbPath}`,
  } as Parameters<typeof createAdapter>[0]);
  current = await createTestNextly({
    adapter,
    singles: [
      defineSingle({
        slug: SLUG,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "siteName" }),
          text({
            name: "guarded",
            access: { update: ({ req }) => req.user?.email === BOSS.email },
          }),
          text({
            name: "checked",
            ...(strict
              ? {
                  validate: (v: unknown) =>
                    v === undefined ||
                    v === null ||
                    v === "ok" ||
                    "checked must be ok",
                }
              : {}),
          }),
        ],
      }),
    ],
  });
  return current.getService("singleEntryService");
}

async function reboot(strict: boolean): Promise<SingleEntryService> {
  await current?.destroy();
  current = undefined;
  return boot(strict);
}

describe("a Single's publish re-judges the draft it promotes", () => {
  it("refuses to publish a change the PUBLISHER may not write, and keeps it", async () => {
    const singles = await boot(false);
    await singles.update(
      SLUG,
      { siteName: "Live", status: "published" },
      { overrideAccess: true }
    );
    // The author may write `guarded`, so the held draft carries their edit.
    const held = await singles.update(
      SLUG,
      { guarded: "secret" },
      { routeAuthorized: true, user: BOSS }
    );
    expect(held.success, JSON.stringify(held)).toBe(true);

    // Someone else publishes. The field rule denies THEM that field.
    const published = await singles.update(
      SLUG,
      { status: "published" },
      { routeAuthorized: true, user: CLERK }
    );

    expect(published.success).toBe(false);
    const issues = (
      published as {
        publicData?: { errors?: Array<{ path: string; code: string }> };
      }
    ).publicData?.errors;
    expect(issues?.map(i => i.path)).toEqual(["guarded"]);
    expect(issues?.[0]?.code).toBe("FORBIDDEN");

    // Refused rather than stripped, because a successful publish CONSUMES the
    // draft: stripping would have published the rest, deleted the pending
    // change and destroyed the author's edit with it. The draft is still here.
    const drafts = await current!.adapter.select<{ snapshot: unknown }>(
      "nextly_versions",
      {
        where: {
          and: [
            { column: "scopeKind", op: "=", value: "single" },
            { column: "scopeSlug", op: "=", value: SLUG },
            { column: "versionNo", op: "IS NULL" },
            { column: "status", op: "=", value: "draft" },
          ],
        },
      }
    );
    expect(drafts).toHaveLength(1);
    expect((drafts[0].snapshot as { guarded?: unknown }).guarded).toBe(
      "secret"
    );
  });

  it("publishes normally when the draft changes nothing the publisher is denied", async () => {
    const singles = await boot(false);
    await singles.update(
      SLUG,
      { siteName: "Live", status: "published" },
      { overrideAccess: true }
    );
    // The draft edits only a field this publisher may write. `guarded` is in
    // the snapshot too, as it is in every snapshot, but it is unchanged.
    await singles.update(
      SLUG,
      { siteName: "Edited" },
      { routeAuthorized: true, user: CLERK }
    );

    const published = await singles.update(
      SLUG,
      { status: "published" },
      { routeAuthorized: true, user: CLERK }
    );
    expect(published.success, JSON.stringify(published)).toBe(true);

    const live = await singles.get(SLUG, { overrideAccess: true });
    expect((live.data as { siteName?: unknown }).siteName).toBe("Edited");
  });

  it("still promotes it for a publisher who MAY write it", async () => {
    const singles = await boot(false);
    await singles.update(
      SLUG,
      { siteName: "Live", status: "published" },
      { overrideAccess: true }
    );
    await singles.update(
      SLUG,
      { guarded: "secret" },
      { routeAuthorized: true, user: BOSS }
    );

    const published = await singles.update(
      SLUG,
      { status: "published" },
      { routeAuthorized: true, user: BOSS }
    );
    expect(published.success, JSON.stringify(published)).toBe(true);

    const live = await singles.get(SLUG, { overrideAccess: true });
    expect((live.data as { guarded?: unknown }).guarded).toBe("secret");
  });

  it("refuses a draft the schema has since made invalid, naming the field", async () => {
    let singles = await boot(false);
    await singles.update(
      SLUG,
      { siteName: "Live", status: "published" },
      { overrideAccess: true }
    );
    // Legal under the schema as it stands: no rule on `checked` yet.
    const held = await singles.update(
      SLUG,
      { checked: "anything" },
      { overrideAccess: true }
    );
    expect(held.success, JSON.stringify(held)).toBe(true);

    // The schema tightens while the draft is held.
    singles = await reboot(true);
    const published = await singles.update(
      SLUG,
      { status: "published" },
      { overrideAccess: true }
    );

    expect(published.success).toBe(false);
    expect(published.statusCode).toBe(400);
    // The author cannot fix what they are not told: the refusal names the
    // field and carries the rule's own message.
    const issues = (
      published as {
        publicData?: { errors?: Array<{ path: string; message: string }> };
      }
    ).publicData?.errors;
    expect(issues?.map(i => i.path)).toContain("checked");
    expect(issues?.map(i => i.message).join(" ")).toContain("must be ok");

    // And nothing was published: the live row still holds what it held.
    const live = await singles.get(SLUG, { overrideAccess: true });
    expect((live.data as { checked?: unknown }).checked ?? null).toBeNull();
  });
});
