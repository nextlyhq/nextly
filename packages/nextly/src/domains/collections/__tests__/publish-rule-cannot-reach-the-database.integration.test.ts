/**
 * A publish whose access rule cannot reach the database ends, keeps the
 * pending change, and names the rule.
 *
 * A rule is the app's own code and may query. On a pool whose only connection
 * the publish's transaction holds, a rule asked inside that transaction waits
 * for a connection only the transaction can release, and the wait runs out at
 * the pool's bound. The rule never answered, so the publish is neither allowed
 * nor refused on it: it ends with `RULE_COULD_NOT_RUN` (503), naming the
 * collection or Single and the field, rolls back, and keeps the pending change
 * for a retry. SQLite has no pool to wait on, and its publish completes.
 *
 * The plausible broken implementations read the wait as the rule's refusal
 * (403, or the field silently dropped from the write), or as an internal
 * error. A rule that throws for any other reason still refuses, which the
 * control case shows. A rule that runs without querying is the control that
 * shows each fixture reaches the rule.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { defineCollection, defineSingle, text } from "../../../config";
import { requireNextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";
import type { CollectionsHandler } from "../../../services/collections-handler";

// One connection, so a rule's own query inside the publish's transaction has
// none to take. Set before any instance boots: the pool reads it then.
process.env.DB_POOL_MAX = "1";

const POSTS = "rulequeryposts";
const PREFS = "rulequeryprefs";
const BOSS = { id: "boss", email: "boss@x.test" };

let current: TestNextly | undefined;
afterEach(async () => {
  const instance = current;
  current = undefined;
  if (!instance) return;
  // Bounded, so one publish still waiting on the pool does not hold the rest
  // of the file.
  await Promise.race([
    instance.destroy().catch(() => {}),
    new Promise(resolve => setTimeout(resolve, 10_000)),
  ]);
});

interface Probe {
  /** Set just before the publish, so the saves before it never query. */
  armed: boolean;
  /** What an armed rule does: query, throw, or answer at once. */
  does: "query" | "throw" | "answer";
  calls: number;
}

/** A rule's body: asked, it does what the probe says, then allows. */
function ruleOf(probe: Probe): () => Promise<boolean> {
  return async () => {
    if (!probe.armed) return true;
    probe.calls += 1;
    if (probe.does === "throw") throw new Error("the rule's own failure");
    if (probe.does === "query") {
      await requireNextly().findSingle({ slug: PREFS, overrideAccess: true });
    }
    return true;
  };
}

async function boot(
  dialect: TestDialect,
  probe: Probe,
  where: "field" | "collection"
): Promise<{
  entries: CollectionEntryService;
  handler: CollectionsHandler;
  t: TestNextly;
}> {
  const rule = ruleOf(probe);
  current = await createTestNextly({
    dialect,
    singles: [
      defineSingle({
        slug: PREFS,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "siteName" }),
          text({ name: "guarded", access: { update: rule } }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          ...(where === "collection" ? { publish: rule } : {}),
        },
        fields: [
          text({ name: "title" }),
          text({
            name: "guarded",
            ...(where === "field" ? { access: { update: rule } } : {}),
          }),
        ],
      }),
    ],
  });
  // The publisher may read, update and publish both documents, so each
  // publish reaches its rules rather than being refused before them.
  await userWhoMay(current, BOSS.id, "read", [POSTS, PREFS]);
  for (const action of ["update", "publish"]) {
    await grantTo(current, BOSS.id, action, [POSTS, PREFS]);
  }
  // The handler is the REST route's way in: only it takes `routeAuthorized`,
  // the route's word that it already authorized the publisher.
  const handler = current.getService("collectionsHandler");
  return {
    t: current,
    handler,
    entries: handler.getEntryService(),
  };
}

// Every update here says it replaces whatever is stored (`_overwrite`), as an update that read no
// version must: the writes set the test up, and none of them is about which version they change.

/** A published entry holding a pending change to `guarded`; its id. */
async function heldEntry(entries: CollectionEntryService): Promise<string> {
  const created = await entries.createEntry(
    { collectionName: POSTS, overrideAccess: true },
    { title: "Live", guarded: "live", status: "published" }
  );
  const id = (created.data as { id: string }).id;
  const held = await entries.updateEntry(
    { collectionName: POSTS, entryId: id, overrideAccess: true },
    { guarded: "edited", _overwrite: true }
  );
  expect(held.success, JSON.stringify(held)).toBe(true);
  return id;
}

async function guardedLive(
  entries: CollectionEntryService,
  id: string
): Promise<unknown> {
  const read = await entries.getEntry({
    collectionName: POSTS,
    entryId: id,
    overrideAccess: true,
  });
  return (read.data as { guarded?: unknown } | null)?.guarded;
}

/** Whether the entry still holds a pending change. */
async function stillPending(t: TestNextly, id: string): Promise<boolean> {
  const rows = await t.adapter.select<{ id: string }>("nextly_versions", {
    where: {
      and: [
        { column: "entryId", op: "=", value: id },
        { column: "versionNo", op: "IS NULL" },
        { column: "status", op: "=", value: "draft" },
      ],
    },
  });
  return rows.length > 0;
}

const pooled = (dialect: TestDialect) => dialect !== "sqlite";

describe.each(getConfiguredTestDialects())(
  "a publish whose access rule cannot reach the database (integration, %s)",
  dialect => {
    it("ends a collection publish naming the field whose rule could not run, and keeps the change", async () => {
      const probe: Probe = { armed: false, does: "query", calls: 0 };
      const { entries, handler, t } = await boot(dialect, probe, "field");
      const id = await heldEntry(entries);

      probe.armed = true;
      const published = await handler.updateEntry(
        {
          collectionName: POSTS,
          entryId: id,
          routeAuthorized: true,
          user: BOSS,
        },
        { status: "published", _overwrite: true }
      );

      expect(probe.calls, JSON.stringify(published)).toBeGreaterThan(0);
      if (!pooled(dialect)) {
        expect(published.success, JSON.stringify(published)).toBe(true);
        expect(await guardedLive(entries, id)).toBe("edited");
        return;
      }
      expect(published.statusCode, JSON.stringify(published)).toBe(503);
      expect(published).toMatchObject({
        code: "RULE_COULD_NOT_RUN",
        publicData: { subject: POSTS, field: "guarded" },
      });
      expect(await guardedLive(entries, id)).toBe("live");
      expect(await stillPending(t, id)).toBe(true);

      // Nothing remembered the rule's failure: the retry asks it afresh, and
      // with the rule answering, the kept change goes live.
      probe.does = "answer";
      const retried = await handler.updateEntry(
        {
          collectionName: POSTS,
          entryId: id,
          routeAuthorized: true,
          user: BOSS,
        },
        { status: "published", _overwrite: true }
      );
      expect(retried.success, JSON.stringify(retried)).toBe(true);
      expect(await guardedLive(entries, id)).toBe("edited");
    }, 120_000);

    it("ends a Single publish naming the field whose rule could not run, and keeps the change", async () => {
      const probe: Probe = { armed: false, does: "query", calls: 0 };
      const { t } = await boot(dialect, probe, "field");
      const singles = t.getService("singleEntryService");
      await singles.update(
        PREFS,
        {
          siteName: "Live",
          guarded: "live",
          status: "published",
          _overwrite: true,
        },
        { overrideAccess: true }
      );
      const held = await singles.update(
        PREFS,
        { guarded: "edited", _overwrite: true },
        { routeAuthorized: true, user: BOSS }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);

      probe.armed = true;
      const published = await singles
        .update(
          PREFS,
          { status: "published", _overwrite: true },
          { routeAuthorized: true, user: BOSS }
        )
        .catch((error: unknown) => error);

      expect(probe.calls, JSON.stringify(published)).toBeGreaterThan(0);
      if (!pooled(dialect)) {
        expect(published).toMatchObject({ success: true });
        return;
      }
      expect(published).toMatchObject({
        statusCode: 503,
        code: "RULE_COULD_NOT_RUN",
        publicData: { subject: PREFS, field: "guarded" },
      });
    }, 90_000);

    // A collection's publish rule is asked on the pool before the write's
    // transaction opens, so its own query has a connection even when the pool
    // holds one: the publish completes on every dialect. A publish that asked
    // it inside the transaction would wait out the bound here instead.
    it("lets a collection rule asked before the transaction query, on a one-connection pool", async () => {
      const probe: Probe = { armed: false, does: "query", calls: 0 };
      const { entries } = await boot(dialect, probe, "collection");
      const id = await heldEntry(entries);

      probe.armed = true;
      const published = await entries.publishAllLocales({
        collectionName: POSTS,
        entryId: id,
        routeAuthorized: false,
        user: BOSS,
        data: { _overwrite: true },
      });

      expect(probe.calls, JSON.stringify(published)).toBeGreaterThan(0);
      expect(published.success, JSON.stringify(published)).toBe(true);
    }, 90_000);

    it("still refuses a publish whose collection rule throws for any other reason", async () => {
      const probe: Probe = { armed: false, does: "throw", calls: 0 };
      const { entries } = await boot(dialect, probe, "collection");
      const id = await heldEntry(entries);

      probe.armed = true;
      const published = await entries.publishAllLocales({
        collectionName: POSTS,
        entryId: id,
        routeAuthorized: false,
        user: BOSS,
        data: { _overwrite: true },
      });

      expect(probe.calls).toBeGreaterThan(0);
      expect(published.statusCode, JSON.stringify(published)).toBe(403);
    }, 90_000);

    it("publishes when the rule answers without querying", async () => {
      const probe: Probe = { armed: false, does: "answer", calls: 0 };
      const { entries, handler } = await boot(dialect, probe, "field");
      const id = await heldEntry(entries);

      probe.armed = true;
      const published = await handler.updateEntry(
        {
          collectionName: POSTS,
          entryId: id,
          routeAuthorized: true,
          user: BOSS,
        },
        { status: "published", _overwrite: true }
      );

      expect(probe.calls).toBeGreaterThan(0);
      expect(published.success, JSON.stringify(published)).toBe(true);
      expect(await guardedLive(entries, id)).toBe("edited");
    }, 90_000);
  }
);
