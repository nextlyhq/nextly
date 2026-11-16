/**
 * A release holding a document of a collection or Single removed from code.
 *
 * "Removed from code" is a registry row whose source is the app's code for a
 * slug the configuration no longer declares. Each case boots the app with the
 * entities declared, makes a release holding one draft of a collection and of
 * a Single that the next deploy removes, and one of a collection it keeps,
 * schedules it for a later time while every document is ready, then boots
 * again on the same database without the two, as a deploy of the edited
 * configuration does.
 *
 * After the removal the two documents are hard problems of the release,
 * naming the entity, with every effect a hard problem has: readiness shows
 * them, scheduling and Publish now refuse, adding such a document to a
 * scheduled release refuses, and the engine's next run stops the release
 * before its time and tells its owner, once. Taking the documents out, or
 * declaring the entities again, clears it.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { container } from "../../../di/container";
import { clearServices } from "../../../di/register";
import { seedPermissionsAndRolePresets } from "../../../init/seed-permissions";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { NOTICES_TABLE } from "../../../schemas/notices/table-name";
import { _resetEnvCache } from "../../../shared/lib/env";
import type { JobRegistry } from "../../jobs/job-registry";
import { runJobsPass } from "../../jobs/jobs-runner";
import { ReleasesRepository } from "../releases-repository";

import { seedLiveAuthor } from "./helpers/live-author";
import { ANY_EDITABLE_STATE } from "./helpers/release-writes";
import { rest } from "./helpers/rest-key";

/** Removed from code by the second boot. */
const REMOVED = { collection: "rre_posts", single: "rre_banner" } as const;
/** Declared throughout. */
const KEPT = "rre_pages";

/** A collection with a draft/published lifecycle, which a release moves. */
function withLifecycle(slug: string) {
  return defineCollection({
    slug,
    status: true,
    fields: [text({ name: "title" })],
  });
}

const WITH_REMOVED = {
  collections: [withLifecycle(REMOVED.collection), withLifecycle(KEPT)],
  singles: [
    defineSingle({
      slug: REMOVED.single,
      status: true,
      fields: [text({ name: "title" })],
    }),
  ],
};
const AFTER_REMOVAL = {
  collections: [withLifecycle(KEPT)],
  singles: [],
};

/** The release's time: a week away, so only an early stop can explain one. */
const LATER = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

let current: TestNextly | undefined;

function t(): TestNextly {
  if (!current) throw new Error("not booted");
  return current;
}

const SERVER_URL_ENV = {
  postgresql: "TEST_POSTGRES_URL",
  mysql: "TEST_MYSQL_URL",
} as const;

interface CaseDatabase {
  adapter: DrizzleAdapter;
  close(): Promise<void>;
}

/**
 * A database every boot of a case connects to: a throwaway one on PostgreSQL
 * and MySQL, and one in-memory SQLite connection. The harness's own
 * provisioning drops its database at the next boot, and the second boot has
 * to find what the first wrote.
 */
async function openDatabase(dialect: TestDialect): Promise<CaseDatabase> {
  if (dialect === "sqlite") {
    vi.stubEnv("DB_DIALECT", "sqlite");
    _resetEnvCache();
    const adapter = (await createAdapter({
      type: "sqlite",
      memory: true,
    } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
    return { adapter, close: () => adapter.disconnect() };
  }
  const serverUrl = process.env[SERVER_URL_ENV[dialect]];
  if (!serverUrl) throw new Error(`${SERVER_URL_ENV[dialect]} is not set`);
  const name = `nextly_rre_${randomBytes(8).toString("hex")}`;
  // The adapter factory validates the environment, which needs a URL for a
  // server dialect: the server's, until the case's database exists.
  vi.stubEnv("DATABASE_URL", serverUrl);
  vi.stubEnv("DB_DIALECT", dialect);
  _resetEnvCache();
  const server = await createAdapter({ type: dialect, url: serverUrl });
  await server.executeQuery(createDatabaseStatement(dialect, name));
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  vi.stubEnv("DATABASE_URL", url.toString());
  _resetEnvCache();
  const adapter = (await createAdapter({
    type: dialect,
    url: url.toString(),
  })) as unknown as DrizzleAdapter;
  return {
    adapter,
    async close() {
      await adapter.disconnect().catch(() => {});
      await server.executeQuery(dropDatabaseStatement(dialect, name));
      await server.disconnect();
    },
  };
}

/** Boot with `declared` as the configuration's entities, on the case database. */
async function boot(
  database: CaseDatabase,
  declared: typeof WITH_REMOVED | typeof AFTER_REMOVAL
): Promise<void> {
  clearServices();
  current = await createTestNextly({
    adapter: database.adapter as never,
    collections: declared.collections,
    singles: declared.singles,
  });
}

/** A draft of `collection`, answered by id. */
async function draftEntry(collection: string): Promise<string> {
  const created = (await t().nextly.create({
    collection: collection as never,
    data: { title: "Draft", status: "draft" } as never,
  })) as unknown as { item: { id: string } };
  return String(created.item.id);
}

/** The Single's one document, saved as a draft, answered by id. */
async function draftSingle(single: string): Promise<string> {
  const updated = (await t().nextly.updateSingle({
    slug: single as never,
    data: { title: "Draft", status: "draft", _overwrite: true } as never,
  })) as unknown as { item: { id: string } };
  return String(updated.item.id);
}

/** A document's stored lifecycle, read raw rather than through the read path. */
async function storedStatus(
  table: string,
  id: string
): Promise<string | undefined> {
  const row = await t().adapter.selectOne<{ status?: string }>(table, {
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  return row?.status;
}

/** The stop notices the release's owner holds for it. */
async function stopNotices(releaseId: string, owner: string): Promise<number> {
  const rows = await t().adapter.select<{ id: string }>(NOTICES_TABLE, {
    columns: ["id"],
    where: {
      and: [
        { column: "kind", op: "=", value: "releases.stopped" },
        { column: "subjectId", op: "=", value: releaseId },
        { column: "userId", op: "=", value: owner },
      ],
    },
  });
  return rows.length;
}

/** What a REST refusal names: its problems, as `{ memberId, code }`. */
function restProblems(answer: {
  status: number;
  json: Record<string, unknown>;
}): unknown {
  expect(answer.status).toBe(409);
  const error = answer.json.error as { code: string; data: unknown };
  expect(error.code).toBe("CONFLICT");
  return (error.data as { problems: unknown }).problems;
}

/** What a Direct API refusal names, in the same shape. */
async function directProblems(call: Promise<unknown>): Promise<unknown> {
  const error = (await call.then(
    () => undefined,
    (thrown: unknown) => thrown
  )) as { code?: unknown; publicData?: { problems?: unknown } } | undefined;
  expect(error, "the call was refused").toBeDefined();
  expect(error?.code).toBe("CONFLICT");
  return error?.publicData?.problems;
}

interface Arranged {
  owner: string;
  key: string;
  releaseId: string;
  members: { collection: string; single: string; kept: string };
  entries: { collection: string; single: string; kept: string };
}

describe.each(getConfiguredTestDialects())(
  "a release holding a document of an entity removed from code (%s)",
  dialect => {
    let database: CaseDatabase | undefined;
    const caseDb = (): CaseDatabase => {
      if (!database) throw new Error("the case database is not open");
      return database;
    };
    let arranged: Arranged;

    beforeEach(async () => {
      database = await openDatabase(dialect);
      await boot(caseDb(), WITH_REMOVED);
      await seedPermissionsAndRolePresets();
      const owner = await seedLiveAuthor(t());
      const apiKeys = t().getService("apiKeyService") as unknown as {
        createApiKey(
          userId: string,
          input: { name: string; tokenType: string; expiresIn: string }
        ): Promise<{ key: string }>;
      };
      const { key } = await apiKeys.createApiKey(owner, {
        name: "removed-entity-release",
        tokenType: "full-access",
        expiresIn: "unlimited",
      });
      const entries = {
        collection: await draftEntry(REMOVED.collection),
        single: await draftSingle(REMOVED.single),
        kept: await draftEntry(KEPT),
      };
      const repo = new ReleasesRepository(caseDb().adapter as never);
      const release = await repo.createRelease({
        title: "Launch",
        createdBy: owner,
      });
      const add = async (
        scopeKind: "collection" | "single",
        scopeSlug: string,
        entryId: string
      ): Promise<string> =>
        (
          await repo.addMember(
            {
              releaseId: release.id,
              scopeKind,
              scopeSlug,
              entryId,
              locale: null,
              action: "publish",
              createdBy: owner,
            },
            ANY_EDITABLE_STATE
          )
        ).id;
      const members = {
        collection: await add(
          "collection",
          REMOVED.collection,
          entries.collection
        ),
        single: await add("single", REMOVED.single, entries.single),
        kept: await add("collection", KEPT, entries.kept),
      };
      // Scheduled through the service, which checks: every document is ready
      // while the entities are declared, so the removal is what changes it.
      await t().nextly.releases.schedule({
        id: release.id,
        at: LATER,
        timezone: "UTC",
      });
      arranged = { owner, key, releaseId: release.id, members, entries };

      // The deploy of the configuration without them.
      await boot(caseDb(), AFTER_REMOVAL);
    }, 120_000);

    afterEach(async () => {
      clearServices();
      current = undefined;
      await database?.close();
      database = undefined;
      vi.unstubAllEnvs();
      _resetEnvCache();
    });

    /** The two hard problems the removal makes, as a refusal names them. */
    const removedProblems = () => [
      {
        memberId: arranged.members.collection,
        code: "ENTITY_REMOVED_FROM_CODE",
      },
      { memberId: arranged.members.single, code: "ENTITY_REMOVED_FROM_CODE" },
    ];

    it("counts each as a hard problem naming the entity, wherever problems are shown", async () => {
      const expected = [
        {
          memberId: arranged.members.collection,
          code: "ENTITY_REMOVED_FROM_CODE",
          detail: { kind: "collection", slug: REMOVED.collection },
        },
        {
          memberId: arranged.members.single,
          code: "ENTITY_REMOVED_FROM_CODE",
          detail: { kind: "single", slug: REMOVED.single },
        },
      ];
      const shape = (
        findings: ReadonlyArray<{
          memberId: unknown;
          code: unknown;
          detail?: unknown;
        }>
      ) =>
        findings.map(f => ({
          memberId: f.memberId,
          code: f.code,
          detail: f.detail,
        }));

      // Only the removal's problems: none for the kept document, and nothing
      // else about the removed ones.
      const direct = await t().nextly.releases.readiness({
        releaseId: arranged.releaseId,
      });
      expect(shape(direct.hard)).toEqual(expected);

      const overRest = await rest(arranged.key, "GET", [
        "releases",
        arranged.releaseId,
        "readiness",
      ]);
      expect(overRest.status).toBe(200);
      expect(
        shape(
          (
            overRest.json as {
              hard: Array<{ memberId: unknown; code: unknown }>;
            }
          ).hard
        )
      ).toEqual(expected);

      // The releases list reads every release's problems in one batch.
      const [entry] = await t().nextly.releases.readinessOf({
        releaseIds: [arranged.releaseId],
      });
      if (!entry?.checked) throw new Error("the release was not checked");
      expect(shape(entry.hard)).toEqual(expected);
    });

    it("refuses scheduling and Publish now, through REST and the Direct API, and runs nothing", async () => {
      const { releaseId, key } = arranged;
      expect(
        await directProblems(
          t().nextly.releases.schedule({
            id: releaseId,
            at: LATER,
            timezone: "UTC",
          })
        )
      ).toEqual(removedProblems());
      expect(
        restProblems(
          await rest(key, "POST", ["releases", releaseId, "schedule"], {
            at: LATER.toISOString(),
            timezone: "UTC",
          })
        )
      ).toEqual(removedProblems());
      expect(
        await directProblems(t().nextly.releases.publishNow({ id: releaseId }))
      ).toEqual(removedProblems());
      expect(
        restProblems(
          await rest(key, "POST", ["releases", releaseId, "publish"], {})
        )
      ).toEqual(removedProblems());

      expect(
        (await t().nextly.releases.findByID({ id: releaseId }))?.state
      ).toBe("scheduled");
      expect(await storedStatus(`dc_${KEPT}`, arranged.entries.kept)).toBe(
        "draft"
      );
    });

    it("refuses adding such a document to a scheduled release, leaving it as it was", async () => {
      // Another release, holding only the kept collection's document, is
      // scheduled; adding the removed collection's document to it is refused.
      const other = await t().nextly.releases.create({ title: "Other" });
      const kept = await draftEntry(KEPT);
      await t().nextly.releases.addMember({
        releaseId: other.id,
        scopeKind: "collection",
        scopeSlug: KEPT,
        entryId: kept,
        locale: null,
        action: "publish",
        userId: arranged.owner,
      });
      await t().nextly.releases.schedule({
        id: other.id,
        at: LATER,
        timezone: "UTC",
      });
      const before = await t().nextly.releases.findByID({ id: other.id });
      const removedDoc = {
        scopeKind: "collection" as const,
        scopeSlug: REMOVED.collection,
        entryId: arranged.entries.collection,
        locale: null,
        action: "publish" as const,
      };
      const named = [
        {
          memberId: null,
          code: "ENTITY_REMOVED_FROM_CODE",
          document: {
            scopeKind: "collection",
            scopeSlug: REMOVED.collection,
            entryId: arranged.entries.collection,
          },
        },
      ];

      expect(
        await directProblems(
          t().nextly.releases.addMembers({
            releaseId: other.id,
            members: [removedDoc],
            userId: arranged.owner,
          })
        )
      ).toEqual(named);
      expect(
        await directProblems(
          t().nextly.releases.scheduleDocument({
            into: "existing",
            releaseId: other.id,
            document: removedDoc,
            userId: arranged.owner,
          })
        )
      ).toEqual(named);

      const after = await t().nextly.releases.findByID({ id: other.id });
      expect(after).toMatchObject({
        state: "scheduled",
        revision: before?.revision,
      });
      expect(
        (await t().nextly.releases.listMembers({ releaseId: other.id })).map(
          member => member.entryId
        )
      ).toEqual([kept]);
    });

    it("is stopped by the engine's next run, before its time, and its owner told once", async () => {
      const registry = container.get<JobRegistry>("jobRegistry");
      await runJobsPass(t().adapter, registry);

      expect(
        (await t().nextly.releases.findByID({ id: arranged.releaseId }))?.state
      ).toBe("blocked");
      expect(await stopNotices(arranged.releaseId, arranged.owner)).toBe(1);
      // Stopped, not run: nothing of it went live.
      expect(await storedStatus(`dc_${KEPT}`, arranged.entries.kept)).toBe(
        "draft"
      );

      // A second run finds nothing more to stop, and tells nobody again.
      await runJobsPass(t().adapter, registry);
      expect(await stopNotices(arranged.releaseId, arranged.owner)).toBe(1);
    });

    it("schedules again once those documents are taken out", async () => {
      const registry = container.get<JobRegistry>("jobRegistry");
      await runJobsPass(t().adapter, registry);
      for (const memberId of [
        arranged.members.collection,
        arranged.members.single,
      ]) {
        await t().nextly.releases.removeMember({
          releaseId: arranged.releaseId,
          memberId,
        });
      }

      await t().nextly.releases.schedule({
        id: arranged.releaseId,
        at: LATER,
        timezone: "UTC",
      });
      expect(
        (await t().nextly.releases.findByID({ id: arranged.releaseId }))?.state
      ).toBe("scheduled");
    });

    it("reads as ready again once the entities are declared again", async () => {
      await boot(caseDb(), WITH_REMOVED);
      const readiness = await t().nextly.releases.readiness({
        releaseId: arranged.releaseId,
      });
      expect(readiness.hard).toEqual([]);
    });
  }
);
