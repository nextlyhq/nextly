/**
 * Each part the waiting list names carries its document's title as the reader reads it, and whom it
 * waits for, named as the document's own review read names it. A title a rule withholds from the
 * reader is "Untitled", never the title itself; and the titles and names of a page cost the same
 * statements for 3 items as for 15, on every configured dialect.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it, vi } from "vitest";

import { statementsOf } from "../../../database/__tests__/integration/helpers/count-statements";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { storedSchemaSeq } from "../../schema/stored-schema-seq";
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
  vi.useRealTimers();
  await t?.destroy();
  t = undefined;
});

type Item = {
  document: { entryId: string };
  title: string | null;
  waitingFor: unknown;
};

/** A page of what waits for the person `userId`, as the waiting list's route answers it. */
async function waitingFor(userId: string, limit = 50): Promise<Item[]> {
  const { waitingPage } = await import("../../../api/workflows");
  const { items } = await waitingPage(
    {
      user: { id: userId } as never,
      scope: undefined,
      caller: { kind: "user", userId },
    },
    { page: 1, limit }
  );
  return items as unknown as Item[];
}

describe.each(getConfiguredTestDialects())(
  "the waiting list's titles and names (%s)",
  dialect => {
    it("names each item's document by its title, and whom it waits for as its review read does", async () => {
      t = await bootSteps(dialect);
      const desk = await role(t, "legal-desk", [["sign-off", "pages"]]);
      await person(t, "sam", [
        ["read", "pages"],
        ["sign-off", "pages"],
      ]);
      // Sam is on the legal desk the part is assigned to, so it waits for him through it.
      await giveRole(t, "sam", desk);
      const id = (
        (await t.nextly.create({
          collection: "pages",
          data: { title: "Pricing FAQ" },
        })) as unknown as { item: { id: string } }
      ).item.id;
      await seedState(t, partOf("pages", id, null), "legal", {
        definitionHash: HASH,
        assignee: { kind: "role", id: desk },
      });

      const [item] = await waitingFor("sam");
      expect(item?.title).toBe("Pricing FAQ");
      expect(item?.waitingFor).toEqual({
        kind: "roles",
        roles: [{ id: desk, name: "legal-desk" }],
      });
    });

    it("titles a document whose title a rule withholds from the reader Untitled, never the title", async () => {
      t = await bootSteps(dialect);
      await person(t, "sam", [
        ["read", "dockets"],
        ["sign-off", "dockets"],
      ]);
      const created = (await t.nextly.create({
        collection: "dockets",
        data: { title: "Sealed settlement", level: "restricted" },
      })) as unknown as { item: { id: string } };
      await seedState(t, partOf("dockets", created.item.id, null), "legal", {
        definitionHash: HASH,
      });

      const items = await waitingFor("sam");
      const docket = items.find(
        item => item.document.entryId === created.item.id
      );
      expect(docket?.title).toBe("Untitled");
    });

    it("names a page's titles and whom each waits for in as many statements for 15 items as for 3", async () => {
      t = await bootSteps(dialect);
      await person(t, "sam", [
        ["read", "pages"],
        ["sign-off", "pages"],
      ]);
      // Every item a distinct document, unassigned, so each waits for the roles holding Clear: the
      // titles are 15 to read, in one read per collection, and the names one read for the page.
      // (Items assigned to 15 distinct people or roles cost their assignees' permission reads too,
      // which the waiting list's own batching answers for.)
      const seed = async (count: number) => {
        for (let n = 0; n < count; n += 1) {
          await seedState(
            t!,
            partOf("pages", await entry(t!, "pages"), null),
            "legal",
            {
              definitionHash: HASH,
            }
          );
        }
      };
      const counted = async () => {
        // The stored schema count's clock is frozen, as in the waiting list's own count tests.
        vi.useFakeTimers({ toFake: ["performance"] });
        try {
          await storedSchemaSeq(t!.adapter, { fresh: true });
          await waitingFor("sam");
          return await statementsOf(dialect, () => waitingFor("sam"));
        } finally {
          vi.useRealTimers();
        }
      };

      await seed(3);
      const few = await counted();
      await seed(12);
      const many = await counted();
      expect(
        many.length,
        `3 items:\n${few.join("\n")}\n\n15 items:\n${many.join("\n")}`
      ).toBe(few.length);
    });
  }
);
