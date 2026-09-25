/**
 * What the APP's migration stream owns among the extension tables, and the
 * two snapshots its diff compares.
 *
 * The app stream carries two kinds of extension schema:
 *
 * - **Tables the app declares** through `db.schema.extend`. Whole tables, like
 *   a collection's, created and altered by the app's migrations.
 * - **Elements the app contributes to somebody else's table**: a hidden column
 *   or an index an app hook adds to a plugin's table. The TABLE rides the
 *   plugin's module; only these elements ride the app's migrations, because the
 *   plugin has never seen the app's config and cannot carry them.
 *
 * The second kind is why this is more than appending specs. A plugin's table
 * keeps changing under its own stream, so a copy of it frozen in the app's
 * last snapshot goes stale — and diffing the live declaration against that
 * copy made the app's migration re-add every column the plugin had added
 * since, which the plugin's own module then failed to add a second time.
 *
 * So the diff is taken over the plugin's CURRENT declaration on both sides,
 * differing only in the app's elements: the elements the app's last snapshot
 * recorded on the previous side, the ones it contributes now on the desired
 * side. The snapshot records which elements those were, by name — the one fact
 * that cannot be recovered afterwards, since an element the table no longer
 * declares could have been removed by either owner.
 *
 * `migrate:create` and `migrate:check` both build their comparison here, so
 * the checker cannot report as drift what the generator deliberately wrote.
 *
 * @module domains/schema/migrate-create/app-stream
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { PluginDefinition } from "../../../plugins/plugin-context";
import type {
  ContributedElements,
  NextlySchemaSnapshot,
  TableSpec,
} from "../pipeline/diff/types";

/** A table with nothing contributed to it. */
export const NO_ELEMENTS: ContributedElements = {
  columns: [],
  indexes: [],
  foreignKeys: [],
  checks: [],
};

/** The extension schema the app stream is responsible for. */
export interface AppStreamTables {
  /** Tables the app declares — full specs, created by this stream. */
  owned: TableSpec[];
  /**
   * Tables another owner declares that carry app-contributed elements, as the
   * compiled schema has them — the owner's declaration plus the app's
   * elements. Keyed by table name.
   */
  contributed: Map<string, { spec: TableSpec; elements: ContributedElements }>;
  /**
   * Every table the app does NOT own, as its owner declares it — compiled
   * without the app's hooks. The baseline both sides of the diff share for a
   * contributed table, including one the app has stopped contributing to.
   */
  baselines: Map<string, TableSpec>;
}

/** An empty stream, for a configuration that declares no extension schema. */
export const NO_APP_STREAM_TABLES: AppStreamTables = {
  owned: [],
  contributed: new Map(),
  baselines: new Map(),
};

/** Whether the stream has anything to emit at all. */
export function hasAppStreamTables(tables: AppStreamTables): boolean {
  return tables.owned.length > 0 || tables.contributed.size > 0;
}

interface ConfigLike {
  plugins?: PluginDefinition[];
  db?: unknown;
  collections?: unknown[];
  singles?: unknown[];
  fieldGroups?: unknown[];
}

/**
 * Compile the app stream's tables the way boot compiles them.
 *
 * Compiled rather than published: nothing in a migration command serves
 * requests, and publishing the baseline — which is missing the app's
 * contributions on purpose — would have handed any later reader in the process
 * a schema that is wrong.
 */
export async function compileAppStreamTables(input: {
  config: ConfigLike;
  dialect: SupportedDialect;
  logger: { warn: (message: string) => void };
}): Promise<AppStreamTables> {
  const { compileExtensionSchema } = await import("../extension/publish");
  const plugins = input.config.plugins ?? [];
  const schema = await compileExtensionSchema({
    dialect: input.dialect,
    plugins,
    config: input.config,
    logger: input.logger,
  });
  if (!schema) return NO_APP_STREAM_TABLES;

  const specByName = new Map(schema.specs.map(spec => [spec.name, spec]));
  // Read off the compiled ownership map, not off `schema.tables`: that list
  // holds only the tables the DSL declared, while a table a
  // `db.schema.afterDrizzle` hook introduces is added to `owners` (as the
  // app's) and to `specs`, and nowhere else. Deriving from `tables` left such a
  // table out of this stream, so it reached dev push and no migration, and
  // `migrate:check` saw nothing pending. `owners` also names adopted tables as
  // the app's; they stay out because everything below reads `specs`, which
  // never carries an adopted table.
  const appOwned = new Set(
    [...schema.owners]
      .filter(([, owner]) => owner.kind === "app")
      .map(([name]) => name)
  );

  const contributed = new Map<
    string,
    { spec: TableSpec; elements: ContributedElements }
  >();
  for (const [table, elements] of schema.elementOwners) {
    if (appOwned.has(table)) continue;
    const spec = specByName.get(table);
    if (spec === undefined) continue;
    const mine = elements.filter(element => element.owner.kind === "app");
    if (mine.length === 0) continue;
    contributed.set(table, { spec, elements: contributedElementsOf(mine) });
  }

  // The same plugins without the app's hooks: what each foreign table looks
  // like as its owner declares it. Compiled for every non-app table, not only
  // the contributed ones, because a table the app has just STOPPED
  // contributing to still needs a baseline to diff its removal against.
  //
  // With no app hooks there is nothing to remove, so the first compile IS the
  // baseline and a second would run every plugin hook again for the same
  // answer — on every `migrate:create` and every `migrate:check`.
  const baselineSchema =
    appExtendHooks(input.config).length === 0
      ? schema
      : await compileExtensionSchema({
          dialect: input.dialect,
          plugins,
          config: withoutAppExtend(input.config),
          logger: input.logger,
        });
  const baselines = new Map<string, TableSpec>();
  for (const spec of baselineSchema?.specs ?? []) {
    if (!appOwned.has(spec.name)) baselines.set(spec.name, spec);
  }

  return {
    owned: schema.specs.filter(spec => appOwned.has(spec.name)),
    contributed,
    baselines,
  };
}

/**
 * One contributor's element-owner rows for a table, as element names by kind.
 *
 * The compiled schema records ownership per element; the migration streams
 * record it as these names. Both streams derive them here so the two records
 * cannot come to disagree about what a kind is called.
 */
export function contributedElementsOf(
  elements: readonly {
    elementKind: "column" | "index" | "fk" | "check";
    elementName: string;
  }[]
): ContributedElements {
  const names = (kind: (typeof elements)[number]["elementKind"]) =>
    elements
      .filter(element => element.elementKind === kind)
      .map(element => element.elementName)
      .sort();
  return {
    columns: names("column"),
    indexes: names("index"),
    foreignKeys: names("fk"),
    checks: names("check"),
  };
}

/** The app's `db.schema.extend` hooks, or none. */
function appExtendHooks(config: ConfigLike): readonly unknown[] {
  return (
    (config.db as { schema?: { extend?: unknown[] } } | undefined)?.schema
      ?.extend ?? []
  );
}

/** The config with the app's `db.schema.extend` hooks removed. */
function withoutAppExtend(config: ConfigLike): ConfigLike {
  const db = (config.db ?? {}) as { schema?: Record<string, unknown> };
  return {
    ...config,
    db: { ...db, schema: { ...(db.schema ?? {}), extend: [] } },
  };
}

/** The result of `appStreamSnapshots`. */
export interface AppStreamSnapshots {
  /** The previous side of the diff. */
  previous: NextlySchemaSnapshot;
  /** The desired side of the diff. */
  desired: NextlySchemaSnapshot;
  /**
   * What the new snapshot file records: the desired side, minus foreign
   * tables the app no longer contributes to. Those were on both sides only so
   * the diff could see the app's elements leave.
   */
  written: NextlySchemaSnapshot;
  /** The contributions the new snapshot file records, by table. */
  contributions: Record<string, ContributedElements>;
}

/**
 * The two snapshots the app stream's diff compares, and the one it writes.
 *
 * `previous` is the latest snapshot file's content; `desired` is what the
 * entities alone describe. The extension tables are folded into both here.
 */
export function appStreamSnapshots(input: {
  previous: NextlySchemaSnapshot;
  previousContributions: Readonly<Record<string, ContributedElements>>;
  desired: NextlySchemaSnapshot;
  tables: AppStreamTables;
}): AppStreamSnapshots {
  const { tables } = input;
  const previous = new Map(
    input.previous.tables.map(table => [table.name, table])
  );
  const desired = new Map(
    input.desired.tables.map(table => [table.name, table])
  );

  // Appended rather than merged: an extension table is a table of its own, and
  // its name cannot collide with an entity's — the draft store refuses that at
  // compile time, before anything reaches here.
  for (const spec of tables.owned) desired.set(spec.name, spec);

  const sides = foreignTableSides({
    previousCopies: previous,
    previousContributions: input.previousContributions,
    contributed: tables.contributed,
    baselines: tables.baselines,
  });
  const written = new Map(desired);
  for (const name of sides.gone) {
    previous.delete(name);
    desired.delete(name);
    written.delete(name);
  }
  for (const [name, table] of sides.before) previous.set(name, table);
  for (const [name, table] of sides.after) {
    desired.set(name, table);
    // Only a table the app still contributes to stays in the file. One it has
    // withdrawn from is on both sides so the diff can see its elements leave;
    // recording it afterwards would keep a copy of a table that is not the
    // app's, going stale as its owner changes it.
    if (tables.contributed.has(name)) written.set(name, table);
    else written.delete(name);
  }

  return {
    previous: { ...input.previous, tables: [...previous.values()] },
    desired: { ...input.desired, tables: [...desired.values()] },
    written: { ...input.desired, tables: [...written.values()] },
    contributions: sides.contributions,
  };
}

/** The result of `foreignTableSides`. */
export interface ForeignTableSides {
  /** The previous side of each foreign table the diff must see. */
  before: Map<string, TableSpec>;
  /** The desired side of the same tables. */
  after: Map<string, TableSpec>;
  /**
   * Tables whose owner no longer declares them. Their lifecycle is the
   * owner's stream, and dropping one takes the contributed elements with it,
   * so the contributor has nothing to say about them on either side.
   */
  gone: Set<string>;
  /** The contributions to record, by table. */
  contributions: Record<string, ContributedElements>;
}

/**
 * Both diff sides of the tables a contributor adds elements to but does not
 * own — the one derivation the app stream and a plugin's module generator
 * share.
 *
 * Each side is the owner's CURRENT declaration, differing only in the
 * contributor's elements: the ones recorded last time on the previous side,
 * the ones contributed now on the desired side. So the owner's own changes
 * are identical on both sides and produce nothing, whatever the owner did in
 * between, and a contribution withdrawn since is diffed as a removal.
 *
 * The elements are taken by recorded NAME rather than inferred from stored
 * copies of the table. Inference cannot tell a contributor's element from one
 * the owner has since removed, nor — once a table has been stored on both
 * sides with the contribution already present — tell it from the owner's own
 * columns at all.
 */
export function foreignTableSides(input: {
  /** Each foreign table as last recorded, whole. */
  previousCopies: ReadonlyMap<string, TableSpec>;
  /** What was recorded as contributed, by table. */
  previousContributions: Readonly<Record<string, ContributedElements>>;
  /** Tables contributed to now, as compiled, with the contributed names. */
  contributed: ReadonlyMap<
    string,
    { spec: TableSpec; elements: ContributedElements }
  >;
  /** Every foreign table as its owner declares it now. */
  baselines: ReadonlyMap<string, TableSpec>;
}): ForeignTableSides {
  const before = new Map<string, TableSpec>();
  const after = new Map<string, TableSpec>();
  const gone = new Set<string>();
  const contributions: Record<string, ContributedElements> = {};

  const names = new Set([
    ...input.contributed.keys(),
    ...Object.keys(input.previousContributions),
  ]);
  for (const name of names) {
    const baseline = input.baselines.get(name);
    if (baseline === undefined) {
      gone.add(name);
      continue;
    }

    const recorded = input.previousContributions[name];
    const copy = input.previousCopies.get(name);
    before.set(
      name,
      recorded !== undefined && copy !== undefined
        ? withElements(baseline, copy, recorded)
        : baseline
    );

    const current = input.contributed.get(name);
    if (current !== undefined) {
      after.set(name, current.spec);
      contributions[name] = current.elements;
    } else {
      after.set(name, baseline);
    }
  }

  return { before, after, gone, contributions };
}

/**
 * `baseline`, plus the named elements as `source` recorded them.
 *
 * An element the baseline itself now declares is kept as the baseline has it:
 * the owner has taken it over, and its shape is the owner's to describe.
 */
function withElements(
  baseline: TableSpec,
  source: TableSpec,
  names: ContributedElements
): TableSpec {
  const pick = <T extends { name: string }>(
    own: readonly T[] | undefined,
    theirs: readonly T[] | undefined,
    wanted: readonly string[]
  ): T[] | undefined => {
    const added = (theirs ?? []).filter(
      element =>
        wanted.includes(element.name) &&
        !(own ?? []).some(existing => existing.name === element.name)
    );
    // `undefined` means "not tracked" to the diff, so it stays undefined
    // unless there is something to track.
    if (own === undefined && added.length === 0) return undefined;
    return [...(own ?? []), ...added];
  };

  const columns = pick(baseline.columns, source.columns, names.columns) ?? [];
  const indexes = pick(baseline.indexes, source.indexes, names.indexes);
  const foreignKeys = pick(
    baseline.foreignKeys,
    source.foreignKeys,
    names.foreignKeys
  );
  const checks = pick(baseline.checks, source.checks, names.checks);
  return {
    ...baseline,
    columns,
    ...(indexes !== undefined ? { indexes } : {}),
    ...(foreignKeys !== undefined ? { foreignKeys } : {}),
    ...(checks !== undefined ? { checks } : {}),
  };
}

/**
 * The before, target and live sides of an app migration's drift check, each
 * narrowed to the app's own elements on the tables it only contributes to.
 *
 * The same idea as `foreignTableSides`, at apply time. A migration's paired
 * snapshots hold such a table whole, as it looked when the migration was
 * generated; by the time it applies, the owner's own module may have changed
 * the table, so the live table matches neither snapshot and a valid migration
 * was refused as drift. Only the app's elements are the app stream's to
 * judge, so on those tables all three sides are compared on exactly those.
 *
 * `contributions` is the union of what the two snapshot files record. A side
 * holding no copy of the table — the app's first contribution, or one it has
 * withdrawn — is the table with none of the app's elements. A table the
 * database no longer has is left out of all three: its owner removed it, and
 * the app's elements went with it.
 */
export function narrowToContributions(input: {
  before: NextlySchemaSnapshot;
  target: NextlySchemaSnapshot;
  live: NextlySchemaSnapshot;
  contributions: Readonly<Record<string, ContributedElements>>;
}): {
  before: NextlySchemaSnapshot;
  target: NextlySchemaSnapshot;
  live: NextlySchemaSnapshot;
} {
  const names = Object.keys(input.contributions);
  if (names.length === 0) return input;
  const liveNames = new Set(input.live.tables.map(table => table.name));

  const narrow = (snapshot: NextlySchemaSnapshot): NextlySchemaSnapshot => {
    const byName = new Map(snapshot.tables.map(table => [table.name, table]));
    for (const name of names) {
      if (!liveNames.has(name)) {
        byName.delete(name);
        continue;
      }
      byName.set(
        name,
        onlyElements(
          byName.get(name) ?? { name, columns: [] },
          input.contributions[name]
        )
      );
    }
    return { ...snapshot, tables: [...byName.values()] };
  };

  return {
    before: narrow(input.before),
    target: narrow(input.target),
    live: narrow(input.live),
  };
}

/** `table` with only the named elements, every dimension tracked. */
function onlyElements(table: TableSpec, names: ContributedElements): TableSpec {
  const keep = <T extends { name: string }>(
    elements: readonly T[] | undefined,
    wanted: readonly string[]
  ): T[] => (elements ?? []).filter(element => wanted.includes(element.name));
  return {
    name: table.name,
    columns: keep(table.columns, names.columns),
    indexes: keep(table.indexes, names.indexes),
    foreignKeys: keep(table.foreignKeys, names.foreignKeys),
    checks: keep(table.checks, names.checks),
  };
}

/** Two contributions records as one, element names merged per table. */
export function mergeContributions(
  a: Readonly<Record<string, ContributedElements>>,
  b: Readonly<Record<string, ContributedElements>>
): Record<string, ContributedElements> {
  const out: Record<string, ContributedElements> = {};
  for (const table of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const left = a[table] ?? NO_ELEMENTS;
    const right = b[table] ?? NO_ELEMENTS;
    out[table] = {
      columns: [...new Set([...left.columns, ...right.columns])],
      indexes: [...new Set([...left.indexes, ...right.indexes])],
      foreignKeys: [...new Set([...left.foreignKeys, ...right.foreignKeys])],
      checks: [...new Set([...left.checks, ...right.checks])],
    };
  }
  return out;
}
