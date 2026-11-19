/**
 * A collection list's review filters (R-11): `_assignedToMe` keeps the documents with a part
 * assigned to the reader or to one of their roles, as the waiting list counts "mine"; the list and
 * its count agree; a collection no workflow holds matches nothing, with no refusal. On every
 * configured dialect.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { workflowDefinitionHash } from "../hash";

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

const HASH = workflowDefinitionHash(editorial);

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

/** The ids a list with `where` keeps for the person `userId`, and its count. */
async function listedFor(
  app: TestNextly,
  collection: string,
  userId: string,
  where: Record<string, unknown>
): Promise<{ ids: string[]; total: number }> {
  const asReader = {
    collection,
    where,
    status: "all",
    overrideAccess: false,
    user: { id: userId },
  } as never;
  const listed = await app.nextly.find(asReader);
  const counted = (await app.nextly.count(asReader)) as { total: number };
  return {
    ids: listed.items.map(item => String(item.id)).sort(),
    total: counted.total,
  };
}

describe.each(getConfiguredTestDialects())(
  "a list's review filters (%s)",
  dialect => {
    it("keeps the documents assigned to the reader or one of their roles, and counts what it lists", async () => {
      t = await bootSteps(dialect, undefined, { collections: [ledgers] });
      await person(t, "sam", [
        ["read", "pages"],
        ["sign-off", "pages"],
        ["read", "ledgers"],
      ]);
      const desk = await role(t, "legal-desk", [["sign-off", "pages"]]);
      await giveRole(t, "sam", desk);
      const toSam = await entry(t, "pages");
      const toDesk = await entry(t, "pages");
      const toAlice = await entry(t, "pages");
      const unassigned = await entry(t, "pages");
      for (const [id, assignee] of [
        [toSam, { kind: "user" as const, id: "sam" }],
        [toDesk, { kind: "role" as const, id: desk }],
        [toAlice, { kind: "user" as const, id: "alice" }],
        [unassigned, undefined],
      ] as const) {
        await seedState(t, partOf("pages", id, null), "legal", {
          definitionHash: HASH,
          ...(assignee ? { assignee } : {}),
        });
      }

      const mine = await listedFor(t, "pages", "sam", { _assignedToMe: true });
      expect(mine.ids).toEqual([toSam, toDesk].sort());
      expect(mine.total).toBe(2);

      // A collection no workflow holds has nothing assigned to anyone: nothing, and no refusal.
      const none = await listedFor(t, "ledgers", "sam", {
        _assignedToMe: true,
      });
      expect(none).toEqual({ ids: [], total: 0 });
    });
  }
);
