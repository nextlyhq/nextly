/**
 * The DSL's compile-time contract.
 *
 * Checked by `tsc --noEmit` rather than by the vitest runner: the unit config's
 * `include` is `*.test.ts` and `*.spec.ts`, so this file is never executed. It
 * does not need to be — `expectTypeOf` reports through the type checker, and
 * `check-types` compiles this file.
 */
import { describe, expectTypeOf, it } from "vitest";

import type {
  PluginDatabase,
  PluginInsert,
} from "../../../../plugins/database/plugin-database";
import {
  col,
  defineTable,
  type InferInsert,
  type InferRow,
  type TableForeignKeyInput,
} from "../dsl";

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
      id: string;
      verified?: boolean;
      emailAtLink?: string | null;
    }>();
  });

  describe("what the database cannot fill", () => {
    // Evaluated by the checker rather than through `@ts-expect-error`, which
    // would stay green for any error on the line. `{} extends Pick<T, K>` is
    // true exactly when K is optional in T.
    type Insert = InferInsert<typeof identities>;
    type IsOptional<T, K extends keyof T> =
      {} extends Pick<T, K> ? true : false;

    it("requires col.id(), which has no database default", () => {
      expectTypeOf<IsOptional<Insert, "id">>().toEqualTypeOf<false>();
    });

    it("leaves col.timestamps() optional, which the database defaults", () => {
      expectTypeOf<IsOptional<Insert, "createdAt">>().toEqualTypeOf<true>();
      expectTypeOf<IsOptional<Insert, "updatedAt">>().toEqualTypeOf<true>();
    });

    // `ctx.db.insert` fills a missing `col.id()` key, so its insert type
    // leaves it optional; everything else it requires is what `InferInsert`
    // requires.
    it("leaves col.id() optional on a ctx.db insert, which fills it", () => {
      type ViaDb = PluginInsert<typeof identities>;
      expectTypeOf<IsOptional<ViaDb, "id">>().toEqualTypeOf<true>();
      expectTypeOf<IsOptional<ViaDb, "provider">>().toEqualTypeOf<false>();
      expectTypeOf<ViaDb["id"]>().toEqualTypeOf<string | undefined>();
    });
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
      // the key out is still allowed. Both halves are evaluated assignability,
      // so the table failing to infer for another reason breaks the control
      // rather than passing the refusal.
      type Insert = InferInsert<typeof counters>;
      expectTypeOf<Insert["seq"]>().toEqualTypeOf<undefined>();
      expectTypeOf<{ label: string; seq: number }>().not.toExtend<Insert>();
      expectTypeOf<{ label: string }>().toExtend<Insert>();
    });

    it("cannot be given a value through ctx.db, on insert or update", () => {
      // The value types are read off the real method signatures, instantiated
      // for this table, rather than restated: a signature that stopped
      // closing the key fails here even if `InferInsert` still does.
      const db = null as unknown as PluginDatabase;
      type InsertValues = Parameters<typeof db.insert<typeof counters>>[1];
      type InsertRow = Exclude<InsertValues, readonly unknown[]>;
      type UpdateValues = Parameters<typeof db.update<typeof counters>>[1];

      expectTypeOf<InsertRow["seq"]>().toEqualTypeOf<undefined>();
      expectTypeOf<{ label: string; seq: number }>().not.toExtend<InsertRow>();
      expectTypeOf<UpdateValues["seq"]>().toEqualTypeOf<undefined>();
      expectTypeOf<{ seq: number }>().not.toExtend<UpdateValues>();
      // The controls: the same values without the key are accepted.
      expectTypeOf<{ label: string }>().toExtend<InsertRow>();
      expectTypeOf<{ label: string }>().toExtend<UpdateValues>();
    });

    it("leaves every other column's insert type as it was", () => {
      const withId = defineTable("ids", {
        id: col.id(),
        attempts: col.integer({ default: 0 }),
      });
      // A defaulted column stays writable: only `kind: "serial"` closes a key.
      const written: InferInsert<typeof withId> = { id: "x", attempts: 1 };
      void written;
      expectTypeOf<InferInsert<typeof withId>["id"]>().toEqualTypeOf<string>();
    });
  });

  describe("foreign key actions", () => {
    it("offers every action MySQL can create, and not set default", () => {
      // InnoDB refuses SET DEFAULT, so a declaration may not name it.
      expectTypeOf<TableForeignKeyInput["onDelete"]>().toEqualTypeOf<
        "cascade" | "set null" | "restrict" | "no action" | undefined
      >();
      expectTypeOf<TableForeignKeyInput["onUpdate"]>().toEqualTypeOf<
        "cascade" | "set null" | "restrict" | "no action" | undefined
      >();
    });
  });
});
