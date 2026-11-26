/**
 * A development start judges a field group unchanged against the registry row as the sync writes
 * it: naming the table the group is stored in.
 *
 * A group created under the other naming keeps its table when a site's storage moves (its row
 * names `comp_<slug>` in a registry on the current names, say). Described by its slug's name
 * under the site's naming, the declared row never matched the stored one, so every start took
 * the group for changed and did its full work.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, describe, expect, it, vi } from "vitest";

// The registry holds `card` under the legacy table, in a registry on the current names.
vi.mock(
  "../../domains/field-groups/services/field-group-stored-tables",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../domains/field-groups/services/field-group-stored-tables")
    >()),
    readStoredFieldGroupTables: vi.fn(async () => ({
      tables: new Map([["card", "comp_card"]]),
      usable: true,
      naming: "current",
    })),
  })
);
vi.mock(
  "../../domains/field-groups/services/field-group-storage-names",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import("../../domains/field-groups/services/field-group-storage-names")
      >();
    return {
      ...actual,
      resolveFieldGroupStorageNames: vi.fn(async () =>
        actual.storageNamesFor("current")
      ),
    };
  }
);

import { readStartFingerprints } from "../boot-apply";

/** An adapter whose `nextly_meta` holds no start record yet. */
const adapter = {
  dialect: "sqlite",
  getDrizzle: () => ({
    select: () => ({ from: () => ({ where: async () => [] }) }),
  }),
} as unknown as DrizzleAdapter;

const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a development start's field-group fingerprint", () => {
  it("describes a group's row with the table its registry row names", async () => {
    vi.stubEnv("NODE_ENV", "development");

    await readStartFingerprints(
      adapter,
      silent as never,
      { fieldGroups: [{ slug: "card", fields: [] }] } as never,
      null
    );

    const state = (
      globalThis as unknown as {
        __nextly_startFingerprints?: {
          declared: Record<string, { tableName: string }>;
        };
      }
    ).__nextly_startFingerprints;
    expect(state?.declared["fieldGroup:card"]?.tableName).toBe("comp_card");
  });
});
