import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import type { FieldConfig } from "../../../collections/fields/types";
import type { FieldGroupFieldConfig } from "../../../collections/fields/types/component";
import { rethrowIfRuleCouldNotRun } from "../../../errors/rule-could-not-run";
import type { DynamicFieldGroupRecord } from "../../../schemas/dynamic-field-groups/types";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { CollectionRelationshipService } from "../../../services/collections/collection-relationship-service";
import type { RelatedRowReadContext } from "../../../services/collections/related-row-read-context";
import { TRUSTS_EVERY_COLLECTION } from "../../../services/collections/trust-grant";
import type { FieldGroupRegistryService } from "../../../services/field-groups/field-group-registry-service";
import { BaseService } from "../../../shared/base-service";
import {
  type FieldGroupReach,
  reachesPasswordField,
  stripPasswordFieldValues,
  stripServerOnlyColumns,
} from "../../../shared/lib/password-fields";
import type { Logger } from "../../../shared/types";
import {
  type LocalizedFieldRef,
  populateCompanionFieldsAllLocales,
  populateCompanionFieldsByLanguage,
} from "../../i18n/companion-join";
import type { SanitizedLocalizationConfig } from "../../i18n/config/types";
import {
  EVERY_TRANSLATION,
  EXACT_STORED_LANGUAGE,
} from "../../i18n/locale-selector";
import {
  type LocalizationSource,
  localizationNow,
} from "../../i18n/localization-source";
import { storesPerLanguage } from "../../i18n/per-language-storage";
import {
  resolveLocaleChain,
  resolveRequestedLocale,
} from "../../i18n/resolve-locale";
import { buildCompanionSchema } from "../../i18n/runtime/companion-io";
import {
  cachedCompanionReadiness,
  resolveCompanionSchemaReadiness,
  type CompanionReadiness,
} from "../../i18n/runtime/companion-readiness";
import { passwordReachOf } from "../password-reach";
import {
  isFieldGroupFieldType,
  withResolvedFieldGroupReferences,
} from "../storage/field-group-field-type";
import { currentFieldGroupTypeKey } from "../storage/field-group-type-key";

import {
  DEFAULT_COMPONENT_DEPTH,
  POPULATE_INTERNAL_COLUMNS,
  toSnakeCase,
  asComponentReferenceList,
  asRowBackedRelationFields,
  shouldTreatAsJson,
  type ComponentRow,
} from "./field-group-utils";
import { INSTANCE_ORDER, instanceKey } from "./instance-query";

/**
 * Parameters for populating component data on a single parent entry.
 */
/**
 * The caller context a component's related rows are judged against, mirroring
 * the relationship service's own options so it can be forwarded unchanged.
 */
/**
 * How a component read falls back from the language it asks for: as a parent
 * read's `fallbackLocale`, or {@link EXACT_STORED_LANGUAGE} for the language
 * named exactly as stored.
 */
export type ComponentFallbackLocale =
  | string
  | false
  | typeof EXACT_STORED_LANGUAGE;

/**
 * The caller context a component's related rows are judged against.
 *
 * A relationship reached through a field group is populated by the same service
 * a top-level one is, so it carries the same context rather than a parallel
 * declaration of it.
 */
export type ComponentReadAccess = RelatedRowReadContext;

/**
 * One language a component read is asked for: the locale, and the fallback
 * it is read with, as {@link PopulateComponentDataParams} names them.
 */
export interface ComponentReadLanguage {
  locale?: string;
  fallbackLocale?: ComponentFallbackLocale;
}

export interface PopulateComponentDataParams {
  /** The entry to populate with component data */
  entry: Record<string, unknown>;

  /** Database table name of the parent entity (e.g., 'dc_pages', 'single_homepage') */
  parentTable: string;

  /** Field definitions of the parent entity (to detect component fields) */
  fields: FieldConfig[];

  /**
   * Depth for relationship/upload field expansion within component data.
   * 0: Return IDs only. 1+: Recursive expansion.
   * @default 2
   */
  depth?: number;

  /**
   * Current depth level (internal use for recursive expansion).
   * @internal
   */
  currentDepth?: number;

  /**
   * Field selection whitelist for optimization.
   * When provided, only component fields with `select[fieldName] === true` are populated.
   */
  select?: Record<string, boolean>;

  /**
   * i18n: requested read locale. When set and an embedded component is localized, its
   * translatable fields resolve per language from the component's companion `_locales` table
   * (with fallback). Threaded down from the parent entity's read.
   */
  locale?: string;
  /**
   * i18n: per-request fallback control, forwarded from the parent read's `?fallback-locale`.
   * `false`/`"none"` suppresses fallback so an untranslated embedded component field stays
   * blank (the admin's no-fallback edit mode); a named locale overrides the configured chain.
   */
  fallbackLocale?: ComponentFallbackLocale;
  /**
   * Optional transaction-bound executor. When supplied, component-table reads
   * run on the transaction's connection (read-your-writes, #226) so a version
   * snapshot assembled inside the write transaction sees the components just
   * written in it. Omitted for ordinary reads (pooled connection).
   */
  executor?: unknown;
  /**
   * When true, a component read failure propagates instead of being caught and
   * replaced with a default (`null`/`[]`). Callers whose result feeds a durable
   * write — a webhook payload or version snapshot assembled inside the write
   * transaction — set this so a real read failure rolls the write back rather
   * than shipping a payload with silently-missing component data.
   */
  strict?: boolean;
  /**
   * The caller a related row reached THROUGH this component is redacted for.
   *
   * Component population expands the component's own relationship fields, which
   * copy whole rows out of the target collection. Neither the parent entity's
   * field registry nor the component's describes that collection's fields, so
   * without the caller here a field the target collection protects is returned
   * inside the populated component to anyone who reads the parent.
   *
   * Enforcement is opt-in for the reason established in the relationship
   * service: a caller that supplies no context is indistinguishable from an
   * anonymous one, and enforcing for the former strips fields from everybody.
   * The read paths opt in; write-side callers assembling payloads do not.
   */
  access?: ComponentReadAccess;
}

/**
 * Parameters for populating component data on multiple parent entries (batch).
 */
export interface PopulateComponentDataManyParams {
  entries: Record<string, unknown>[];
  parentTable: string;
  fields: FieldConfig[];
  depth?: number;
  currentDepth?: number;
  select?: Record<string, boolean>;
  /** i18n: requested read locale (see PopulateComponentDataParams.locale). */
  locale?: string;
  /** i18n: per-request fallback control (see PopulateComponentDataParams.fallbackLocale). */
  fallbackLocale?: ComponentFallbackLocale;
  /** See PopulateComponentDataParams.access. */
  access?: ComponentReadAccess;
  /**
   * When true, a component read failure propagates instead of every entry
   * taking the field's default: see PopulateComponentDataParams.strict.
   */
  strict?: boolean;
  /**
   * Optional transaction-bound executor: see PopulateComponentDataParams.executor.
   * A batch judged inside a write's transaction reads on its connection, both
   * to see what the transaction wrote and because a pooled read there waits on
   * the connection the transaction holds.
   */
  executor?: unknown;
}

/** One deserialized instance of a dynamic zone, with the kind it is. */
interface ZoneInstance {
  data: Record<string, unknown>;
  fields: FieldConfig[];
  slug: string;
}

/**
 * How a batch populate reads each of its component fields: the expansion
 * depth, the language, who related rows are read for, whether a failed read
 * propagates, and the connection it reads on. One object rather than seven
 * arguments, so the three per-kind readers cannot take them in a different
 * order.
 */
interface BatchPopulateRead {
  depth: number;
  currentDepth: number;
  locale?: string;
  fallbackLocale?: ComponentFallbackLocale;
  access: ComponentReadAccess;
  strict: boolean;
  executor?: unknown;
}

// Duplicated here (and in the mutation service) to avoid a cross-domain
// import into collections just for a type predicate.
function isFieldGroupField(field: FieldConfig): field is FieldGroupFieldConfig {
  return isFieldGroupFieldType(field.type);
}

/**
 * Whether an error is the component's own `comp_*` table simply not existing yet.
 *
 * The companion `_locales` reads no longer decide existence this way — they are told, because
 * catching a failed query is a valid existence check on SQLite and MySQL and aborts the whole
 * transaction on PostgreSQL. This one is about a DIFFERENT table: the field group's main table,
 * before its own migration has run. It is the same shape and the same hazard, and closing it needs
 * readiness for the main table rather than the companion, which is a separate piece of work.
 */
function isMissingComponentTableError(err: unknown): boolean {
  const message = [
    err instanceof Error ? err.message : String(err),
    err instanceof Error && err.cause instanceof Error ? err.cause.message : "",
  ].join(" ");
  return (
    message.includes("no such table") ||
    message.includes("doesn't exist") ||
    (message.includes("relation") && message.includes("does not exist"))
  );
}

export class FieldGroupQueryService extends BaseService {
  /**
   * A field group's companion readiness, resolved only where it is safe to.
   *
   * `executor` is present when this read runs on a caller's transaction connection. Resolving
   * there would issue a query, and a query against a missing relation aborts the whole transaction
   * on PostgreSQL — so that path reads the remembered verdict instead. The write paths resolve
   * before they open a transaction, so by then the answer is already known.
   */
  private companionReadiness(
    companion: {
      companionTableName: string;
      localizedFields: { column: string }[];
    },
    executor: unknown
  ): Promise<CompanionReadiness | undefined> | CompanionReadiness | undefined {
    return executor === undefined
      ? resolveCompanionSchemaReadiness(this.adapter, companion)
      : cachedCompanionReadiness(this.adapter, companion.companionTableName);
  }

  private readonly registryService: FieldGroupRegistryService;
  private relationshipService?: CollectionRelationshipService;

  /** The site's languages as they are now: the source may be the language registry. */
  private get localization(): SanitizedLocalizationConfig | undefined {
    return localizationNow(this.localizationSource);
  }

  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    registryService: FieldGroupRegistryService,
    relationshipService?: CollectionRelationshipService,
    // i18n: when set and an embedded component is localized, its translatable fields
    // resolve/write per language via the component's companion `comp_<slug>_locales` table.
    private readonly localizationSource?: LocalizationSource
  ) {
    super(adapter, logger);
    this.registryService = registryService;
    this.relationshipService = relationshipService;
  }

  /**
   * Where the password strip follows the field groups an instance holds
   * inline, by the field list it is read with: one resolution per list, so a
   * read of many instances of one field group resolves it once. A registry
   * read returns a list of its own, so this never outlives the read.
   */
  private readonly passwordReaches = new WeakMap<
    readonly FieldConfig[],
    Promise<FieldGroupReach>
  >();

  private passwordReach(
    componentFields: FieldConfig[],
    executor?: unknown
  ): Promise<FieldGroupReach> {
    let reach = this.passwordReaches.get(componentFields);
    if (!reach) {
      reach = passwordReachOf(
        componentFields,
        {
          getComponentFields: async (slug, on) =>
            (await this.registryService.getComponentBySlug(slug, on))?.fields ??
            null,
        },
        executor
      );
      this.passwordReaches.set(componentFields, reach);
    }
    return reach;
  }

  /**
   * i18n: overlay a localized component's translatable fields onto its deserialized
   * instance data from the companion `comp_<slug>_locales` table for the requested locale
   * (with fallback). No-op when localization is off, the component isn't localized, no
   * locale was requested, or it has no translatable fields. `dataArray` is mutated in place;
   * each item must carry the instance `id` (deserializeComponentRow sets it).
   *
   * `executor` mirrors the one the instance read uses: a snapshot assembled inside
   * a write transaction has just written these companion rows on that connection,
   * and a pooled read would not see them.
   *
   * The one-language case of {@link overlayLocalizedComponentByLanguage}.
   */
  private overlayLocalizedComponent(
    meta: DynamicFieldGroupRecord,
    dataArray: Record<string, unknown>[],
    locale: string | undefined,
    fallbackLocale?: ComponentFallbackLocale,
    executor?: unknown,
    /** A failed translation read propagates rather than returning shared values. */
    strict = false
  ): Promise<void> {
    return this.overlayLocalizedComponentByLanguage(
      meta,
      [{ dataArray, locale, fallbackLocale }],
      executor,
      strict
    );
  }

  /**
   * {@link overlayLocalizedComponent} for several languages at once, each over
   * its own copy of the instances and with its own fallback: the companion is
   * read ONCE for every language's chain, and each copy is then resolved by
   * its own chain, as an overlay of that language alone resolves it.
   */
  private async overlayLocalizedComponentByLanguage(
    meta: DynamicFieldGroupRecord,
    byLanguage: readonly (ComponentReadLanguage & {
      dataArray: Record<string, unknown>[];
    })[],
    executor?: unknown,
    /** A failed translation read propagates rather than returning shared values. */
    strict = false
  ): Promise<void> {
    const localization = this.localization;
    const languages = byLanguage.filter(
      language => language.dataArray.length > 0
    );
    // Whether its values are kept per language at all: when it is translated, or under
    // per-language storage for every component.
    if (!localization || !storesPerLanguage(meta) || languages.length === 0) {
      return;
    }
    const companion = buildCompanionSchema({
      slug: meta.slug,
      tableName: meta.tableName,
      fields: meta.fields as { name: string; type: string }[],
      dialect: this.adapter.dialect,
      // Components are never Draft/Published — companion has no `_status`.
      status: false,
    });
    if (!companion) return;

    const named: {
      dataArray: Record<string, unknown>[];
      localeChain: string[];
    }[] = [];
    for (const { dataArray, locale, fallbackLocale } of languages) {
      // `?locale=all` (admin/export): the parent read projects its own localized fields as
      // language-keyed maps, so mirror that for the embedded component's translatable fields —
      // otherwise they would be missing entirely (the main comp_* table omits those columns).
      if (locale === EVERY_TRANSLATION) {
        await this.overlayEveryTranslation(
          meta,
          companion,
          dataArray,
          localization.locales.map(l => l.code),
          executor,
          strict
        );
        continue;
      }
      // Resolve an absent `locale` to the default (the parent read treats no explicit `?locale` as
      // the default locale), so a default-locale read still overlays the component's companion
      // values instead of returning the omitted main-table columns.
      // A language read exactly as stored is taken as named, active or not: a
      // removed language is kept, and validating it would read the default's
      // values in its place.
      const exact = fallbackLocale === EXACT_STORED_LANGUAGE;
      const requested =
        exact && locale !== undefined
          ? locale
          : resolveRequestedLocale(localization, locale);
      // Through the shared resolver, so a component read falls back exactly as
      // the collection and single reads around it do. `requested` is already
      // resolved and is never `all` here, so the chain is never null; the
      // fallback keeps the contract this path always had rather than asserting.
      named.push({
        dataArray,
        localeChain: exact
          ? [requested]
          : (resolveLocaleChain(localization, requested, fallbackLocale) ?? [
              requested,
            ]),
      });
    }
    if (named.length === 0) return;
    // Resolved before the overlay runs, because inside a transaction it can only be read and the
    // read itself must not be what fails.
    const readiness = await this.companionReadiness(companion, executor);
    // Within the database's limit on a statement's parameters, in as many
    // reads as that takes; the rows are filled only once every read has
    // succeeded, so a contained failure leaves none half translated, with a
    // raw value or a password the strip below never saw.
    const overlay = () =>
      populateCompanionFieldsByLanguage({
        db: (executor ?? this.adapter.getDrizzle()) as Parameters<
          typeof populateCompanionFieldsByLanguage
        >[0]["db"],
        companionTable: companion.table,
        localizedFields: companion.localizedFields,
        byLanguage: named.map(({ dataArray, localeChain }) => ({
          rows: dataArray,
          localeChain,
        })),
        idKey: "id",
        readiness,
        maxParams: this.adapter.getCapabilities().maxParamsPerQuery,
      });

    const ran = await this.runContainedOverlay(
      meta.slug,
      companion.companionTableName,
      executor,
      strict,
      overlay
    );
    if (!ran) return;
    for (const { dataArray } of named) {
      this.decodeJsonLocalizedValues(
        meta,
        companion.localizedFields,
        dataArray,
        false
      );
      await this.stripOverlaidPasswords(
        meta,
        companion.localizedFields,
        dataArray,
        false,
        executor
      );
    }
  }

  /**
   * The overlay of a read of every translation: each translatable field as a
   * map by language, for every configured language.
   */
  private async overlayEveryTranslation(
    meta: DynamicFieldGroupRecord,
    companion: NonNullable<ReturnType<typeof buildCompanionSchema>>,
    dataArray: Record<string, unknown>[],
    configuredLocales: string[],
    executor: unknown,
    strict: boolean
  ): Promise<void> {
    const allReadiness = await this.companionReadiness(companion, executor);
    const ran = await this.runContainedOverlay(
      meta.slug,
      companion.companionTableName,
      executor,
      strict,
      () =>
        populateCompanionFieldsAllLocales({
          db: (executor ?? this.adapter.getDrizzle()) as Parameters<
            typeof populateCompanionFieldsAllLocales
          >[0]["db"],
          companionTable: companion.table,
          localizedFields: companion.localizedFields,
          rows: dataArray,
          locales: configuredLocales,
          idKey: "id",
          readiness: allReadiness,
          maxParams: this.adapter.getCapabilities().maxParamsPerQuery,
        })
    );
    if (!ran) return;
    this.decodeJsonLocalizedValues(
      meta,
      companion.localizedFields,
      dataArray,
      true
    );
    await this.stripOverlaidPasswords(
      meta,
      companion.localizedFields,
      dataArray,
      true,
      executor
    );
  }

  /**
   * Withhold the passwords a companion overlay put back: a translated
   * password, or one in a translated container, is stored on the companion
   * row, so the strip the instance row had before the overlay never saw it.
   * A read of every translation holds each translated field as a map by
   * language, and the walk goes into each language's value in turn.
   */
  private async stripOverlaidPasswords(
    meta: DynamicFieldGroupRecord,
    localizedFields: readonly LocalizedFieldRef[],
    dataArray: Record<string, unknown>[],
    everyLanguage: boolean,
    executor?: unknown
  ): Promise<void> {
    const fields = meta.fields;
    const reach = await this.passwordReach(fields, executor);
    if (!reachesPasswordField(fields, reach)) return;
    const translated = new Set(localizedFields.map(field => field.name));
    const walk: FieldGroupReach = everyLanguage
      ? {
          ...reach,
          keyedByLanguage: field =>
            field.name !== undefined && translated.has(field.name),
        }
      : reach;
    for (const data of dataArray) stripPasswordFieldValues(data, fields, walk);
  }

  /**
   * Run a companion overlay, containing a failure the caller could not survive.
   *
   * Shared by both overlay shapes so they cannot drift, which they already did once: the
   * single-locale branch was contained and the all-locale branch returned before reaching it.
   *
   * Off a transaction, a failure is contained. The overlay runs AFTER the component's shared values
   * are deserialized, and the component read above replaces the whole field with null or an empty
   * list when anything throws — so a fault that costs the reader one translation was costing them
   * the record. Losing the overlay is the smaller loss, and it is logged rather than silent.
   *
   * On the caller's transaction connection it propagates. The failure has already aborted that
   * transaction, so containing it here would only move the error onto whatever statement runs next,
   * which is the failure mode these reads stopped catching in order to fix.
   *
   * Returns whether the overlay ran, so a caller can skip the decoding that depends on it.
   */
  private async runContainedOverlay(
    slug: string,
    companionTableName: string,
    executor: unknown,
    strict: boolean,
    overlay: () => Promise<unknown>
  ): Promise<boolean> {
    // On a transaction a failed read has aborted it, and a strict reader
    // judges what is stored: either way the failure is the caller's to see.
    if (executor !== undefined || strict) {
      await overlay();
      return true;
    }
    try {
      await overlay();
      return true;
    } catch (error) {
      this.logger.error(
        `Could not read translations for component "${slug}" from ` +
          `${companionTableName}. Its shared values are being returned untranslated: ` +
          `${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Parse JSON-backed localized values (richText/group/repeater/json) back to object shapes.
   * The companion stores them as serialized text, so without this reads would return raw JSON
   * strings, unlike the main-table deserialization the parent ran before this overlay. When
   * `allLocales` is true each field holds a language-keyed map (`{ en, de }`) whose per-locale
   * values are decoded; otherwise the field holds a single resolved value.
   */
  private decodeJsonLocalizedValues(
    meta: DynamicFieldGroupRecord,
    localizedFields: { name: string; column: string }[],
    dataArray: Record<string, unknown>[],
    allLocales: boolean
  ): void {
    const jsonLocalized = localizedFields.filter(lf => {
      const def = meta.fields.find(f => "name" in f && f.name === lf.name);
      return def ? shouldTreatAsJson(def) : false;
    });
    if (jsonLocalized.length === 0) return;
    const parse = (value: unknown): unknown => {
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        // A non-JSON string (or already-parsed value) stays as-is.
        return value;
      }
    };
    for (const row of dataArray) {
      for (const lf of jsonLocalized) {
        if (allLocales) {
          const keyed = row[lf.name];
          if (keyed && typeof keyed === "object") {
            const map = keyed as Record<string, unknown>;
            for (const code of Object.keys(map)) {
              map[code] = parse(map[code]);
            }
          }
        } else {
          row[lf.name] = parse(row[lf.name]);
        }
      }
    }
  }

  setRelationshipService(service: CollectionRelationshipService): void {
    if (!this.relationshipService) {
      this.relationshipService = service;
    }
  }

  /**
   * Populate component data for a single parent entry.
   *
   * The one-language case of {@link populateComponentDataByLanguage}.
   */
  async populateComponentData(
    params: PopulateComponentDataParams
  ): Promise<Record<string, unknown>> {
    const [populated] = await this.populateComponentDataInEach(params, [
      { locale: params.locale, fallbackLocale: params.fallbackLocale },
    ]);
    return populated;
  }

  /**
   * {@link populateComponentData} for several languages at once, each with its
   * own fallback: every component table is read once for them all, and each
   * localized one's companion once for every language's chain. Each language
   * gets its own copy of the entry, resolved as a read of that language alone
   * resolves it. In the order the languages were asked.
   */
  async populateComponentDataByLanguage(
    params: Omit<PopulateComponentDataParams, "locale" | "fallbackLocale"> & {
      languages: readonly ComponentReadLanguage[];
    }
  ): Promise<Record<string, unknown>[]> {
    return this.populateComponentDataInEach(params, params.languages);
  }

  private async populateComponentDataInEach(
    params: Omit<PopulateComponentDataParams, "locale" | "fallbackLocale">,
    languages: readonly ComponentReadLanguage[]
  ): Promise<Record<string, unknown>[]> {
    const {
      entry,
      parentTable,
      fields,
      depth = DEFAULT_COMPONENT_DEPTH,
      currentDepth = 0,
      select,
      executor,
      strict = false,
      access = { trusted: TRUSTS_EVERY_COLLECTION },
    } = params;
    const entryId = entry.id as string;
    if (!entryId) return languages.map(() => entry);

    const results = languages.map(() => ({ ...entry }));

    for (const field of fields) {
      if (!isFieldGroupField(field)) continue;
      const fieldName = field.name;

      if (!this.shouldPopulateField(fieldName, select)) {
        continue;
      }

      // References resolved once, before the dispatch AND its failure path:
      // the populate default for a migrated dynamic zone is a list, and the
      // catch below can only answer that from the resolved field.
      const f = withResolvedFieldGroupReferences(field);
      try {
        let values: unknown[] | undefined;
        if (f.components && f.components.length > 0) {
          values = await this.populateMultiComponentField(
            entryId,
            parentTable,
            fieldName,
            f,
            depth,
            currentDepth,
            languages,
            executor,
            strict,
            access
          );
        } else if (f.component) {
          values = f.repeatable
            ? await this.populateRepeatableField(
                entryId,
                parentTable,
                fieldName,
                f.component,
                depth,
                currentDepth,
                languages,
                executor,
                strict,
                access
              )
            : await this.populateSingleField(
                entryId,
                parentTable,
                fieldName,
                f.component,
                depth,
                currentDepth,
                languages,
                executor,
                strict,
                access
              );
        }
        values?.forEach((value, index) => {
          results[index][fieldName] = value;
        });
      } catch (error) {
        // A rule that could not run never answered: the request ends with
        // that, not with the component replaced by a default.
        rethrowIfRuleCouldNotRun(error);
        // In strict mode a read failure must roll the write back rather than
        // ship a payload with silently-missing component data.
        if (strict) throw error;
        this.logger.debug("Could not populate component field", {
          fieldName,
          error: error instanceof Error ? error.message : String(error),
        });
        for (const result of results) {
          result[fieldName] = this.getPopulateDefaultValue(f);
        }
      }
    }

    return results;
  }

  /**
   * Populate component data for multiple parent entries (batch).
   */
  async populateComponentDataMany(
    params: PopulateComponentDataManyParams
  ): Promise<Record<string, unknown>[]> {
    const {
      entries,
      parentTable,
      fields,
      depth = DEFAULT_COMPONENT_DEPTH,
      currentDepth = 0,
      select,
      locale,
      fallbackLocale,
      access = { trusted: TRUSTS_EVERY_COLLECTION },
      strict = false,
      executor,
    } = params;
    if (entries.length === 0) return entries;

    const entryIds = entries
      .map(e => e.id as string)
      .filter((id): id is string => Boolean(id));
    if (entryIds.length === 0) return entries;

    const componentFields: FieldGroupFieldConfig[] = [];
    for (const field of fields) {
      if (isFieldGroupField(field)) {
        if (!this.shouldPopulateField(field.name, select)) {
          continue;
        }
        // Resolved once, at collection: every reader below — the dispatch,
        // the slug reads, and the populate default for a failed or absent
        // entry — sees the references on the keys it opens, whichever
        // spelling the stored definition carries.
        componentFields.push(withResolvedFieldGroupReferences(field));
      }
    }
    if (componentFields.length === 0) return entries;

    const fieldDataMaps = new Map<string, Map<string, unknown>>();
    const read: BatchPopulateRead = {
      depth,
      currentDepth,
      locale,
      fallbackLocale,
      access,
      strict,
      executor,
    };

    for (const field of componentFields) {
      try {
        if (field.components && field.components.length > 0) {
          const dataMap = await this.batchPopulateMultiComponentField(
            entryIds,
            parentTable,
            field.name,
            field,
            read
          );
          fieldDataMaps.set(field.name, dataMap);
        } else if (field.component) {
          if (field.repeatable) {
            const dataMap = await this.batchPopulateRepeatableField(
              entryIds,
              parentTable,
              field.name,
              field.component,
              read
            );
            fieldDataMaps.set(field.name, dataMap);
          } else {
            const dataMap = await this.batchPopulateSingleField(
              entryIds,
              parentTable,
              field.name,
              field.component,
              read
            );
            fieldDataMaps.set(field.name, dataMap);
          }
        }
      } catch (error) {
        // A rule that could not run never answered: see the catch above.
        rethrowIfRuleCouldNotRun(error);
        // A caller judging a document by what it holds cannot take a default
        // for a field it failed to read.
        if (strict) throw error;
        this.logger.debug("Could not batch populate component field", {
          fieldName: field.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return entries.map(entry => {
      const entryId = entry.id as string;
      if (!entryId) return entry;

      const result = { ...entry };

      for (const field of componentFields) {
        const dataMap = fieldDataMaps.get(field.name);
        if (dataMap && dataMap.has(entryId)) {
          result[field.name] = dataMap.get(entryId);
        } else {
          result[field.name] = this.getPopulateDefaultValue(field);
        }
      }

      return result;
    });
  }

  /**
   * A single component field's instance, in each language asked: the row is
   * read once and deserialized for each language, so no language's overlay
   * reaches another's copy.
   */
  private async populateSingleField(
    parentId: string,
    parentTable: string,
    fieldName: string,
    componentSlug: string,
    depth: number,
    currentDepth: number,
    languages: readonly ComponentReadLanguage[],
    executor?: unknown,
    strict = false,
    access: ComponentReadAccess = { trusted: TRUSTS_EVERY_COLLECTION }
  ): Promise<(Record<string, unknown> | null)[]> {
    const meta = await this.registryService.getComponent(
      componentSlug,
      executor
    );
    const componentFields = meta.fields;
    const rows = await this.getExistingInstances(
      meta.tableName,
      parentId,
      parentTable,
      fieldName,
      executor,
      strict
    );

    if (rows.length === 0) return languages.map(() => null);

    const reach = await this.passwordReach(componentFields, executor);
    const byLanguage = languages.map(language => ({
      ...language,
      dataArray: [
        this.deserializeComponentRow(
          ownCopy(rows[0], languages.length),
          componentFields,
          false,
          reach
        ),
      ],
    }));
    // i18n: overlay translatable fields from the companion for each requested locale.
    await this.overlayLocalizedComponentByLanguage(
      meta,
      byLanguage,
      executor,
      strict
    );
    const results: Record<string, unknown>[] = [];
    for (const { dataArray } of byLanguage) {
      results.push(
        await this.expandComponentRelationships(
          dataArray[0],
          componentSlug,
          componentFields,
          depth,
          currentDepth + 1,
          access
        )
      );
    }
    return results;
  }

  /**
   * A repeatable component field's instances, in each language asked: the
   * rows are read once and deserialized for each language.
   */
  private async populateRepeatableField(
    parentId: string,
    parentTable: string,
    fieldName: string,
    componentSlug: string,
    depth: number,
    currentDepth: number,
    languages: readonly ComponentReadLanguage[],
    executor?: unknown,
    strict = false,
    access: ComponentReadAccess = { trusted: TRUSTS_EVERY_COLLECTION }
  ): Promise<Record<string, unknown>[][]> {
    const meta = await this.registryService.getComponent(
      componentSlug,
      executor
    );
    const componentFields = meta.fields;
    const rows = await this.getExistingInstances(
      meta.tableName,
      parentId,
      parentTable,
      fieldName,
      executor,
      strict
    );

    const reach = await this.passwordReach(componentFields, executor);
    const byLanguage = languages.map(language => ({
      ...language,
      dataArray: rows.map(row =>
        this.deserializeComponentRow(
          ownCopy(row, languages.length),
          componentFields,
          false,
          reach
        )
      ),
    }));

    // i18n: overlay translatable fields per instance from the companion.
    await this.overlayLocalizedComponentByLanguage(
      meta,
      byLanguage,
      executor,
      strict
    );

    const results: Record<string, unknown>[][] = [];
    for (const { dataArray } of byLanguage) {
      results.push(
        await this.expandComponentRelationshipsMany(
          dataArray,
          componentSlug,
          componentFields,
          depth,
          currentDepth + 1,
          access
        )
      );
    }
    return results;
  }

  /**
   * A dynamic zone's instances, in each language asked: each allowed
   * component's rows are read once, and each instance deserialized for each
   * language.
   */
  private async populateMultiComponentField(
    parentId: string,
    parentTable: string,
    fieldName: string,
    field: FieldGroupFieldConfig,
    depth: number,
    currentDepth: number,
    languages: readonly ComponentReadLanguage[],
    executor?: unknown,
    strict = false,
    access: ComponentReadAccess = { trusted: TRUSTS_EVERY_COLLECTION }
  ): Promise<Record<string, unknown>[][]> {
    const allowedSlugs = field.components ?? [];
    const allRows: {
      row: ComponentRow;
      fields: FieldConfig[];
      slug: string;
    }[] = [];

    for (const slug of allowedSlugs) {
      try {
        const meta = await this.registryService.getComponent(slug, executor);
        const rows = await this.getExistingInstances(
          meta.tableName,
          parentId,
          parentTable,
          fieldName,
          executor,
          strict
        );
        for (const row of rows) {
          allRows.push({ row, fields: meta.fields, slug });
        }
      } catch (error) {
        // A rule that could not run never answered: see the catches above.
        rethrowIfRuleCouldNotRun(error);
        // In strict mode surface the failure so a durable payload is not built
        // from a partial dynamic-zone read.
        if (strict) throw error;
        this.logger.debug("Could not load component for populate", {
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    allRows.sort(
      (a, b) =>
        (a.row[STORAGE_FORMAT.columns.order] ?? 0) -
        (b.row[STORAGE_FORMAT.columns.order] ?? 0)
    );

    const results: Record<string, unknown>[][] = languages.map(() => []);
    for (const { row, fields, slug } of allRows) {
      const reach = await this.passwordReach(fields, executor);
      const byLanguage = languages.map(language => ({
        ...language,
        dataArray: [
          this.deserializeComponentRow(
            ownCopy(row, languages.length),
            fields,
            true,
            reach
          ),
        ],
      }));
      // i18n: overlay translatable fields from the row's component companion. getComponent
      // is registry-cached, so the per-row meta lookup is cheap; dynamic-zone instances
      // may span several component types, each with its own companion.
      const meta = await this.registryService.getComponent(slug, executor);
      await this.overlayLocalizedComponentByLanguage(
        meta,
        byLanguage,
        executor,
        strict
      );
      for (const [index, { dataArray }] of byLanguage.entries()) {
        results[index].push(
          await this.expandComponentRelationships(
            dataArray[0],
            slug,
            fields,
            depth,
            currentDepth + 1,
            access
          )
        );
      }
    }

    return results;
  }

  /**
   * One field group's stored instances for many parents, with its definition
   * and where the password strip follows the field groups it holds inline.
   */
  private async batchRead(
    componentSlug: string,
    parentIds: string[],
    parentTable: string,
    fieldName: string,
    read: Pick<BatchPopulateRead, "strict" | "executor">
  ) {
    const meta = await this.registryService.getComponent(
      componentSlug,
      read.executor
    );
    const componentFields = meta.fields;
    const rows = await this.batchGetInstances(
      meta.tableName,
      parentIds,
      parentTable,
      fieldName,
      read
    );
    return {
      meta,
      componentFields,
      rows,
      reach: await this.passwordReach(componentFields, read.executor),
    };
  }

  private async batchPopulateSingleField(
    parentIds: string[],
    parentTable: string,
    fieldName: string,
    componentSlug: string,
    read: BatchPopulateRead
  ): Promise<Map<string, unknown>> {
    const { meta, componentFields, rows, reach } = await this.batchRead(
      componentSlug,
      parentIds,
      parentTable,
      fieldName,
      read
    );

    // Deserialize first (one per parent), i18n-overlay the whole batch in a single
    // companion query, THEN expand relationships — overlay must precede expansion
    // because expand may return a new object, breaking the mutate-in-place reference.
    const collected: { parentId: string; data: Record<string, unknown> }[] = [];
    for (const row of rows) {
      const parentId = row[STORAGE_FORMAT.columns.parentId];
      if (!collected.some(c => c.parentId === parentId)) {
        collected.push({
          parentId,
          data: this.deserializeComponentRow(
            row,
            componentFields,
            false,
            reach
          ),
        });
      }
    }
    await this.overlayLocalizedComponent(
      meta,
      collected.map(c => c.data),
      read.locale,
      read.fallbackLocale,
      read.executor,
      read.strict
    );

    const result = new Map<string, unknown>();
    for (const { parentId, data } of collected) {
      result.set(
        parentId,
        await this.expandComponentRelationships(
          data,
          componentSlug,
          componentFields,
          read.depth,
          read.currentDepth + 1,
          read.access
        )
      );
    }
    return result;
  }

  private async batchPopulateRepeatableField(
    parentIds: string[],
    parentTable: string,
    fieldName: string,
    componentSlug: string,
    read: BatchPopulateRead
  ): Promise<Map<string, unknown>> {
    const { rows, reach, meta, componentFields } = await this.batchRead(
      componentSlug,
      parentIds,
      parentTable,
      fieldName,
      read
    );

    // Deserialize all (rows arrive ordered by (_parent_id, _order)), overlay the whole
    // batch once, then expand — same ordering constraint as batchPopulateSingleField.
    const entries: { parentId: string; data: Record<string, unknown> }[] =
      rows.map(row => ({
        parentId: row[STORAGE_FORMAT.columns.parentId],
        data: this.deserializeComponentRow(row, componentFields, false, reach),
      }));
    await this.overlayLocalizedComponent(
      meta,
      entries.map(e => e.data),
      read.locale,
      read.fallbackLocale,
      read.executor,
      read.strict
    );

    const grouped = new Map<string, Record<string, unknown>[]>();
    for (const { parentId, data } of entries) {
      if (!grouped.has(parentId)) grouped.set(parentId, []);
      grouped
        .get(parentId)!
        .push(
          await this.expandComponentRelationships(
            data,
            componentSlug,
            componentFields,
            read.depth,
            read.currentDepth + 1,
            read.access
          )
        );
    }
    return grouped;
  }

  private async batchPopulateMultiComponentField(
    parentIds: string[],
    parentTable: string,
    fieldName: string,
    field: FieldGroupFieldConfig,
    read: BatchPopulateRead
  ): Promise<Map<string, unknown>> {
    const allowedSlugs = field.components ?? [];

    const groupedByParent = new Map<
      string,
      { row: ComponentRow; fields: FieldConfig[]; slug: string }[]
    >();

    for (const slug of allowedSlugs) {
      try {
        const meta = await this.registryService.getComponent(
          slug,
          read.executor
        );
        const rows = await this.batchGetInstances(
          meta.tableName,
          parentIds,
          parentTable,
          fieldName,
          read
        );
        for (const row of rows) {
          const parentId = row[STORAGE_FORMAT.columns.parentId];
          if (!groupedByParent.has(parentId)) {
            groupedByParent.set(parentId, []);
          }
          groupedByParent.get(parentId)!.push({
            row,
            fields: meta.fields,
            slug,
          });
        }
      } catch (error) {
        // As the single and repeatable reads do: a strict reader is told,
        // since a zone read without one of its kinds is not the zone stored.
        // A missing table is already read as empty by the instance read, so
        // what reaches here is a failed lookup, whatever its message says.
        if (read.strict) throw error;
        this.logger.debug("Could not load component for batch populate", {
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Deserialized first, then overlaid kind by kind, then expanded: the
    // overlay mutates each instance in place, and expansion may return a new
    // object.
    const deserialized = await this.deserializeZoneInstances(
      groupedByParent,
      read
    );
    await this.overlayZoneByKind(deserialized, read);

    const result = new Map<string, unknown>();
    for (const [parentId, instances] of deserialized) {
      const expandedItems: Record<string, unknown>[] = [];
      for (const { data, fields, slug } of instances) {
        expandedItems.push(
          await this.expandComponentRelationships(
            data,
            slug,
            fields,
            read.depth,
            read.currentDepth + 1,
            read.access
          )
        );
      }
      result.set(parentId, expandedItems);
    }

    return result;
  }

  /** A zone's instances per parent, deserialized in their stored order. */
  private async deserializeZoneInstances(
    groupedByParent: Map<
      string,
      { row: ComponentRow; fields: FieldConfig[]; slug: string }[]
    >,
    read: Pick<BatchPopulateRead, "executor">
  ): Promise<Map<string, ZoneInstance[]>> {
    const deserialized = new Map<string, ZoneInstance[]>();
    for (const [parentId, items] of groupedByParent) {
      items.sort(
        (a, b) =>
          (a.row[STORAGE_FORMAT.columns.order] ?? 0) -
          (b.row[STORAGE_FORMAT.columns.order] ?? 0)
      );
      const instances: ZoneInstance[] = [];
      for (const { row, fields, slug } of items) {
        instances.push({
          data: this.deserializeComponentRow(
            row,
            fields,
            true,
            await this.passwordReach(fields, read.executor)
          ),
          fields,
          slug,
        });
      }
      deserialized.set(parentId, instances);
    }
    return deserialized;
  }

  /**
   * i18n: overlay a zone's translatable fields from each kind's companion in
   * one read for every instance of that kind across the batch, not one read
   * per instance. Each instance is mutated in place.
   */
  private async overlayZoneByKind(
    instancesByParent: Map<string, ZoneInstance[]>,
    read: BatchPopulateRead
  ): Promise<void> {
    const bySlug = new Map<string, Record<string, unknown>[]>();
    for (const instances of instancesByParent.values()) {
      for (const { data, slug } of instances) {
        const ofSlug = bySlug.get(slug);
        if (ofSlug) ofSlug.push(data);
        else bySlug.set(slug, [data]);
      }
    }
    for (const [slug, dataArray] of bySlug) {
      await this.overlayLocalizedComponent(
        await this.registryService.getComponent(slug, read.executor),
        dataArray,
        read.locale,
        read.fallbackLocale,
        read.executor,
        read.strict
      );
    }
  }

  private async getExistingInstances(
    tableName: string,
    parentId: string,
    parentTable: string,
    fieldName: string,
    // Optional transaction-bound executor. When supplied the read runs on the
    // transaction's connection (read-your-writes, #226), so a version snapshot
    // captured inside the write transaction sees the components just written in
    // it. Omitted for ordinary reads, which use the pooled connection.
    executor?: unknown,
    // When true, only a MISSING component table is tolerated; any other read
    // failure propagates so a durable webhook/version payload is not built from
    // a component silently read as empty.
    strict = false
  ): Promise<ComponentRow[]> {
    try {
      const rows = await this.adapter.select<ComponentRow>(
        tableName,
        {
          where: this.whereAnd(instanceKey(parentId, parentTable, fieldName)),
          orderBy: INSTANCE_ORDER,
        },
        executor
      );
      return this.withoutServerOnlyColumns(rows, tableName);
    } catch (error) {
      // The comp_* table may not exist yet (a component before its migration
      // runs) — tolerate that and read as empty. In strict mode a real failure
      // (transient/permission/schema) instead propagates.
      if (strict && !isMissingComponentTableError(error)) {
        throw error;
      }
      this.logger.debug("Could not query component table", {
        tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // Results are ordered by `(_parent_id ASC, _order ASC)` so grouped
  // results maintain correct array ordering.
  private async batchGetInstances(
    tableName: string,
    parentIds: string[],
    parentTable: string,
    fieldName: string,
    // As `getExistingInstances` takes them: only a missing table is read as
    // empty under `strict`, and `executor` reads on a write's transaction.
    read: Pick<BatchPopulateRead, "strict" | "executor">
  ): Promise<ComponentRow[]> {
    if (parentIds.length === 0) return [];

    try {
      const rows = await this.adapter.select<ComponentRow>(
        tableName,
        {
          where: {
            and: [
              {
                column: STORAGE_FORMAT.columns.parentId,
                op: "IN",
                value: parentIds,
              },
              {
                column: STORAGE_FORMAT.columns.parentTable,
                op: "=",
                value: parentTable,
              },
              {
                column: STORAGE_FORMAT.columns.parentField,
                op: "=",
                value: fieldName,
              },
            ],
          },
          orderBy: [
            { column: STORAGE_FORMAT.columns.parentId, direction: "asc" },
            { column: STORAGE_FORMAT.columns.order, direction: "asc" },
          ],
        },
        read.executor
      );
      return this.withoutServerOnlyColumns(rows, tableName);
    } catch (error) {
      // On a transaction a failed statement has aborted it on PostgreSQL, so
      // reading on as though the table were empty is possible on the other
      // dialects only: every dialect refuses alike instead.
      if (
        read.executor !== undefined ||
        (read.strict && !isMissingComponentTableError(error))
      ) {
        throw error;
      }
      this.logger.debug("Could not batch query component table", {
        tableName,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Remove the columns that never leave the server from rows read here.
   *
   * Every instance this service returns is built from these two reads, and
   * the instance keeps any column it does not recognise as a field, so a
   * column a schema hook contributed to the field group's table would reach
   * the parent entry's response. Stripped at the read rather than per
   * instance so no caller can build one from an unstripped row.
   */
  private withoutServerOnlyColumns(
    rows: ComponentRow[],
    tableName: string
  ): ComponentRow[] {
    for (const row of rows) stripServerOnlyColumns(row, tableName);
    return rows;
  }

  private deserializeComponentRow(
    row: ComponentRow,
    componentFields: FieldConfig[],
    includeComponentType: boolean,
    /** Where the password strip follows field groups held inline. */
    reach: FieldGroupReach
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    result.id = row.id;

    if (includeComponentType && row[STORAGE_FORMAT.columns.type]) {
      result[currentFieldGroupTypeKey] = row[STORAGE_FORMAT.columns.type];
    }

    // A row's keys may be the field's name or its snake_case column name, so
    // a field is found under either. Missed, a JSON field such as a to-many
    // relationship named `cardTags` comes back as its stored text.
    const fieldByColumn = new Map<string, FieldConfig>();
    for (const field of componentFields) {
      if ("name" in field && field.name) {
        fieldByColumn.set(toSnakeCase(field.name), field);
        fieldByColumn.set(field.name, field);
      }
    }

    for (const [key, value] of Object.entries(row)) {
      if (key === "id" || POPULATE_INTERNAL_COLUMNS.has(key)) continue;

      const field = fieldByColumn.get(key);
      const fieldName: string =
        field && "name" in field && typeof field.name === "string"
          ? field.name
          : key;

      if (
        field &&
        shouldTreatAsJson(field) &&
        value != null &&
        typeof value === "string"
      ) {
        try {
          result[fieldName] = JSON.parse(value);
        } catch {
          result[fieldName] = value;
        }
      } else {
        result[fieldName] = value ?? null;
      }
      if (field) {
        result[fieldName] = asComponentReferenceList(field, result[fieldName]);
      }
    }

    // Password fields are write-only; strip stored hashes (including any
    // nested in group/repeater containers, and in the field groups they hold
    // inline) before the instance is returned.
    stripPasswordFieldValues(result, componentFields, reach);

    return result;
  }

  private getPopulateDefaultValue(
    field: FieldGroupFieldConfig
  ): null | unknown[] {
    if (field.repeatable || (field.components && field.components.length > 0)) {
      return [];
    }
    return null;
  }

  private shouldPopulateField(
    fieldName: string,
    select?: Record<string, boolean>
  ): boolean {
    if (!select || Object.keys(select).length === 0) {
      return true;
    }
    return select[fieldName] === true;
  }

  private async expandComponentRelationships(
    componentData: Record<string, unknown>,
    componentSlug: string,
    componentFields: FieldConfig[],
    depth: number,
    currentDepth: number,
    access: ComponentReadAccess = { trusted: TRUSTS_EVERY_COLLECTION }
  ): Promise<Record<string, unknown>> {
    if (!this.relationshipService) {
      return componentData;
    }

    if (depth === 0 || currentDepth >= depth) {
      return componentData;
    }

    try {
      // FieldConfig[] and FieldDefinition[] are structurally compatible
      // for the purposes of relationship expansion. A many-to-many is handed
      // over as the row-backed list it is on a component, so its related
      // entries are found from the ids on the row rather than a junction table
      // a component does not have.
      const fields = asRowBackedRelationFields(
        componentFields
      ) as unknown as Parameters<
        typeof this.relationshipService.expandRelationships
      >[2];

      const expanded = await this.relationshipService.expandRelationships(
        componentData,
        `comp:${componentSlug}`,
        fields,
        {
          depth,
          currentDepth,
          // The related row belongs to another collection, so it is judged by
          // that collection's field rules for this caller.
          enforceFieldAccess: access.enforceFieldAccess,
          enforceCollectionAccess: access.enforceCollectionAccess,
          user: access.user,
          // Beside `user`, never folded into it. Dropping it here rebuilds a
          // VALID context describing a different caller — one whose related
          // rows are judged by nobody — which is silent and leaks.
          fieldAccessUser: access.fieldAccessUser,
          overrideAccess: access.overrideAccess,
          // Narrows that bypass per RELATED collection. Absent means unchanged;
          // dropping it here would silently restore the full bypass.
          trusted: access.trusted,
          authenticatedScope: access.authenticatedScope,
          targetPolicies: access.targetPolicies,
          targetCompanions: access.targetCompanions,
          // The read's verdicts, so every component instance relating to one
          // target shares one question rather than asking it afresh.
          targetVerdicts: access.targetVerdicts,
          // And the match columns built from those verdicts' filters.
          targetRuleMatches: access.targetRuleMatches,
          withheldByAccess: access.withheldByAccess,
          locale: access.locale,
          // Every language the read falls back through, so a target's
          // localized rule filter is judged as a direct read judges it.
          localeChain: access.localeChain,
          status: access.status,
        }
      );

      return expanded;
    } catch (error) {
      // A rule that could not run never answered: the request ends with
      // that, not with the component's relationships left unexpanded.
      rethrowIfRuleCouldNotRun(error);
      this.logger.debug("Could not expand relationships in component data", {
        componentSlug,
        error: error instanceof Error ? error.message : String(error),
      });
      return componentData;
    }
  }

  private async expandComponentRelationshipsMany(
    componentDataArray: Record<string, unknown>[],
    componentSlug: string,
    componentFields: FieldConfig[],
    depth: number,
    currentDepth: number,
    access: ComponentReadAccess = { trusted: TRUSTS_EVERY_COLLECTION }
  ): Promise<Record<string, unknown>[]> {
    if (!this.relationshipService || depth === 0 || currentDepth >= depth) {
      return componentDataArray;
    }

    return Promise.all(
      componentDataArray.map(data =>
        this.expandComponentRelationships(
          data,
          componentSlug,
          componentFields,
          depth,
          currentDepth,
          access
        )
      )
    );
  }
}

/**
 * The row a language's copy is built from: its own deep copy when several
 * languages are read from one row, so a driver's already-parsed JSON value is
 * never one object shared by every language's copy, where a change made to
 * one language's copy would reach the others. One language reads the row as
 * it is, as a one-language read always has.
 */
function ownCopy<Row>(row: Row, languages: number): Row {
  return languages > 1 ? structuredClone(row) : row;
}
