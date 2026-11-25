/**
 * A Single's required relationship and upload, as `nextly repair-columns` reports them on every
 * configured dialect. Today's generator leaves the column nullable, so a Single's table it makes
 * holds no difference there. A release before 0.0.2-alpha.79 made it NOT NULL, as a collection's is
 * made today: that column is named as theirs, converted, and not reported again.
 *
 * The old table is made by the production generator under a collection's name, which writes the
 * same `NOT NULL`, and renamed to the Single's.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { applyRepairs } from "../apply";
import { dryRunReport } from "../run-report";
import type { RepairColumnOrigin, RepairEntity } from "../types";

import { f, tableTools } from "./apply-fixture";

const TABLE = "single_rc_banner";
const AS_COLLECTION = "dc_rc_old_banner";

const TITLE = f({ name: "title", type: "text", required: true });
const TAG = f({
  name: "tag",
  type: "relationship",
  relationTo: "users",
  required: true,
});
const COVER = f({
  name: "cover",
  type: "upload",
  relationTo: "media",
  required: true,
});
/** A list of references: no reference column, so `required` is its column's too. */
const RELATED = f({
  name: "related",
  type: "relationship",
  relationTo: "users",
  hasMany: true,
  required: true,
});
/** A column today's generator still makes differently from its field, on a Single too. */
const RATINGS = f({ name: "ratings", type: "number", hasMany: true });

/** A Single applied and configured as `fields`, made by `origin`. */
function single(
  fields: ReturnType<typeof f>[],
  origin: RepairColumnOrigin = "collection"
): RepairEntity {
  const definition = { fields, localized: false, origin };
  return {
    kind: "single",
    slug: "rc-banner",
    table: TABLE,
    applied: { ...definition, source: "snapshot" },
    configured: definition,
  };
}

const MADE_BEFORE = {
  kind: "legacy",
  shape: "single-required-reference",
  before: "0.0.2-alpha.79",
};

describe.each(getConfiguredTestDialects())(
  "a Single's required relationship and upload on %s",
  dialect => {
    let handle: TestNextly;
    const tools = tableTools(() => handle.adapter, dialect);
    const { q, run } = tools;

    const command = (entities: RepairEntity[]) => ({
      adapter: handle.adapter,
      dialect,
      entities,
      nextlyVersion: "test",
    });
    const causes = async (entity: RepairEntity) =>
      Object.fromEntries(
        (await dryRunReport(command([entity]))).result!.records.map(r => [
          r.column,
          r.cause,
        ])
      );

    /** The table as a release before 0.0.2-alpha.79 made it, holding one entry. */
    async function oldTable() {
      await tools.createTable(AS_COLLECTION, [TITLE, TAG, COVER]);
      await run(`ALTER TABLE ${q(AS_COLLECTION)} RENAME TO ${q(TABLE)}`);
      await tools.insert(TABLE, [
        { id: "b1", title: "Banner", tag: "u1", cover: "m1" },
      ]);
    }

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
    });

    afterEach(async () => {
      await run(`DROP TABLE IF EXISTS ${q(TABLE)}`);
      await run(`DROP TABLE IF EXISTS ${q(AS_COLLECTION)}`);
      await handle?.destroy();
    });

    it("holds no difference in the table today's generator makes", async () => {
      const fields = [TITLE, TAG, COVER, RELATED, RATINGS];
      await tools.createTable(TABLE, fields);

      expect(await causes(single(fields))).toEqual({
        // The control: the report does judge this table, against this generator.
        ratings: { kind: "current-generator", shape: null, before: null },
      });
    });

    it.each<[string, RepairColumnOrigin]>([
      ["the Builder owns", "collection"],
      ["code owns now", "codeFirst"],
    ])(
      "names the release that stopped making it NOT NULL, on a Single %s, and converts it once",
      async (_, origin) => {
        await oldTable();
        const entity = single([TITLE, TAG, COVER], origin);
        // Not read off the report under test: the old columns really are NOT NULL.
        expect((await tools.columnState(TABLE, "tag"))?.nullable).toBe(false);
        expect((await tools.columnState(TABLE, "cover"))?.nullable).toBe(false);

        expect(await causes(entity)).toMatchObject({
          tag: MADE_BEFORE,
          cover: MADE_BEFORE,
        });

        const applied = await applyRepairs(command([entity]));
        const outcomes = Object.fromEntries(
          applied.result!.records.map(r => [r.column, r.outcome])
        );
        expect(outcomes).toMatchObject({
          tag: "converted",
          cover: "converted",
        });
        expect((await tools.columnState(TABLE, "tag"))?.nullable).toBe(true);
        expect((await tools.columnState(TABLE, "cover"))?.nullable).toBe(true);
        expect(await causes(entity)).not.toHaveProperty("tag");
        expect(await causes(entity)).not.toHaveProperty("cover");
      }
    );
  }
);
