/**
 * A collection list's `_waitingForMe` filter keeps the documents with a part waiting for the
 * reader, by the waiting list's own read (what waits for whom, and what the reader may read), so
 * the list and the "Waiting for my review" view cannot disagree. The list and its count agree.
 * An API key is judged by its own scope: a key scoped to one of its owner's roles keeps only that
 * role's work, never the owner's other roles' or the owner's own, and a scope that names no key
 * keeps nothing. A collection no workflow holds keeps nothing. On every configured dialect.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { apiKeyScope } from "../../../auth/authenticated-scope";
import { defineCollection, text } from "../../../config";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { permissionSlug } from "../../../schemas/_zod/rbac";
import type { ApiKeyService } from "../../auth/services/api-key-service";
import { workflowDefinitionHash } from "../hash";
import { entityOf } from "../implicit-stage";

import {
  bootSteps,
  entry,
  giveRole,
  partOf,
  person,
  role,
  seedState,
} from "./helpers/step-harness";
import { editorial } from "./helpers/step-workflows";

// Written for per-language storage, as every installation runs it (`storage-layout`).
perLanguageStorageSuite();

const HASH = workflowDefinitionHash(editorial);
const WAITING = { _waitingForMe: true };

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** A collection no workflow holds. */
const ledgers = defineCollection({
  slug: "ledgers",
  fields: [text({ name: "title" })],
});

/** The ids a Direct API list keeps under `where` for the person `userId`, and its count. */
async function listedFor(
  app: TestNextly,
  collection: string,
  userId: string,
  where: Record<string, unknown>,
  scope?: ReturnType<typeof apiKeyScope>
): Promise<{ ids: string[]; total: number }> {
  const read = {
    collection,
    where,
    status: "all",
    overrideAccess: false,
    user: { id: userId },
    ...(scope === undefined ? {} : { actor: scope }),
  } as never;
  const listed = await app.nextly.find(read);
  const counted = (await app.nextly.count(read)) as { total: number };
  return {
    ids: listed.items.map(item => String(item.id)).sort(),
    total: counted.total,
  };
}

/** The ids a REST list of `collection` keeps under `where` for a key scoped to `roleId`. */
async function listedForKey(
  app: TestNextly,
  collection: string,
  key: { owner: string; roleId: string },
  where: Record<string, unknown>
): Promise<{ ids: string[]; total: number }> {
  const keys = app.getService("apiKeyService") as unknown as ApiKeyService;
  const { key: token } = await keys.createApiKey(key.owner, {
    name: `key of ${key.owner}`,
    tokenType: "role-based",
    roleId: key.roleId,
    expiresIn: "unlimited",
  });
  const path = ["collections", collection, "entries"];
  const response = await createDynamicHandlers().GET(
    new Request(
      `http://localhost/api/${path.join("/")}?status=all&where=${encodeURIComponent(JSON.stringify(where))}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          origin: "http://localhost",
        },
      }
    ),
    { params: Promise.resolve({ params: path }) }
  );
  const json = (await response.json()) as {
    items?: { id: unknown }[];
    meta?: { total?: number };
    error?: unknown;
  };
  if (response.status >= 400) {
    throw new Error(`list refused: ${response.status} ${JSON.stringify(json)}`);
  }
  return {
    ids: (json.items ?? []).map(item => String(item.id)).sort(),
    total: Number(json.meta?.total),
  };
}

describe.each(getConfiguredTestDialects())(
  "a list's waiting filter (%s)",
  dialect => {
    it("keeps the documents with a part waiting for the reader, and counts what it lists", async () => {
      t = await bootSteps(dialect, undefined, { collections: [ledgers] });
      await person(t, "sam", [
        ["read", "pages"],
        ["sign-off", "pages"],
        ["read", "ledgers"],
      ]);
      // Bob may clear legal checks too: work assigned to him waits for him, not for Sam.
      await person(t, "bob", [
        ["read", "pages"],
        ["sign-off", "pages"],
      ]);
      const unassigned = await entry(t, "pages");
      const toSam = await entry(t, "pages");
      const toBob = await entry(t, "pages");
      // In Writing, whose step needs an update Sam does not hold.
      const writing = await entry(t, "pages");
      for (const [id, stage, assignee] of [
        [unassigned, "legal", undefined],
        [toSam, "legal", { kind: "user" as const, id: "sam" }],
        [toBob, "legal", { kind: "user" as const, id: "bob" }],
        [writing, "writing", undefined],
      ] as const) {
        await seedState(t, partOf("pages", id, null), stage, {
          definitionHash: HASH,
          ...(assignee ? { assignee } : {}),
        });
      }

      expect(await listedFor(t, "pages", "sam", WAITING)).toEqual({
        ids: [unassigned, toSam].sort(),
        total: 2,
      });
      expect(await listedFor(t, "pages", "bob", WAITING)).toEqual({
        ids: [unassigned, toBob].sort(),
        total: 2,
      });
      // A collection no workflow holds has nothing waiting: nothing, and no refusal.
      expect(await listedFor(t, "ledgers", "sam", WAITING)).toEqual({
        ids: [],
        total: 0,
      });
    });

    it("marks the list's total a floor when there is more waiting than the filter reads", async () => {
      // 1,001 pages waiting for Sam: one more than the filter reads at most, so the list keeps the
      // documents it read and says that more may wait. One page is created; the rest are copies
      // of its row under new ids, written at once, so the case stays quick.
      t = await bootSteps(dialect);
      const app = t;
      await person(app, "sam", [
        ["read", "pages"],
        ["sign-off", "pages"],
      ]);
      const first = await entry(app, "pages");
      const entity = await entityOf({
        scopeKind: "collection",
        scopeSlug: "pages",
      });
      if (!entity) throw new Error("no pages in the registry");
      const row = await app.adapter.selectOne<Record<string, unknown>>(
        entity.tableName,
        { where: { and: [{ column: "id", op: "=", value: first }] } }
      );
      if (!row) throw new Error("no row for the first page");
      const ids = [first, ...Array.from({ length: 1000 }, () => randomUUID())];
      // In batches, each under SQLite's 999 bound values however many columns a row has.
      // Each under a slug of its own, which the table keeps unique.
      const copies = ids
        .slice(1)
        .map(id => ({ ...row, id, slug: `page-${id}` }));
      for (let at = 0; at < copies.length; at += 25) {
        await app.adapter.insertMany(
          entity.tableName,
          copies.slice(at, at + 25)
        );
      }
      for (const id of ids) {
        await seedState(app, partOf("pages", id, null), "legal", {
          definitionHash: HASH,
        });
      }

      const listed = await app.nextly.find({
        collection: "pages",
        where: WAITING,
        status: "all",
        overrideAccess: false,
        user: { id: "sam" },
        limit: 5,
      } as never);
      expect(listed.items).toHaveLength(5);
      expect(listed.meta).toMatchObject({ totalCapped: true });
    });

    it("leaves out a part in a language the reader may not read, from the waiting list and its count alike", async () => {
      // Letters are read in every language but Spanish. A Spanish part waiting in Legal check is
      // not Sam's to see: neither the waiting list nor the list's filter names or counts it.
      t = await bootSteps(dialect);
      await person(t, "sam", [
        ["read", "letters"],
        ["sign-off", "letters"],
      ]);
      const spanishOnly = await entry(t, "letters");
      await seedState(t, partOf("letters", spanishOnly, "es"), "legal", {
        definitionHash: HASH,
      });
      const english = await entry(t, "letters");
      await seedState(t, partOf("letters", english, "en"), "legal", {
        definitionHash: HASH,
      });

      const waiting = (await t.nextly.workflows.waiting({
        overrideAccess: false,
        user: { id: "sam" },
        limit: 20,
      } as never)) as unknown as {
        items: { document: { entryId: string }; part: string | null }[];
        meta: { total: number };
      };
      expect(
        waiting.items.map(item => [item.document.entryId, item.part])
      ).toEqual([[english, "en"]]);
      expect(waiting.meta.total).toBe(1);

      expect(await listedFor(t, "letters", "sam", WAITING)).toEqual({
        ids: [english],
        total: 1,
      });
    });

    it("keeps for a key scoped to one role only that role's work, and nothing for a scope that names no key", async () => {
      t = await bootSteps(dialect);
      await person(t, "olga", []);
      const deskA = await role(t, "desk-a", [
        ["read", "pages"],
        ["update", "pages"],
      ]);
      const deskB = await role(t, "desk-b", [
        ["read", "pages"],
        ["update", "pages"],
      ]);
      await giveRole(t, "olga", deskA);
      await giveRole(t, "olga", deskB);
      const toA = await entry(t, "pages");
      const toB = await entry(t, "pages");
      const toOlga = await entry(t, "pages");
      for (const [id, assignee] of [
        [toA, { kind: "role" as const, id: deskA }],
        [toB, { kind: "role" as const, id: deskB }],
        [toOlga, { kind: "user" as const, id: "olga" }],
      ] as const) {
        await seedState(t, partOf("pages", id, null), "writing", {
          definitionHash: HASH,
          assignee,
        });
      }

      // The key acts as desk-a alone: not the owner's other role's work, nor the owner's own.
      expect(
        await listedForKey(
          t,
          "pages",
          { owner: "olga", roleId: deskA },
          WAITING
        )
      ).toEqual({ ids: [toA], total: 1 });
      // Olga herself, as a person, has all three waiting.
      expect(await listedFor(t, "pages", "olga", WAITING)).toEqual({
        ids: [toA, toB, toOlga].sort(),
        total: 3,
      });
      // A key's scope built by hand names no key: nothing, and no refusal.
      const handBuilt = apiKeyScope(
        [
          ["read", "pages"],
          ["update", "pages"],
        ].map(([action, resource]) => ({
          slug: permissionSlug(action, resource),
          action,
          resource,
        })),
        ["desk-a"]
      );
      expect(await listedFor(t, "pages", "olga", WAITING, handBuilt)).toEqual({
        ids: [],
        total: 0,
      });
    });
  }
);
