/**
 * The DSL's compile-time contract.
 *
 * Checked by `tsc --noEmit` rather than by the vitest runner: the unit config's
 * `include` is `*.test.ts` and `*.spec.ts`, so this file is never executed. It
 * does not need to be — `expectTypeOf` reports through the type checker, and
 * `check-types` compiles this file.
 */
import { describe, expectTypeOf, it } from "vitest";

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
});
