/**
 * The runtime table the dev server registers for a Single it has just created describes the table
 * it created: one whose translatable values live in its per-language table carries none of them,
 * so the next query in the same boot names no column the table lacks.
 */
import { getColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { registerSingleTableInResolver } from "../dev-server";

/** An adapter whose resolver keeps what is registered, by table name. */
function adapterKeeping(registered: Map<string, unknown>): DrizzleAdapter {
  return {
    getCapabilities: () => ({ dialect: "sqlite" }),
    tableResolver: {
      registerDynamicSchema: (name: string, table: unknown) =>
        registered.set(name, table),
    },
  } as unknown as DrizzleAdapter;
}

const fields = [
  { name: "tagline", type: "text" },
  { name: "visits", type: "number" },
] as FieldDefinition[];
const logger = { debug: () => {} } as never;

function columnsOf(table: unknown): string[] {
  return Object.values(getColumns(table as never)).map(
    column => (column as { name: string }).name
  );
}

describe("registerSingleTableInResolver", () => {
  it("leaves a translatable column off a Single whose values are kept per language", () => {
    const registered = new Map<string, unknown>();
    registerSingleTableInResolver(
      adapterKeeping(registered),
      "single_site",
      fields,
      logger,
      true
    );
    const columns = columnsOf(registered.get("single_site"));
    expect(columns).toContain("visits");
    expect(columns).not.toContain("tagline");
  });

  it("keeps every column on a Single stored as it is declared", () => {
    const registered = new Map<string, unknown>();
    registerSingleTableInResolver(
      adapterKeeping(registered),
      "single_site",
      fields,
      logger,
      false
    );
    expect(columnsOf(registered.get("single_site"))).toEqual(
      expect.arrayContaining(["tagline", "visits"])
    );
  });
});
