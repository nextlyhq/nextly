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
import type { loadDynamicTables } from "../di/load-dynamic-tables";

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
  registerDynamicSchema: (tableName: string, table: unknown) => void;
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

    // Both registries, one pass each, through one loader. They differ only in
    // the table read; spelling the body twice is how the two would drift.
    for (const table of ["dynamic_collections", "dynamic_singles"] as const) {
      await loadInto(deps, table);
    }

    console.log(`${label} Schema registry reloaded from migration metadata.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `${label} Schema registry reload failed: ${msg}. ` +
        `Collections this boot registered are not queryable until a restart.`
    );
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
  const { registerDynamicSchema } = schemaRegistry as {
    registerDynamicSchema: (tableName: string, table: unknown) => void;
  };

  return {
    adapter: adapter as ReloadDeps["adapter"],
    // Bound to the registry, because both are read off the container as
    // untyped services and a bare method reference would lose its receiver.
    registerDynamicSchema: registerDynamicSchema.bind(schemaRegistry),
    dialect: getCapabilities.call(adapter).dialect,
  };
}

/** Read one metadata table and register a runtime schema for each row. */
async function loadInto(
  deps: ReloadDeps,
  table: "dynamic_collections" | "dynamic_singles"
): Promise<void> {
  const { loadDynamicTables } = await import("../di/load-dynamic-tables");
  const { generateRuntimeSchema } = await import(
    "../domains/schema/services/runtime-schema-generator"
  );

  await loadDynamicTables(
    deps.adapter,
    table,
    (tableName, fields, hasStatus, localized) => {
      const { table: runtime } = generateRuntimeSchema(
        tableName,
        fields as Parameters<typeof generateRuntimeSchema>[1],
        deps.dialect,
        { status: hasStatus === true, localized: localized === true }
      );
      deps.registerDynamicSchema(tableName, runtime);
      return Promise.resolve();
    }
  );
}
