/**
 * What belongs to a collection, a Single or a field group: every table and
 * row its Builder delete removes with it, what removes each, and when.
 *
 * A declaration, with no behaviour. Each delete path removes these in its own
 * service today: a collection's in `collection-metadata-service.ts`, a
 * Single's in `single-metadata-service.ts`, a field group's in
 * `field-group-registry-service.ts`. The integration test
 * `domains/schema/__tests__/delete-removes-what-the-entity-owned.integration.test.ts`
 * holds every path to this list: for each kind it seeds every entry listed
 * here, deletes the entity through the Builder, and finds none left; and it
 * fails a drop to find what goes with the registry row still there, and a
 * second delete finishing. So a path that stops removing something listed
 * here fails that test, and so does an entry added here that the test cannot
 * yet seed and count: its probes are keyed by {@link EntityOwnedData}, and
 * the file does not compile with one missing.
 *
 * A new kind of row an entity owns is added here first, with the step that
 * removes it.
 *
 * @module domains/schema/services/entity-owned-data
 */

/** The kinds of entity the Builder deletes. */
export type OwningEntityKind = "collection" | "single" | "fieldGroup";

/** A kind of table or row that belongs to one entity, and goes when it is deleted. */
export type EntityOwnedData =
  | "table"
  | "junctionTables"
  | "registryRow"
  | "fieldGroupValues"
  | "translations"
  | "translationArchive"
  | "translationProvenance"
  | "translationTransition"
  | "autosaves"
  | "versionPins"
  | "seenMarkers"
  | "dashboardPins"
  | "mediaUsage";

/**
 * When the delete removes it, relative to the entity's table drops.
 *
 * - `beforeTheDrop`: torn down before any of the entity's tables is dropped,
 *   since the drop would strand it (a field-group value names its parent's
 *   table by a plain string) or is refused while it stands (the translations
 *   table holds a key into the entity's table).
 * - `theDrop`: the table drops themselves.
 * - `withTheRegistryRow`: removed with the registry row, after every drop has
 *   run. MySQL commits each table drop as it runs, so this is what a failed
 *   drop leaves in place there, with the entity still registered, for a
 *   second delete to finish.
 */
export type OwnedDataRemoval = "beforeTheDrop" | "theDrop" | "withTheRegistryRow";

/** One kind of data an entity owns, where it is kept, and what removes it. */
export interface OwnedDataDeclaration {
  data: EntityOwnedData;
  /** Where it is kept. */
  keptIn: string;
  /** The step of the Builder delete that removes it. */
  removedBy: string;
  removed: OwnedDataRemoval;
}

/** Field-group values, which every kind holds in the shared tables of the field groups it uses. */
const FIELD_GROUP_VALUES: OwnedDataDeclaration = {
  data: "fieldGroupValues",
  keptIn:
    "each used field group's shared `comp_*` table, rows whose `_parent_table` is the entity's table",
  removedBy: "teardownEntityComponentData",
  removed: "beforeTheDrop",
};

/** Translations, which every kind can keep. */
const TRANSLATIONS: readonly OwnedDataDeclaration[] = [
  {
    data: "translations",
    keptIn: "its `<table>_locales` translations table",
    removedBy: "teardownEntityI18n",
    removed: "beforeTheDrop",
  },
  {
    data: "translationArchive",
    keptIn: "its rows in `nextly_i18n_archive`, by kind and slug",
    removedBy: "teardownEntityI18n",
    removed: "beforeTheDrop",
  },
  {
    data: "translationTransition",
    keptIn: "its translation transition record in `nextly_meta`, by kind and slug",
    removedBy: "teardownEntityI18n",
    removed: "beforeTheDrop",
  },
];

/** Where each translated value of a document came from: kept for collections and Singles only. */
const TRANSLATION_PROVENANCE: OwnedDataDeclaration = {
  data: "translationProvenance",
  keptIn: "its rows in `nextly_translation_provenance`, by kind and slug",
  removedBy: "teardownEntityI18n",
  removed: "beforeTheDrop",
};

/** What a collection's or Single's documents hold outside their tables, removed with the registry row. */
const WITH_THE_REGISTRY_ROW: readonly OwnedDataDeclaration[] = [
  {
    data: "registryRow",
    keptIn: "its registry row",
    removedBy: "deleteEntityRegistryRow",
    removed: "withTheRegistryRow",
  },
  {
    data: "autosaves",
    keptIn: "its autosaves in `nextly_versions`",
    removedBy: "deleteEntityRegistryRow",
    removed: "withTheRegistryRow",
  },
  {
    data: "versionPins",
    keptIn: "the pins features hold on its versions, in `nextly_version_pins`",
    removedBy: "deleteEntityRegistryRow",
    removed: "withTheRegistryRow",
  },
  {
    data: "seenMarkers",
    keptIn: "each reader's \"last looked at\" marker, in `nextly_version_views`",
    removedBy: "deleteEntityRegistryRow",
    removed: "withTheRegistryRow",
  },
  {
    data: "dashboardPins",
    keptIn: "each reader's dashboard pin of it, in `nextly_dashboard_pins`",
    removedBy: "deleteEntityRegistryRow",
    removed: "withTheRegistryRow",
  },
  {
    data: "mediaUsage",
    keptIn: "the record of the media its documents use, in `nextly_media_usage`",
    removedBy: "deleteEntityRegistryRow",
    removed: "withTheRegistryRow",
  },
];

/** Its tables: its own, and the junction tables of its many-to-many relationships. */
const TABLES: readonly OwnedDataDeclaration[] = [
  {
    data: "table",
    keptIn: "its own table",
    removedBy: "the delete's table drop",
    removed: "theDrop",
  },
  {
    data: "junctionTables",
    keptIn: "a junction table per many-to-many relationship",
    removedBy: "the delete's table drop",
    removed: "theDrop",
  },
];

/** What belongs to each kind of entity, in the order its delete removes it. */
export const ENTITY_OWNED_DATA: Readonly<
  Record<OwningEntityKind, readonly OwnedDataDeclaration[]>
> = {
  collection: [
    FIELD_GROUP_VALUES,
    ...TRANSLATIONS,
    TRANSLATION_PROVENANCE,
    ...TABLES,
    ...WITH_THE_REGISTRY_ROW,
  ],
  single: [
    FIELD_GROUP_VALUES,
    ...TRANSLATIONS,
    TRANSLATION_PROVENANCE,
    ...TABLES,
    ...WITH_THE_REGISTRY_ROW,
  ],
  // A field group has no versions, autosaves, pins or documents of its own,
  // and keeps a many-to-many list on its own row rather than in a junction
  // table. The field-group values it owns are those of field groups nested in
  // it.
  fieldGroup: [
    FIELD_GROUP_VALUES,
    ...TRANSLATIONS,
    TABLES[0],
    {
      data: "registryRow",
      keptIn: "its registry row",
      removedBy: "the field-group registry's delete",
      removed: "withTheRegistryRow",
    },
  ],
};
