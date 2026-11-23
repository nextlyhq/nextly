/**
 * `migrate:field-groups --apply --backup-confirmed` in a process of its own, so a suite can kill
 * it part-way and see what the run leaves behind.
 *
 * Usage: `migration-stop-child.ts <dialect> <url> <per-language storage: on|off> <leaseSeconds>`,
 * with `NEXTLY_TEST_KILL_AT` naming the stop point it kills itself at. It wires the adapter as the
 * command does (both spellings of the field-group registry resolvable) and runs the engine with a
 * short schema-lock lease, so the run that resumes after a kill finds the lock lapsed in seconds
 * rather than after the production lease. When the run ends it prints `ended ok <steps>`, or
 * `ended error <code>`.
 *
 * @module domains/field-groups/migration/__tests__/helpers/migration-stop-child
 */
const [dialect, url, layout, lease] = process.argv.slice(2) as [
  "sqlite" | "postgresql" | "mysql",
  string,
  "on" | "off",
  string,
];

// Stop points act only under the test environment, as in the suite's own process.
Object.assign(process.env, { NODE_ENV: "test" });
process.env.DB_DIALECT = dialect;
if (dialect !== "sqlite") process.env.DATABASE_URL = url;

const { createAdapter } = await import("../../../../../database/factory");
const { loadDialectTables } = await import(
  "../../../../../database/dialect-tables"
);
const { getDialectTables } = await import("../../../../../database/index");
const { SchemaRegistry } = await import(
  "../../../../../database/schema-registry"
);
const { setPerLanguageStorage } = await import(
  "../../../../i18n/per-language-storage"
);
const { getFieldGroupRegistryAliases } = await import(
  "../../../storage/registry-schemas"
);
const { runFieldGroupMigration } = await import("../../run");

setPerLanguageStorage(layout === "on");
await loadDialectTables(dialect);
const adapter = (await createAdapter({
  type: dialect,
  url,
} as never)) as never as {
  getCapabilities(): { dialect: "sqlite" | "postgresql" | "mysql" };
  setTableResolver(resolver: unknown): void;
};
const registry = new SchemaRegistry(dialect);
registry.registerStaticSchemas({
  ...getDialectTables(dialect),
  ...getFieldGroupRegistryAliases(dialect),
});
adapter.setTableResolver(registry);

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
try {
  const outcome = await runFieldGroupMigration({
    adapter: adapter as never,
    logger: quiet as never,
    direction: "up",
    dryRun: false,
    backupConfirmed: true,
    leaseSeconds: Number(lease),
  });
  console.log(
    `ended ok ${"steps" in outcome ? String(outcome.steps) : outcome.reason}`
  );
  process.exit(0);
} catch (error) {
  const e = error as { code?: unknown };
  console.log(`ended error ${String(e.code ?? "UNKNOWN")}`);
  process.exit(1);
}
