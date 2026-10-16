/**
 * Pending migrations run before any plugin initialises.
 *
 * This is an ORDERING property, so it is asserted by watching the sequence
 * rather than by reading the code: a comment saying "before" is exactly what
 * was there while the opposite was true.
 *
 * `record-settings-activity.ts` documented the hazard for core columns — an
 * upgraded database whose `activity_log` had not migrated, and a plugin `init`
 * inserting into a column that did not exist yet. With plugin-owned tables it
 * stops being a hazard and becomes fatal: `init` and `onReady` would query
 * tables no migration has created.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// Read with node rather than through a `?raw` import: that is a bundler
// feature with no type, and `check-types` compiles this file with plain tsc.
const registerFile = fileURLToPath(new URL("../register.ts", import.meta.url));
const registerAst = ts.createSourceFile(
  registerFile,
  readFileSync(registerFile, "utf8"),
  ts.ScriptTarget.Latest,
  true
);

/**
 * Printed without comments, so a call that only survives in a comment — a
 * line commented out, or a sentence naming the call — is not found as code.
 */
const printer = ts.createPrinter({ removeComments: true });

/** `register.ts` as code alone. */
const registerSource = printer.printFile(registerAst);

/**
 * The code of one top-level function in `register.ts`, exported or not.
 *
 * Taken from the parsed declaration rather than sliced between two matches in
 * the text, so it ends where the function ends: never inside the next
 * function's JSDoc, and never past a boundary a text search did not expect.
 */
function bodyOf(name: string): string {
  const declaration = registerAst.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name
  );
  expect(declaration, `function ${name} in register.ts`).toBeDefined();
  return printer.printNode(
    ts.EmitHint.Unspecified,
    declaration as ts.FunctionDeclaration,
    registerAst
  );
}

describe("the boot sequence in registerServices", () => {
  /**
   * Read from the source rather than by booting a container.
   *
   * Booting one here would need a database, an adapter and a plugin set, and
   * would assert the same single fact through far more machinery. The risk of
   * a source read — that it matches a comment rather than the code — is
   * answered by anchoring on the CALL, not on the layer banner.
   */
  //
  // `registerServicesOnce` runs one named function per boot phase, so the
  // order is read from its calls, and each phase function is checked to make
  // the call the ordering is about.
  const boot = bodyOf("registerServicesOnce");
  const pluginCall = boot.indexOf("await initializePlugins(");
  /**
   * What has to stand before a plugin's `init` runs: its migrations applied,
   * the applied schema version checked against what it declares, and the
   * tables it declares created.
   */
  const beforePlugins = [
    "await assertBootPluginInstallStates(",
    "await runBootMigrations(",
    "await assertBootPluginSchemaVersions(",
    "await prepareExtensionTablesForInit(",
  ];

  /**
   * A plugin that is not installed, or whose uninstall stopped part way, is
   * refused before boot migrations: after them, a refused plugin's modules,
   * or a half-uninstalled one's rolled-back modules, would already be
   * applied again.
   */
  it("judges install state before the boot migrations, through the gate", () => {
    const gate = boot.indexOf("await assertBootPluginInstallStates(");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(boot.indexOf("await runBootMigrations("));
    expect(bodyOf("assertBootPluginInstallStates")).toContain(
      "await assertBootPluginsInstalled("
    );
  });

  /**
   * The gate reads only the ledger and the configuration, so it can run before
   * any step that writes to the database or the registry. Checked after one of
   * those, a refused plugin's Builder fields, code-first tables and registry
   * rows would already have been written.
   */
  it("judges install state before any step that writes the schema or the registry", () => {
    const gate = boot.indexOf("await assertBootPluginInstallStates(");
    for (const step of [
      "await reconcileBuilderTargets(",
      "await syncCodeFirstEntities(",
      "await runBootMigrations(",
    ]) {
      expect(boot.indexOf(step), step).toBeGreaterThan(-1);
      expect(gate, step).toBeLessThan(boot.indexOf(step));
    }
  });

  /**
   * A lifecycle command's boot exists to run one plugin's hook. A resumed
   * uninstall is leaving a schema version the plugin declares, and a
   * development boot must not recreate extension tables the uninstall removed,
   * so neither check is made in that boot.
   */
  it.each(["assertBootPluginSchemaVersions", "prepareExtensionTablesForInit"])(
    "%s makes no check in a lifecycle command boot",
    name => {
      expect(bodyOf(name)).toContain("isLifecycleCommandBoot()");
    }
  );

  it("runs the boot migrations inside the migration phase", () => {
    expect(bodyOf("runBootMigrations")).toContain(
      "await runProdMigrationsIfEnabled("
    );
  });

  it("calls each, so the comparisons below have something to compare", () => {
    // The population check: two -1s would satisfy "before" perfectly.
    expect(pluginCall).toBeGreaterThan(-1);
    for (const call of beforePlugins) {
      expect(boot.indexOf(call), call).toBeGreaterThan(-1);
    }
  });

  it.each(beforePlugins)("runs %s before plugins initialise", call => {
    expect(boot.indexOf(call)).toBeLessThan(pluginCall);
  });

  /**
   * Extension tables' foreign keys to code-first tables are added by the apply
   * that creates those tables, by boot migrations, and in development by the
   * extension-table reconcile. Checked before any of them, the check would
   * refuse keys moments from being added; checked after plugins initialise,
   * something would already have used tables missing their keys. The boot's
   * executed path is observed by the integration suite
   * (`fresh-install-foreign-keys.integration.test.ts`); this pins the order.
   */
  it("checks foreign keys to code-first tables after every step that adds them, before plugins", () => {
    const check = boot.indexOf("await checkForeignKeysToCodeFirstTables(");
    expect(check).toBeGreaterThan(-1);
    for (const step of [
      "await syncCodeFirstEntities(",
      "await runBootMigrations(",
      "await prepareExtensionTablesForInit(",
    ]) {
      expect(boot.indexOf(step), step).toBeGreaterThan(-1);
      expect(boot.indexOf(step), step).toBeLessThan(check);
    }
    expect(check).toBeLessThan(pluginCall);
    expect(bodyOf("syncCodeFirstEntities")).toContain(
      "await createMissingCodeFirstTables("
    );
    expect(bodyOf("checkForeignKeysToCodeFirstTables")).toContain(
      "await assertForeignKeysToCodeFirstTables("
    );
  });

  /**
   * Relations are asked of the registry once every table that registers
   * during the boot is in it — Builder-made ones and extension tables on its
   * first load, the code-first ones by their sync, what boot migrations
   * created by their reload — and before a plugin's `init` can query through
   * them.
   */
  it("asks whether every relation resolves once the tables are registered, before plugins", () => {
    const check = boot.indexOf("assertBootRelationsResolve(");
    expect(check).toBeGreaterThan(-1);
    for (const step of [
      "await initializeSchemaRegistry(",
      "await syncCodeFirstEntities(",
      "await runBootMigrations(",
      "await prepareExtensionTablesForInit(",
    ]) {
      expect(boot.indexOf(step), step).toBeGreaterThan(-1);
      expect(boot.indexOf(step), step).toBeLessThan(check);
    }
    expect(check).toBeLessThan(pluginCall);
    expect(bodyOf("assertBootRelationsResolve")).toContain(
      "checkRelationsBeforePlugins("
    );
  });

  /**
   * First-run setup runs inside `initializeSchemaRegistry` and decides what to
   * create by introspecting the ACTIVE PostgreSQL schema. Published after it,
   * a boot into a new schema introspected `public` instead — and when `public`
   * already held another installation, found its core tables there and
   * created nothing in the schema the adapter writes to.
   */
  const schemaPublication = registerSource.indexOf("setActivePostgresSchema(");
  const schemaPhase = registerSource.indexOf("await prepareBootSchema(");
  const schemaRegistryInit = registerSource.indexOf(
    "await initializeSchemaRegistry("
  );

  it("publishes the PostgreSQL schema inside the schema phase", () => {
    expect(bodyOf("prepareBootSchema")).toContain("publishBootPostgresSchema(");
    expect(bodyOf("publishBootPostgresSchema")).toContain(
      "setActivePostgresSchema("
    );
  });

  it("publishes the PostgreSQL schema before the extension schema compiles", () => {
    // Everything after the publication reads the PostgreSQL schema as its one
    // answer, so it is published as soon as the dialect is known, before the
    // extension schema compiles and is published beside it.
    const phase = bodyOf("prepareBootSchema");
    const publication = phase.indexOf("publishBootPostgresSchema(");
    const compilation = phase.indexOf("compileAndPublishExtensionSchema(");
    expect(publication).toBeGreaterThan(-1);
    expect(compilation).toBeGreaterThan(-1);
    expect(publication).toBeLessThan(compilation);
  });

  it("publishes the PostgreSQL schema exactly once", () => {
    // Once, so a later second publication cannot quietly replace the value
    // first-run already acted on — and present at all, so the ordering below
    // is not satisfied by a -1.
    expect(schemaPublication).toBeGreaterThan(-1);
    expect(
      registerSource.indexOf("setActivePostgresSchema(", schemaPublication + 1)
    ).toBe(-1);
    expect(schemaRegistryInit).toBeGreaterThan(-1);
  });

  it("publishes the PostgreSQL schema before first-run setup can run", () => {
    expect(schemaPhase).toBeGreaterThan(-1);
    expect(schemaPhase).toBeLessThan(schemaRegistryInit);
  });
});

describe("the settings permission check in the Builder reconcile", () => {
  it("refuses an unowned settings permission before any Builder row or table is written", () => {
    // A boot that refuses the configuration must not have changed the
    // installation first: the check is asked as soon as the Builder's entities
    // are loaded, ahead of the materialization that writes registry rows and
    // runs DDL.
    const phase = bodyOf("reconcileBuilderTargets");
    const loaded = phase.indexOf("loadBuilderEntities(");
    const checked = phase.indexOf("assertSettingsPermissionsOwned(");
    const written = phase.indexOf("materializeBuilderChanges(");
    expect(loaded).toBeGreaterThan(-1);
    expect(checked).toBeGreaterThan(-1);
    expect(written).toBeGreaterThan(-1);
    expect(loaded).toBeLessThan(checked);
    expect(checked).toBeLessThan(written);
  });
});

describe("the settings permission check before the adapter connects", () => {
  it("refuses an unowned settings permission before first-run setup can write schema", () => {
    // A misspelt or foreign permission is known from the config alone, so it
    // stops the boot in the pre-connection validation, before
    // `initializeSchemaRegistry` runs first-run setup on a fresh database.
    expect(bodyOf("validateBootContributions")).toContain(
      "assertSettingsPermissionsOwned("
    );
    const phase = bodyOf("registerServicesOnce");
    const validated = phase.indexOf("validateBootContributions(");
    const schemaSetup = phase.indexOf("initializeSchemaRegistry(");
    expect(validated).toBeGreaterThan(-1);
    expect(schemaSetup).toBeGreaterThan(-1);
    expect(validated).toBeLessThan(schemaSetup);
  });
});
