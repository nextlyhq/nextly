/**
 * A Builder delete of a collection, a Single or a field group, in
 * development, removes everything `ENTITY_OWNED_DATA` says belongs to it.
 *
 * For each kind every entry the declaration lists is seeded, and counted
 * before the delete so the fixture is known to reach it; after the delete
 * none is left. A second case fails one of the delete's table drops: what goes
 * with the registry row (the registry row itself, autosaves, version pins,
 * "seen" markers, dashboard pins, media usage) is still there, so the entity
 * is still registered, and a second delete removes the rest. On MySQL the
 * failed drop comes after an earlier drop that has committed, which is the
 * case the order exists for.
 *
 * The probes are keyed by every kind of owned data, so an entry added to the
 * declaration does not compile here until it can be seeded and counted.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, expect, it, vi } from "vitest";

import { defineCollection, fieldGroup, text } from "../../../config";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { resolveRegistryTableName } from "../../field-groups/storage/resolve-storage-names";
import { ensureI18nArchive } from "../../i18n/migration/ensure-archive";
import { resolveTransitionStore } from "../../i18n/migration/transition-recorder";
import {
  beginI18nTransition,
  readI18nTransitionState,
} from "../../i18n/migration/transition-state";
import { REGISTRY_TABLES } from "../../versions/history-locks";
import {
  registerVersionPinHolder,
  versionPins,
} from "../../versions/version-pins";
import { markVersionSeen } from "../../versions/version-views";
import { VersionsRepository } from "../../versions/versions-repository";
import {
  ENTITY_OWNED_DATA,
  type EntityOwnedData,
  type OwningEntityKind,
} from "../services/entity-owned-data";
import { junctionTablesOf } from "../services/field-column-descriptor";
import { resolveSingleTableName } from "../../singles/services/resolve-single-table-name";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../utils/resolve-table-name";

const workflows = registerVersionPinHolder({
  name: "owned-data-test-workflows",
  label: "Owned data test workflows",
});

const ANA = { id: "user-ana", name: "Ana", email: "ana@x.test" };

/** The field group the collection and the Single keep values in. */
const META = "own_meta";
/** The field group deleted, and the one nested in it whose values it owns. */
const CARD = "own_card";
const BADGE = "own_badge";
/** The collection the many-to-many relationships point at. */
const TARGETS = "own_targets";
const NOTES = "own_notes";
const BANNER = "own_banner";

const targetsField = {
  name: "targets",
  type: "relationship",
  options: { relationType: "manyToMany", target: TARGETS },
};
const metaField = fieldGroup({ name: "meta", component: META });

/** One entity under test: where its data lives, and the document the seeds name. */
interface Owner {
  kind: OwningEntityKind;
  slug: string;
  table: string;
  junctions: string[];
  /** The field-group table holding values whose parent is this entity's table. */
  valuesTable: string;
  registry: string;
  /** A document of it: an entry of the collection, the Single's own row. */
  entryId: string;
}

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await current?.destroy();
  current = undefined;
});

const t = (): TestNextly => {
  if (current === undefined) throw new Error("no instance booted");
  return current;
};

const quote = (name: string) =>
  t().adapter.dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

async function rowsIn(
  table: string,
  where: Record<string, string | boolean>
): Promise<number> {
  const rows = await t().adapter.select<Record<string, unknown>>(table, {
    where: {
      and: Object.entries(where).map(([column, value]) => ({
        column,
        op: "=" as const,
        value,
      })),
    },
  });
  return rows.length;
}

const tableCount = async (table: string) =>
  (await t().adapter.tableExists(table)) ? 1 : 0;

const refOf = (owner: Owner) => ({
  scopeKind: owner.kind as "collection" | "single",
  scopeSlug: owner.slug,
  entryId: owner.entryId,
});

/** How many of each kind of owned data `owner` has. */
const PROBES: Record<EntityOwnedData, (owner: Owner) => Promise<number>> = {
  table: owner => tableCount(owner.table),
  junctionTables: async owner => {
    let found = 0;
    for (const junction of owner.junctions) found += await tableCount(junction);
    return found;
  },
  registryRow: owner => rowsIn(owner.registry, { slug: owner.slug }),
  fieldGroupValues: async owner =>
    Number(
      (
        await t().adapter.executeQuery<{ n: unknown }>(
          `SELECT COUNT(*) AS n FROM ${quote(owner.valuesTable)} WHERE ${quote("_parent_table")} = '${owner.table}'`
        )
      )[0]?.n ?? Number.NaN
    ),
  translations: owner => tableCount(`${owner.table}_locales`),
  translationArchive: async owner =>
    (await t().adapter.tableExists("nextly_i18n_archive"))
      ? rowsIn("nextly_i18n_archive", {
          collection: owner.slug,
          entityKind: owner.kind,
        })
      : 0,
  translationProvenance: owner =>
    rowsIn("nextly_translation_provenance", {
      scopeKind: owner.kind,
      scopeSlug: owner.slug,
    }),
  translationTransition: async owner =>
    (
      await readI18nTransitionState(
        await resolveTransitionStore(t().adapter),
        owner.kind,
        owner.slug
      )
    ).status === "untracked"
      ? 0
      : 1,
  autosaves: owner =>
    rowsIn("nextly_versions", {
      scopeKind: owner.kind,
      scopeSlug: owner.slug,
      isAutosave: true,
    }),
  versionPins: async owner =>
    (await versionPins.list(t().adapter, refOf(owner))).length,
  seenMarkers: owner =>
    rowsIn("nextly_version_views", {
      scopeKind: owner.kind,
      scopeSlug: owner.slug,
    }),
  dashboardPins: owner =>
    rowsIn("nextly_dashboard_pins", {
      targetType: owner.kind,
      targetSlug: owner.slug,
    }),
  mediaUsage: owner =>
    rowsIn("nextly_media_usage", {
      subjectKind: owner.kind,
      subjectSlug: owner.slug,
    }),
};

/**
 * Seeds for what the Builder create and the document's own save do not
 * leave: the rows other features keep about an entity.
 */
const SEEDS: Partial<Record<EntityOwnedData, (owner: Owner) => Promise<void>>> =
  {
    fieldGroupValues: async owner => {
      // A collection's or Single's are written by its document's save; a
      // field group's are those of a field group nested in it, which no
      // document can write while nothing uses the field group.
      if (owner.kind !== "fieldGroup") return;
      await t().adapter.executeQuery(
        `INSERT INTO ${quote(owner.valuesTable)} (${quote("id")}, ${quote("_parent_id")}, ${quote("_parent_table")}, ${quote("_parent_field")}, ${quote("_order")}) VALUES ('${randomUUID()}', '${randomUUID()}', '${owner.table}', 'badge', 0)`
      );
    },
    translationArchive: async owner => {
      const adapter = t().adapter;
      await ensureI18nArchive(adapter, adapter.dialect);
      await adapter.insert("nextly_i18n_archive", {
        collection: owner.slug,
        entityKind: owner.kind,
        entryId: owner.entryId,
        locale: "es",
        field: "label",
        value: "hola",
        archivedAt: new Date(),
      });
    },
    translationProvenance: async owner => {
      await t().adapter.insert("nextly_translation_provenance", {
        id: randomUUID(),
        scopeKind: owner.kind,
        scopeSlug: owner.slug,
        entryId: owner.entryId,
        locale: "es",
        partState: "live",
        fieldPath: "label",
        valueFingerprint: "f",
        origin: "person",
        writtenAt: new Date(),
      });
    },
    translationTransition: async owner => {
      const store = await resolveTransitionStore(t().adapter);
      const state = await readI18nTransitionState(store, owner.kind, owner.slug);
      if (state.status !== "untracked") return;
      await beginI18nTransition(store, {
        kind: owner.kind,
        slug: owner.slug,
        sourceLocale: "en",
      });
    },
    autosaves: async owner => {
      await new VersionsRepository(t().adapter).upsertAutosave({
        ref: refOf(owner),
        status: "draft",
        snapshot: { label: "unsaved" },
        createdBy: ANA.id,
      });
    },
    versionPins: async owner => {
      await t().adapter.transaction(tx =>
        workflows.pin(tx, { ref: refOf(owner), slot: "approved", versionNo: 1 })
      );
    },
    seenMarkers: async owner => {
      await t().adapter.transaction(tx =>
        markVersionSeen(
          tx,
          { userId: ANA.id, ref: refOf(owner), part: null },
          1,
          new Date()
        )
      );
    },
    dashboardPins: async owner => {
      await t().adapter.insert("nextly_dashboard_pins", {
        id: randomUUID(),
        userId: ANA.id,
        targetType: owner.kind,
        targetSlug: owner.slug,
        entryId: owner.kind === "collection" ? owner.entryId : "",
        pinnedAt: new Date(),
      });
    },
    mediaUsage: async owner => {
      const now = new Date();
      const mediaId = randomUUID();
      await t().adapter.insert("media", {
        id: mediaId,
        filename: `${mediaId}.png`,
        originalFilename: "used.png",
        mimeType: "image/png",
        size: 1,
        url: `/uploads/${mediaId}.png`,
        uploadedAt: now,
        updatedAt: now,
      });
      await t().adapter.insert("nextly_media_usage", {
        id: randomUUID(),
        mediaId,
        subjectKind: owner.kind,
        subjectSlug: owner.slug,
        documentId: owner.kind === "collection" ? owner.entryId : "",
        fieldPath: "image",
        locale: "",
      });
    },
  };

/** How many of each kind of data the declaration lists for `owner` it has. */
async function countsOf(owner: Owner): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const { data } of ENTITY_OWNED_DATA[owner.kind]) {
    counts[data] = await PROBES[data](owner);
  }
  return counts;
}

/** Nothing of any kind the declaration lists. */
function noneOf(owner: Owner): Record<string, number> {
  return Object.fromEntries(
    ENTITY_OWNED_DATA[owner.kind].map(({ data }) => [data, 0])
  );
}

/**
 * Boot in development, as the Builder runs, with the field groups, and make
 * `kind`'s entity through the Builder with a document, then seed the rest of
 * what the declaration lists for it.
 */
async function bootOwner(
  dialect: TestDialect,
  kind: OwningEntityKind
): Promise<Owner> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({ slug: TARGETS, fields: [text({ name: "name" })] }),
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  const now = new Date();
  await t().adapter.insert("users", {
    id: ANA.id,
    email: ANA.email,
    name: ANA.name,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  vi.stubEnv("NODE_ENV", "development");
  await dispatchComponents(
    "createComponent",
    {},
    { slug: META, label: META, fields: [text({ name: "note" })] }
  );
  await dispatchComponents(
    "createComponent",
    {},
    { slug: BADGE, label: BADGE, fields: [text({ name: "label" })] }
  );
  const owner = await makeOwner(kind);
  vi.unstubAllEnvs();
  clearRegistryRowCache();
  for (const { data } of ENTITY_OWNED_DATA[kind]) {
    await SEEDS[data]?.(owner);
  }
  return owner;
}

/** `kind`'s entity, made through the Builder, with a document. */
async function makeOwner(kind: OwningEntityKind): Promise<Owner> {
  if (kind === "collection") {
    const fields = [text({ name: "label" }), metaField, targetsField];
    await dispatchCollections(
      {} as ServiceContainer,
      "createCollection",
      {},
      { name: NOTES, label: NOTES, localized: true, versions: true, fields }
    );
    const created = await t().nextly.create({
      collection: NOTES,
      data: { label: "kept", meta: { note: "n" } },
    });
    const table = resolveCollectionTableName(NOTES);
    return {
      kind,
      slug: NOTES,
      table,
      junctions: junctionTablesOf(table, [targetsField]),
      valuesTable: resolveComponentTableName(META),
      registry: REGISTRY_TABLES.collection ?? "",
      entryId: String(created.item.id),
    };
  }
  if (kind === "single") {
    const fields = [text({ name: "label" }), metaField, targetsField];
    await dispatchSingles(
      "createSingle",
      {},
      { slug: BANNER, label: BANNER, localized: true, versions: true, fields }
    );
    await t()
      .getService("singleEntryService")
      .update(
        BANNER,
        { label: "kept", meta: { note: "n" }, _overwrite: true },
        { overrideAccess: true }
      );
    const table = resolveSingleTableName({ slug: BANNER });
    const [row] = await t().adapter.executeQuery<{ id: unknown }>(
      `SELECT ${quote("id")} FROM ${quote(table)}`
    );
    return {
      kind,
      slug: BANNER,
      table,
      junctions: junctionTablesOf(table, [targetsField]),
      valuesTable: resolveComponentTableName(META),
      registry: REGISTRY_TABLES.single ?? "",
      entryId: String(row?.id),
    };
  }
  await dispatchComponents(
    "createComponent",
    {},
    {
      slug: CARD,
      label: CARD,
      localized: true,
      fields: [
        text({ name: "title" }),
        fieldGroup({ name: "badge", component: BADGE }),
      ],
    }
  );
  return {
    kind,
    slug: CARD,
    table: resolveComponentTableName(CARD),
    junctions: [],
    valuesTable: resolveComponentTableName(BADGE),
    registry: await resolveRegistryTableName(t().adapter),
    entryId: "",
  };
}

/** The Builder's delete of `owner`, through its route, in development. */
async function builderDelete(owner: Owner): Promise<void> {
  vi.stubEnv("NODE_ENV", "development");
  try {
    if (owner.kind === "collection") {
      await dispatchCollections(
        {} as ServiceContainer,
        "deleteCollection",
        { collectionName: owner.slug },
        undefined
      );
    } else if (owner.kind === "single") {
      await dispatchSingles("deleteSingle", { slug: owner.slug }, {});
    } else {
      await dispatchComponents("deleteComponent", { slug: owner.slug }, {});
    }
  } finally {
    vi.unstubAllEnvs();
    clearRegistryRowCache();
  }
}

/**
 * Fail the first statement matching `pattern`, on the adapter or on a
 * transaction: before it runs, or, with `afterItRuns`, once it has run, as a
 * failure that comes after a drop MySQL has committed. Returns how many
 * statements it failed.
 */
function failStatement(
  pattern: RegExp,
  { afterItRuns }: { afterItRuns: boolean }
): () => number {
  let failed = 0;
  const around = async <T>(
    statement: string,
    run: () => Promise<T>
  ): Promise<T> => {
    if (failed > 0 || !pattern.test(statement)) return run();
    failed += 1;
    if (afterItRuns) await run();
    throw new Error(`injected failure: ${statement}`);
  };
  const adapter = t().adapter;
  const executeQuery = adapter.executeQuery.bind(adapter);
  vi.spyOn(adapter, "executeQuery").mockImplementation((statement, params) =>
    around(statement, () => executeQuery(statement, params))
  );
  const transaction = adapter.transaction.bind(adapter);
  vi.spyOn(adapter, "transaction").mockImplementation((work, options) =>
    transaction(
      tx =>
        work(
          new Proxy(tx, {
            get(target, key) {
              if (key === "execute") {
                return (
                  statement: string,
                  params?: Parameters<TransactionContext["execute"]>[1]
                ) => around(statement, () => target.execute(statement, params));
              }
              const value: unknown = Reflect.get(target, key);
              return typeof value === "function" ? value.bind(target) : value;
            },
          })
        ),
      options
    )
  );
  return () => failed;
}

/** A DROP of exactly `table`, quoted, then the statement's end. */
function dropOf(table: string): RegExp {
  return new RegExp(
    `DROP TABLE (IF EXISTS )?[\`"]${table}[\`"](\\s+CASCADE)?;?\\s*$`
  );
}

/**
 * The drop each kind's delete is failed at: one that runs before the
 * registry row goes. A collection's own table is dropped by its written
 * migration after its registry row, so its translations table, dropped in the
 * delete's transaction, is the one; it fails after running, so MySQL has
 * committed it. A Single's and a field group's own tables are dropped before
 * their registry rows, outside any transaction.
 */
function failedDropOf(owner: Owner): () => number {
  return owner.kind === "collection"
    ? failStatement(dropOf(`${owner.table}_locales`), { afterItRuns: true })
    : failStatement(dropOf(owner.table), { afterItRuns: false });
}

const KINDS: readonly OwningEntityKind[] = ["collection", "single", "fieldGroup"];

describeEachDialect("a Builder delete removes what the entity owned", dialect => {
  it.each(KINDS)(
    "removes everything a %s owns",
    async kind => {
      const owner = await bootOwner(dialect, kind);
      const before = await countsOf(owner);
      // Positive control: the fixture reaches every kind the declaration lists.
      expect(
        Object.keys(before).filter(data => before[data] === 0)
      ).toEqual([]);

      await builderDelete(owner);

      expect(await countsOf(owner)).toEqual(noneOf(owner));
    },
    120_000
  );

  it.each(KINDS)(
    "keeps a %s registered, with what goes with its registry row, when a drop fails, and a second delete finishes",
    async kind => {
      const owner = await bootOwner(dialect, kind);
      const before = await countsOf(owner);
      const failed = failedDropOf(owner);

      const outcome = await builderDelete(owner).then(
        () => undefined,
        (error: unknown) => error
      );
      vi.restoreAllMocks();

      expect(failed()).toBe(1);
      expect(outcome).toBeInstanceOf(Error);
      const after = await countsOf(owner);
      const keptWithTheRow = ENTITY_OWNED_DATA[kind]
        .filter(({ removed }) => removed === "withTheRegistryRow")
        .map(({ data }) => data);
      expect(
        Object.fromEntries(keptWithTheRow.map(data => [data, after[data]]))
      ).toEqual(
        Object.fromEntries(keptWithTheRow.map(data => [data, before[data]]))
      );
      if (kind === "collection" && dialect !== "mysql") {
        // The delete is one transaction, undone whole.
        expect(after).toEqual(before);
      }

      await builderDelete(owner);

      expect(await countsOf(owner)).toEqual(noneOf(owner));
    },
    120_000
  );
});
