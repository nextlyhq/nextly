/**
 * One field type change judged the same on every road a Schema Builder change takes: the same
 * class, the same reasons and the same counts. The Builder's schema dialog and the collection update
 * (through the save writer) each refuse `price` changing from text to number over "1", "1.5", "abc"
 * and an empty value, naming the judgement in the same words (`describeClassed`): blocked, with each
 * reason and its count. Each keys the rows by its own ids, so the judgement is compared with them
 * masked and its reasons in one order (`judgementIn`). `nextly migrate`, applying the Builder's file
 * to another database, names it too (`migrate-judges-type-changes.integration.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetSessionStandingForTests } from "../../../../../auth/session/session-standing";
import { dispatchCollections } from "../../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../../services";

import { judgementIn, refusalText } from "./helpers/judgement-in";

const SLUG = "tsr_items";
const VALUES = ["1", "1.5", "abc", null] as const;

let instance: TestNextly | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetSessionStandingForTests();
  await instance?.destroy();
  instance = undefined;
});

/** The entries, one per value; the id of the one holding "abc", which no number reads. */
async function seed(t: TestNextly): Promise<string> {
  let lost = "";
  for (const price of VALUES) {
    const created = (await t.nextly.create({
      collection: SLUG,
      data: { price },
    } as never)) as unknown as { item: { id: unknown } };
    if (price === "abc") lost = String(created.item.id);
  }
  return lost;
}

describe.each(getConfiguredTestDialects())(
  "one type change judged alike on every road (%s)",
  dialect => {
    /** The Builder's road: the dialog's save or the collection update, through the writer. */
    async function builderRoad(caller: "dialog" | "update"): Promise<string> {
      const t = await createTestNextly({
        dialect,
        db: {
          migrationsDir: "./database/history",
          uiSchemaFile: "./schema/builder.json",
        },
      });
      instance = t;
      vi.stubEnv("NODE_ENV", "development");
      await dispatchCollections(
        {} as ServiceContainer,
        "createCollection",
        {},
        { name: SLUG, label: SLUG, fields: [{ name: "price", type: "text" }] }
      );
      const lost = await seed(t);
      const fields = [{ name: "price", type: "number" }];
      const [row] = (await t.adapter.executeQuery(
        `SELECT schema_version AS v FROM dynamic_collections WHERE slug = '${SLUG}'`
      )) as Array<{ v: unknown }>;
      const answer = await (
        caller === "dialog"
          ? dispatchCollections(
              {} as ServiceContainer,
              "applySchemaChanges",
              { collectionName: SLUG },
              { fields, confirmed: true, schemaVersion: Number(row?.v ?? 1) }
            )
          : dispatchCollections(
              {} as ServiceContainer,
              "updateCollection",
              { collectionName: SLUG },
              { fields }
            )
      ).then(
        async a => (a instanceof Response ? ((await a.json()) as unknown) : a),
        (error: unknown) => error
      );
      await t.destroy();
      instance = undefined;
      return judgementIn(refusalText(answer), lost);
    }

    it("names the same judgement from the dialog and the update", async () => {
      const dialog = await builderRoad("dialog");
      // "1.5" is held only rounded by a whole number, and "abc" by no number.
      expect(dialog).toMatch(/^blocked: /);
      expect(dialog).toContain("would be cleared (1 row: id <lost>)");
      expect(await builderRoad("update")).toBe(dialog);
    }, 240_000);
  }
);
