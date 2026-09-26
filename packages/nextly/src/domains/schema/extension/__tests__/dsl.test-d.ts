/**
 * The DSL's compile-time contract.
 *
 * Checked by `tsc --noEmit` rather than by the vitest runner: the unit config's
 * `include` is `*.test.ts` and `*.spec.ts`, so this file is never executed. It
 * does not need to be — `expectTypeOf` reports through the type checker, and
 * `check-types` compiles this file.
 */
import { describe, expectTypeOf, it } from "vitest";

import type { PluginDatabase } from "../../../../plugins/database/plugin-database";
import { col, defineTable, type InferInsert, type InferRow } from "../dsl";

const identities = defineTable(
  "identities",
  {
    id: col.id(),
    provider: col.shortText(),
    providerAccountId: col.shortText(),
    userId: col.ref("users"),
    emailAtLink: col.text({ nullable: true }),
    verified: col.boolean({ default: false }),
    attempts: col.integer({ default: 0 }),
    score: col.decimal(10, 2, { nullable: true }),
    metadata: col.json<{ tid?: string }>({ nullable: true }),
    ...col.timestamps(),
  },
  {
    indexes: [
      { columns: ["provider", "providerAccountId"], unique: true },
      { columns: ["userId"] },
    ],
  }
);

describe("DSL types", () => {
  it("infers the selected row", () => {
    expectTypeOf<InferRow<typeof identities>>().toEqualTypeOf<{
      id: string;
      provider: string;
      providerAccountId: string;
      userId: string;
      emailAtLink: string | null;
      verified: boolean;
      attempts: number;
      score: number | null;
      metadata: { tid?: string } | null;
      createdAt: Date;
      updatedAt: Date;
    }>();
  });

  it("makes defaulted and nullable columns optional on insert", () => {
    expectTypeOf<InferInsert<typeof identities>>().toMatchTypeOf<{
      provider: string;
      providerAccountId: string;
      userId: string;
      id?: string;
      verified?: boolean;
      emailAtLink?: string | null;
    }>();
  });

  describe("a col.serial() key", () => {
    const counters = defineTable("counters", {
      seq: col.serial(),
      label: col.shortText(),
    });

    it("is still on the row a read returns", () => {
      expectTypeOf<InferRow<typeof counters>>().toEqualTypeOf<{
        seq: number;
        label: string;
      }>();
    });

    it("cannot be given a value on insert", () => {
      // `never` is the property: a value of any type is refused, and leaving
      // the key out is still allowed.
      expectTypeOf<
        InferInsert<typeof counters>["seq"]
      >().toEqualTypeOf<undefined>();
      const omitted: InferInsert<typeof counters> = { label: "a" };
      void omitted;
      const written: InferInsert<typeof counters> = {
        label: "a",
        // @ts-expect-error -- a database-assigned key cannot be written
        seq: 1,
      };
      void written;
    });

    it("cannot be given a value through ctx.db, on insert or update", () => {
      // Never called: the assertions are the type checker's, on the real
      // method signatures rather than on a restatement of them.
      function writes(db: PluginDatabase) {
        void db.insert(counters, {
          label: "a",
          // @ts-expect-error -- a database-assigned key cannot be inserted
          seq: 1,
        });
        void db.update(counters, {
          // @ts-expect-error -- a database-assigned key cannot be updated
          seq: 2,
        });
        // The controls: the same calls without the key compile.
        void db.insert(counters, { label: "a" });
        void db.update(counters, { label: "b" });
      }
      void writes;
    });

    it("leaves every other column's insert type as it was", () => {
      const withId = defineTable("ids", {
        id: col.id(),
        attempts: col.integer({ default: 0 }),
      });
      // A defaulted column stays writable: only `kind: "serial"` closes a key.
      const written: InferInsert<typeof withId> = { id: "x", attempts: 1 };
      void written;
      expectTypeOf<InferInsert<typeof withId>["id"]>().toEqualTypeOf<
        string | undefined
      >();
    });
  });
});
