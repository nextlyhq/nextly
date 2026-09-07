/**
 * Re-read the tables a migration registered, so they become queryable.
 *
 * `registerServices` builds the runtime schema registry from
 * `dynamic_collections` / `dynamic_singles` BEFORE either boot path applies
 * migrations, so a migration that registers an entity leaves this process
 * holding a registry that predates it. Such a collection is addressable in the
 * workspace metadata and drawn on a dashboard card while every query against it
 * fails — which is worse than not registering it, because the reader can see it.
 *
 * 🔴 Shared by BOTH boot paths rather than living on the dev one. The dev path
 * has reloaded since it was written; production has never reloaded at all, and
 * the two are the same lifecycle — apply, register, reload — reached from
 * different entry points. Two implementations of it would agree on the day the
 * second was written.
 *
 * @module init/reload-dynamic-tables
 */

// A TYPE-only import, so naming the loader's parameter costs nothing at
// runtime: the specifier is erased, and the loader itself is still imported
// dynamically below to keep it off the boot path until a reload actually runs.
import type { SchemaRegistry } from "../database/schema-registry";
import type {
  DynamicTableLoadResult,
  loadDynamicTables,
} from "../di/load-dynamic-tables";

/**
 * The in-flight reload and the one queued behind it.
 *
 * 🔴 One trailing run rather than handing a late caller the run already going.
 * A caller arriving mid-reload is a boot path that has just committed rows the
 * running pass may have read the tables too early to see — so returning the
 * in-flight promise would leave that caller's own entities missing until a
 * restart, which is the defect this module exists to close. Whoever arrives
 * during a run wants the state after the last of them, and one trailing run
 * delivers that however many arrive.
 *
 * On `globalThis` for the reason the config reload's queue is: a Next.js dev
 * server holds several module registries, and a guard scoped to this module
 * would be several guards.
 */
const globalForReload = globalThis as unknown as {
  __nextly_registryReloadInFlight?: Promise<void>;
  __nextly_registryReloadQueued?: Promise<void>;
};

export function reloadDynamicTables(label: string): Promise<void> {
  // Checked before the running one: the queued run clears itself inside its own
  // continuation, a microtask later than the running one's cleanup, so a caller
  // landing between the two would otherwise start a second concurrent run
  // alongside the queued one.
  const queued = globalForReload.__nextly_registryReloadQueued;
  if (queued) return queued;

  const running = globalForReload.__nextly_registryReloadInFlight;
  if (running) {
    globalForReload.__nextly_registryReloadQueued = running
      // A failed reload must not swallow the rows that landed during it: the
      // tables are read either way, and this caller sees its own outcome.
      .catch(() => undefined)
      .then(() => {
        delete globalForReload.__nextly_registryReloadQueued;
        return startReload(label);
      });
    return globalForReload.__nextly_registryReloadQueued;
  }

  return startReload(label);
}

function startReload(label: string): Promise<void> {
  const started = runReload(label).finally(() => {
    delete globalForReload.__nextly_registryReloadInFlight;
  });
  globalForReload.__nextly_registryReloadInFlight = started;
  return started;
}

/** What a registry reload needs from the container, once both are present. */
interface ReloadDeps {
  adapter: Parameters<typeof loadDynamicTables>[0];
  /**
   * The registry itself, not a bound method off it.
   *
   * The container hands both services back untyped, so they are narrowed ONCE
   * where they are read; carrying the registry whole lets the field-group path
   * register into the same object rather than being handed a second view of it.
   */
  registry: SchemaRegistry;
  dialect: "postgresql" | "mysql" | "sqlite";
}

/**
 * Never throws.
 *
 * 🔴 A failed reload degrades rather than refusing, which is the opposite of
 * how this boot treats a migration it could not establish — and the asymmetry
 * is deliberate. An unverified migration means the process does not know what
 * schema it is serving, so it must not serve. A stale registry means it knows
 * exactly what it is serving and is missing the entities this migration added:
 * every collection that existed before still answers. Refusing to start would
 * turn a bounded, restart-recoverable gap into a total outage.
 *
 * It must also never throw for a mechanical reason: `runProdMigrationsIfEnabled`
 * calls this before `allowBootMigrations()`, and an exception escaping here
 * would leave that gate closed — hanging every consumer waiting on it.
 */
async function runReload(label: string): Promise<void> {
  try {
    const deps = await resolveDeps(label);
    if (!deps) return;

    // Both entity registries, one pass each, through one loader. They differ
    // only in the table read; spelling the body twice is how the two drift.
    let registered = 0;
    const failures: string[] = [];
    for (const table of ["dynamic_collections", "dynamic_singles"] as const) {
      const outcome = await loadInto(deps, table);
      registered += outcome.registered;
      for (const failure of outcome.failures) {
        /*
         * 🔴 A ROW failure counts as much as a read failure. The loader skips a
         * row whose stored `fields` will not parse or whose schema will not
         * generate -- right, because one corrupt row must not cost every other
         * dynamic table its registration -- and the count merely comes back
         * lower. Read off the count alone, one unregisterable collection looks
         * exactly like a database holding one fewer, so the boot logged a
         * completed reload and opened the gate while that entity stayed
         * unqueryable: the defect this module exists to close, one level down
         * from where it was first fixed.
         */
        const where = failure.tableName
          ? `${table}.${failure.tableName}`
          : table;
        const why =
          failure.error instanceof Error
            ? failure.error.message
            : String(failure.error);
        failures.push(`${where}: ${why}`);
      }
    }

    /*
     * 🔴 Field groups go through `registerComponentSchemas`, not a third turn
     * of the loop above. A migration generated from a UI manifest writes
     * `dynamic_components` rows alongside the collection and single ones, and
     * a `comp_` table that is not in the registry is unaddressable exactly as a
     * collection would be. The registration is more than a runtime schema —
     * it resolves the storage rename's type column per table and registers the
     * `_locales` companion for a localized group — and that logic already
     * exists here. Restating the parts of it this module happens to need is
     * how the two would come to disagree.
     */
    const components = await registerComponents(deps, label, failures);

    if (failures.length > 0) {
      console.warn(
        `${label} Schema registry reload INCOMPLETE (${failures.join("; ")}). ` +
          `Entities this boot registered may not be queryable until a restart.`
      );
      return;
    }

    console.log(
      `${label} Schema registry reloaded: ${registered} entities, ` +
        `${components} field groups.`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `${label} Schema registry reload failed: ${msg}. ` +
        `Entities this boot registered are not queryable until a restart.`
    );
  }
}

/**
 * Register every field group's runtime schema, or record why it could not be.
 *
 * Separated because it is the one part of a reload that is NOT a read of a
 * metadata table: it is a whole registration path with its own dependencies,
 * and inlining it put a second subject inside the loop above.
 */
async function registerComponents(
  deps: ReloadDeps,
  label: string,
  failures: string[]
): Promise<number> {
  try {
    const { registerComponentSchemas } = await import(
      "../domains/field-groups/services/register-field-group-schemas"
    );
    return await registerComponentSchemas({
      adapter: deps.adapter,
      registry: deps.registry,
      dialect: deps.dialect,
      logger: {
        debug: (m: string) => console.debug(`${label} ${m}`),
        info: (m: string) => console.log(`${label} ${m}`),
        warn: (m: string) => console.warn(`${label} ${m}`),
        error: (m: string) => console.error(`${label} ${m}`),
      },
    });
  } catch (err) {
    // Recorded rather than thrown: one unregisterable group must not cost the
    // collections and singles their reload, and this function's caller must
    // never throw.
    failures.push(
      `field groups: ${err instanceof Error ? err.message : String(err)}`
    );
    return 0;
  }
}

/** The container's adapter and registry, or `undefined` with a reason logged. */
async function resolveDeps(label: string): Promise<ReloadDeps | undefined> {
  const { container } = await import("../di/container");
  const adapter = container.get("adapter");
  const schemaRegistry = container.get("schemaRegistry");

  if (!schemaRegistry || !adapter) {
    console.warn(
      `${label} ${!schemaRegistry ? "Schema registry" : "Adapter"} not available for reload. ` +
        `Collections this boot registered are not queryable until a restart.`
    );
    return undefined;
  }

  const { getCapabilities } = adapter as {
    getCapabilities: () => { dialect: "postgresql" | "mysql" | "sqlite" };
  };

  return {
    adapter: adapter as ReloadDeps["adapter"],
    registry: schemaRegistry as SchemaRegistry,
    dialect: getCapabilities.call(adapter).dialect,
  };
}

/**
 * Read one metadata table and register a runtime schema per row.
 *
 * Hands the loader's own outcome straight back rather than reducing it here:
 * what this pass registered and what it could not are one answer, and the
 * CALLER is the party that decides whether a failure means the reload is
 * incomplete.
 */
async function loadInto(
  deps: ReloadDeps,
  table: "dynamic_collections" | "dynamic_singles"
): Promise<DynamicTableLoadResult> {
  const { loadDynamicTables } = await import("../di/load-dynamic-tables");
  const { registerDynamicEntitySchema } = await import(
    "../domains/schema/services/register-dynamic-entity"
  );

  /*
   * 🔴 Through the SAME registrar `registerServices` uses, not a runtime schema
   * built here. A localized entity is two Drizzle tables -- the main one omits
   * the translatable columns, which live in `<table>_locales` -- and this
   * registered only the first. `ensureSingleRuntimeTable` adopts an existing
   * registration when both tables are present rather than rebuilding it, so
   * nothing downstream repaired the stale companion: every read and write of a
   * newly migrated localized field addressed a table without those columns
   * until the next restart.
   */
  const kind = table === "dynamic_collections" ? "collection" : "single";

  return loadDynamicTables(
    deps.adapter,
    table,
    async (tableName, fields, hasStatus, localized, builderOwned) => {
      await registerDynamicEntitySchema({
        adapter: deps.adapter,
        registry: deps.registry,
        dialect: deps.dialect,
        kind,
        tableName,
        fields: fields as Parameters<
          typeof registerDynamicEntitySchema
        >[0]["fields"],
        status: hasStatus === true,
        localized,
        builderOwned,
      });
    }
  );
}
