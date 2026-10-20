/**
 * A person erased from the audit trail is erased from the record of content
 * events too, on every configured dialect.
 *
 * An event keeps who did it and the name they had then, for as long as its
 * subject exists. When a staff account is deleted, its events keep the
 * account's id as the opaque reference that tells one actor from another, and
 * lose the name. When a plugin reports one of its people deleted, their events
 * lose the name and name them by the keyed digest the audit trail uses, so the
 * plugin's own id for them (which may be an address) is kept nowhere. Every
 * other actor's events stay as they were.
 */

// Read by the deletion report's digest through the env proxy: set before any
// of it is imported. A throwaway value, made for this file.
// Every write here uses it too, as an install's writes and deletions share
// one: a staff deletion opens the digest key with the env's secrets.
const SECRET = (process.env.NEXTLY_SECRET ??=
  "test-secret-must-be-at-least-32-characters-long!!");

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { reportPrincipalDeleted } from "../../audit/erase-principal";
import { UserMutationService } from "../../users/services/user-mutation-service";
import type { ContentEventActor } from "../actor";
import { registerContentEventKind, resetContentEventKinds } from "../kinds";

import { recordAsACaller } from "./record-as-a-caller";

const silentLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

let current: TestNextly | undefined;

beforeEach(() => {
  resetContentEventKinds();
  registerContentEventKind({ name: "saved", label: "Saved" });
});

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetContentEventKinds();
});

interface Row {
  actorKind: string;
  actorId: string | null;
  actorPrincipalKind: string | null;
  actorName: string | null;
}

async function setup(dialect: (typeof dialects)[number]) {
  current = await createTestNextly({ dialect });
  const now = new Date();
  for (const id of ["leaving", "staying"]) {
    await current.adapter.insert("users", {
      id,
      email: `${id}@x.test`,
      name: id,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  const record = (actor: ContentEventActor) =>
    recordAsACaller(
      current!,
      dialect,
      {
        subject: { kind: "collection", slug: "posts", id: "e1" },
        kind: "saved",
        actor,
      },
      [SECRET]
    );
  const rows = async () =>
    (await current!.adapter.select<Row>("nextly_content_events"))
      .map(({ actorKind, actorId, actorPrincipalKind, actorName }) => ({
        actorKind,
        actorId,
        actorPrincipalKind,
        actorName,
      }))
      .sort((a, b) => (a.actorName ?? "").localeCompare(b.actorName ?? ""));
  return { record, rows };
}

const dialects = getConfiguredTestDialects();

describe.each(dialects)(
  "erasing a person from the record of content events (integration, %s)",
  dialect => {
    it("keeps a deleted staff account's id and drops its name, leaving others alone", async () => {
      const t = await setup(dialect);
      await t.record({ kind: "person", id: "leaving", name: "Leaving Lee" });
      await t.record({ kind: "person", id: "staying", name: "Staying Sam" });

      await new UserMutationService(current!.adapter, silentLogger).deleteUser(
        "leaving"
      );

      const rows = await t.rows();
      expect(rows).toContainEqual({
        actorKind: "person",
        actorId: "leaving",
        actorPrincipalKind: null,
        actorName: null,
      });
      expect(rows).toContainEqual({
        actorKind: "person",
        actorId: "staying",
        actorPrincipalKind: null,
        actorName: "Staying Sam",
      });
    }, 120_000);

    it("names a deleted plugin-defined person by digest, keeping neither their id nor their name", async () => {
      const t = await setup(dialect);
      await t.record({
        kind: "principal",
        principalKind: "shop:customer",
        id: "kim@example.com",
        name: "Kim",
      });
      await t.record({
        kind: "principal",
        principalKind: "shop:customer",
        id: "lee@example.com",
        name: "Lee",
      });
      // A staff account that happens to share the id is somebody else.
      await t.record({ kind: "person", id: "kim@example.com", name: "Staff" });

      await reportPrincipalDeleted(
        { kind: "shop:customer", id: "kim@example.com" },
        { adapter: current!.adapter as never, secrets: [SECRET] }
      );

      const rows = await t.rows();
      const erased = rows.find(
        r => r.actorKind === "principal" && r.actorName === null
      );
      expect(erased?.actorId).toMatch(/^[0-9a-f]{64}$/);
      const [kept] = await current!.adapter.select<{ digest: string }>(
        "nextly_deleted_principals"
      );
      expect(erased?.actorId).toBe(kept?.digest);
      expect(JSON.stringify(rows)).not.toContain("Kim");
      expect(
        rows.filter(r => r.actorId === "kim@example.com").map(r => r.actorKind)
      ).toEqual(["person"]);
      expect(rows).toContainEqual({
        actorKind: "principal",
        actorId: "lee@example.com",
        actorPrincipalKind: "shop:customer",
        actorName: "Lee",
      });
    }, 120_000);

    it("writes an event by a person reported deleted already erased, naming them by digest", async () => {
      const t = await setup(dialect);
      await reportPrincipalDeleted(
        { kind: "shop:customer", id: "kim@example.com" },
        { adapter: current!.adapter as never, secrets: [SECRET] }
      );

      await t.record({
        kind: "principal",
        principalKind: "shop:customer",
        id: "kim@example.com",
        name: "Kim",
      });

      const [kept] = await current!.adapter.select<{ digest: string }>(
        "nextly_deleted_principals"
      );
      expect(await t.rows()).toEqual([
        {
          actorKind: "principal",
          actorId: kept?.digest,
          actorPrincipalKind: "shop:customer",
          actorName: null,
        },
      ]);
    }, 120_000);
  }
);
