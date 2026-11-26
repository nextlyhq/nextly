/**
 * A suite on both kinds of site: a new one, whose field groups are on the current names, and one an
 * earlier release set up, whose groups stay on the legacy names until the storage migration moves
 * them. Most installed sites are the second kind, so what must hold on both is declared once and
 * run on each.
 *
 * A legacy site is seeded as that release left it (`seedLegacyCoreTables`): its core tables before
 * the first start, which then keeps the storage it finds.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { FieldGroupNaming } from "../../services/field-group-storage-names";

import { openDatabase, seedLegacyCoreTables } from "./storage-generation-site";

/** Each configured dialect with each kind of site, for `describe.each`. */
export function eachSite(): [TestDialect, FieldGroupNaming][] {
  return getConfiguredTestDialects().flatMap(dialect =>
    (["current", "legacy"] as const).map(
      (naming): [TestDialect, FieldGroupNaming] => [dialect, naming]
    )
  );
}

/**
 * {@link createTestNextly} on a new site, or on a database of its own that an earlier release set
 * up, dropped with the instance.
 */
export async function createTestNextlyOnSite(
  naming: FieldGroupNaming,
  options: Parameters<typeof createTestNextly>[0] & { dialect: TestDialect }
): Promise<TestNextly> {
  if (naming === "current") return createTestNextly(options);
  const { dialect, ...rest } = options;
  const database = await openDatabase(dialect);
  await seedLegacyCoreTables(database.adapter, dialect);
  const instance = await createTestNextly({
    ...rest,
    adapter: database.adapter as never,
  });
  const destroy = instance.destroy.bind(instance);
  instance.destroy = async () => {
    await destroy();
    await database.close();
  };
  return instance;
}

/** An earlier release's core tables on a suite's own empty database, where its site is legacy. */
export async function seedSite(
  naming: FieldGroupNaming,
  adapter: DrizzleAdapter,
  dialect: TestDialect
): Promise<void> {
  if (naming === "legacy") await seedLegacyCoreTables(adapter, dialect);
}
