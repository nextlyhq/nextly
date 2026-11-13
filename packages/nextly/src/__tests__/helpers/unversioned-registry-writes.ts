/**
 * The stored schema version's module, with registry writes run as they are
 * and its count left alone: for unit tests whose adapter doubles hold no
 * `nextly_meta` table and judge only what a registry write puts in its row.
 * Pass it the real module from a `vi.mock` factory:
 *
 *     vi.mock("…/domains/schema/schema-version", async importOriginal =>
 *       (await import("…/__tests__/helpers/unversioned-registry-writes"))
 *         .unversionedRegistryWrites(await importOriginal())
 *     );
 *
 * That every registry write moves the count is held on real databases by
 * `registry-changes-move-the-schema-version.integration.test.ts` and
 * `schema-version-writers.integration.test.ts`.
 */
import type * as SchemaVersion from "../../domains/schema/schema-version";

export function unversionedRegistryWrites(
  actual: typeof SchemaVersion
): typeof SchemaVersion {
  return {
    ...actual,
    // The write alone, outside any transaction the double cannot open.
    writeRegistryRows: (_adapter, work) =>
      work(undefined as unknown as Parameters<typeof work>[0]),
    countRegistryWriteOn: async () => {},
  };
}
