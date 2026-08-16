/**
 * Components (reusable field group) dispatch handlers.
 *
 * Routes 5 operations against `FieldGroupRegistryService`:
 * list / create / get / update / delete. The create/update flows run
 * `comp_*` table migrations directly against the DI-registered adapter
 * so UI-edited components have a usable backing table immediately.
 *
 * Every handler returns a Response built via the respondX helpers in
 * `../../api/response-shapes.ts`. The dispatcher passes the Response
 * through unchanged. See spec §5.1 for the canonical shape contract.
 */

import {
  assertValidFieldsPayload,
  assertValidPluginFieldOptions,
} from "../../api/fields-payload";
import {
  respondAction,
  respondData,
  respondDoc,
  respondList,
  respondMutation,
} from "../../api/response-shapes";
import type { FieldConfig } from "../../collections/fields/types";
import { assertNotDiverged } from "../../domains/field-groups/services/assert-not-diverged";
import {
  reconcileComponentCompanion,
  registerComponentRuntimeSchema,
  resolveComponentTypeColumn,
} from "../../domains/field-groups/services/field-group-table-provisioning";
import { resolveFieldGroupRegistryName } from "../../domains/field-groups/storage/resolve-storage-names";
import { assertLocalizationConfigured } from "../../domains/i18n/config/require-app-config";
import { translatePipelinePreviewToLegacy } from "../../domains/schema/legacy-preview/translate";
import { RealClassifier } from "../../domains/schema/pipeline/classifier/classifier";
import { extractDatabaseNameFromUrl } from "../../domains/schema/pipeline/database-url";
import { RealPreCleanupExecutor } from "../../domains/schema/pipeline/pre-cleanup/executor";
import { previewDesiredSchema } from "../../domains/schema/pipeline/preview";
import {
  BrowserPromptDispatcher,
  type BrowserRenameResolution,
} from "../../domains/schema/pipeline/prompt-dispatcher/browser";
import { PushSchemaPipeline } from "../../domains/schema/pipeline/pushschema-pipeline";
import {
  noopMigrationJournal,
  noopPreRenameExecutor,
} from "../../domains/schema/pipeline/pushschema-pipeline-stubs";
import { RegexRenameDetector } from "../../domains/schema/pipeline/rename-detector";
import type { Resolution } from "../../domains/schema/pipeline/resolution/types";
import type { DesiredFieldGroup } from "../../domains/schema/pipeline/types";
import { DrizzleStatementExecutor } from "../../domains/schema/services/drizzle-statement-executor";
import { withSchemaChangeExcluded } from "../../domains/schema/services/schema-change-exclusion";
import type { FieldResolution } from "../../domains/schema/services/schema-change-types";
import { calculateSchemaHash } from "../../domains/schema/services/schema-hash";
import { resolveComponentTableName } from "../../domains/schema/utils/resolve-table-name";
import { NextlyError } from "../../errors";
import { getProductionNotifier } from "../../runtime/notifications/index";
import type { FieldDefinition } from "../../schemas/dynamic-collections";
import {
  FIELD_GROUP_MIGRATION_STATUSES,
  type FieldGroupMigrationStatus,
} from "../../schemas/dynamic-field-groups";
import type { FieldGroupRegistryService } from "../../services/field-groups/field-group-registry-service";
import type { Logger } from "../../shared/types";
import { buildFullDesiredSchema } from "../helpers/desired-schema";
import {
  getAdapterFromDI,
  getComponentRegistryFromDI,
  getFieldGroupMetadataServiceFromDI,
  getLoggerFromDI,
  getMigrationJournalFromDI,
} from "../helpers/di";
import { readRequestLocalized } from "../helpers/request-localized";
import { requireParam, toNumber } from "../helpers/validation";
import type { MethodHandler, Params } from "../types";

import { assertSchemaVersionMatch } from "./schema-version-guard";

interface ComponentsServices {
  registry: FieldGroupRegistryService;
}

// ============================================================
// Pagination helper
// ============================================================

/**
 * Translate the registry's `limit/offset/total` triple into the canonical
 * `PaginationMeta` shape that `respondList` expects. Mirrors the helper
 * in `single-dispatcher.ts` because the Components registry uses the
 * same offset-based shape.
 */
function offsetPaginationToMeta(args: {
  total: number;
  limit?: number;
  offset?: number;
}) {
  const total = args.total;
  const limit = args.limit && args.limit > 0 ? args.limit : total || 1;
  const offset = args.offset ?? 0;
  const page = Math.floor(offset / limit) + 1;
  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  return {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

// Every helper these handlers use to provision or rebind a table now lives beside the field-group
// schema service, so each transport reaches the same provisioning rather than only the one that
// happened to hold it privately.

/**
 * Where log lines go when DI has registered no logger.
 *
 * Every method is present, so a caller that logs cannot fail on a missing one — which is the whole
 * difference between this and an empty object, and the reason it is a named value rather than a
 * fallback written inline at the call site.
 */
const DISCARDED_LOG: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Read a `migrationStatus` filter off the query string.
 *
 * 🔴 REJECTED rather than ignored when it is not a status this system has. Both silent alternatives
 * are worse and in different ways: passing it through returns an empty list, which a caller cannot
 * tell from "no field groups are in that state"; dropping it returns the UNFILTERED list, which is
 * worse still, because the caller asked to narrow and got everything back looking narrowed. A
 * refusal that names the accepted values is the only answer a client can act on.
 *
 * The accepted set is `FIELD_GROUP_MIGRATION_STATUSES`, the same list the schema declares, so this
 * cannot drift into accepting a status the column never holds.
 */
function readMigrationStatus(
  raw: string | undefined
): FieldGroupMigrationStatus | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (
    !FIELD_GROUP_MIGRATION_STATUSES.includes(raw as FieldGroupMigrationStatus)
  ) {
    // The canonical validation envelope rather than a bespoke message, so the admin's existing
    // `parseApiError` maps it like every other field error instead of needing a special case.
    throw NextlyError.validation({
      errors: [
        {
          path: "migrationStatus",
          code: "INVALID_VALUE",
          message: `Must be one of: ${FIELD_GROUP_MIGRATION_STATUSES.join(", ")}.`,
        },
      ],
      logContext: {
        reason: "unknown migration status filter",
        migrationStatus: raw,
      },
    });
  }
  return raw as FieldGroupMigrationStatus;
}

const COMPONENTS_METHODS: Record<string, MethodHandler<ComponentsServices>> = {
  listComponents: {
    // Registry returns BaseListResult `{data,total}` with limit/offset
    // semantics; offsetPaginationToMeta synthesises the canonical
    // PaginationMeta so the wire shape matches every other dispatcher.
    execute: async (svc, p) => {
      const limit = toNumber(p.limit);
      const offset = toNumber(p.offset);
      const result = await svc.registry.listComponents({
        source: p.source as "code" | "ui" | undefined,
        // 🔴 Filtered by the DATABASE, not by the caller narrowing a page it was already sent.
        // A page is a window over the whole set, so a client-side filter can only ever search the
        // window: selecting "diverged" would show an empty table while a diverged group sat on
        // page two — hiding precisely the state an operator opened this screen to find.
        migrationStatus: readMigrationStatus(p.migrationStatus),
        search: p.search,
        limit,
        offset,
      });
      return respondList(
        result.data,
        offsetPaginationToMeta({ total: result.total, limit, offset })
      );
    },
  },

  createComponent: {
    execute: async (svc, _, body) => {
      const b = body as
        | {
            slug?: string;
            label?: string;
            fields?: FieldConfig[];
            admin?: Record<string, unknown>;
            description?: string;
            // i18n: Internationalization opt-in; persists to dynamic_components.localized and
            // provisions the companion comp_<slug>_locales table.
            localized?: boolean;
          }
        | undefined;

      if (!b?.slug || !b?.fields) {
        throw new Error("Component slug and fields are required");
      }

      // These direct create/update handlers persist and run DDL without the
      // preview/apply handlers below. Their own rules cover names and shapes;
      // what none of them can judge is a plugin type's own options, so an
      // unsatisfiable declaration would be stored and fail on every write.
      assertValidPluginFieldOptions(b.fields);

      const isLocalized = b.localized === true;
      // i18n: a localized component stores translatable values via the
      // app's `localization` config; creating one without that config
      // would split the tables into a shape the runtime cannot write to.
      if (isLocalized) {
        assertLocalizationConfigured("component", b.slug);
      }
      const schemaHash = calculateSchemaHash(b.fields);
      // Canonical name derivation, shared with the registry sync and
      // migrate:create paths, so the created table and the registry row agree.
      const tableName = resolveComponentTableName(b.slug);

      // The table-name conflict is refused inside the service, alongside the DDL it guards, so all
      // three create transports get it rather than this one alone.

      // One service owns the table change and the registry write. This handler used to hold the
      // DDL itself, which is why the other two create transports could not perform the schema
      // half and shipped a registry row describing a table that was never made.
      const metadata = getFieldGroupMetadataServiceFromDI();
      if (!metadata) {
        throw NextlyError.internal({
          logContext: {
            reason: "field-group-metadata-service-unavailable",
            slug: b.slug,
          },
        });
      }
      const { record: created, migrationStatus } =
        await metadata.createFieldGroup({
          slug: b.slug,
          label: b.label || b.slug,
          tableName,
          fields: b.fields,
          admin: b.admin,
          description: b.description,
          source: "ui",
          locked: false,
          // i18n: persist the Internationalization flag so the component reads/writes per language.
          localized: isLocalized,
          schemaHash,
          schemaVersion: 1,
        });

      // Migration status drives the toast copy so admins immediately
      // know whether the table was applied.
      const message =
        migrationStatus === "applied"
          ? `Component "${b.slug}" created and table applied!`
          : `Component "${b.slug}" created. Run migrations to apply the table.`;
      return respondMutation(message, created, { status: 201 });
    },
  },

  getComponent: {
    // registry.getComponent throws NextlyError on not-found, so we never
    // see a null doc here.
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Component slug");
      const component = await svc.registry.getComponent(slug);
      return respondDoc(component);
    },
  },

  updateComponent: {
    execute: async (svc, p, body) => {
      const slug = requireParam(p, "slug", "Component slug");
      const b = body as
        | {
            label?: string;
            fields?: FieldConfig[];
            admin?: Record<string, unknown>;
            description?: string;
            // i18n: Internationalization toggle; honoured when defined, undefined leaves the
            // existing value untouched. Persists to dynamic_components.localized.
            localized?: boolean;
          }
        | undefined;

      // 🔴 A transport, and nothing more. The lock check, the localization gate, the plugin-option
      // validation, the companion transition and the registry write all live in the metadata
      // service, so this path and the two that never ran DDL now perform the SAME operation. What
      // used to be here could not be shared, which is exactly why they diverged.
      const metadataService = getFieldGroupMetadataServiceFromDI();
      if (!metadataService) {
        throw NextlyError.internal({
          logContext: {
            reason: "field-group-metadata-service-unavailable",
            slug,
          },
        });
      }
      const { record } = await metadataService.updateFieldGroup({
        slug,
        label: b?.label,
        description: b?.description,
        admin: b?.admin,
        fields: b?.fields as unknown as FieldDefinition[] | undefined,
        // 🔴 Read through the shared helper, never off the cast body. `b` is a type assertion over
        // whatever JSON arrived, so `localized: "false"` survives it as a truthy string: the
        // transition would take the ENABLED branch and drop the main table's translatable columns
        // while the registry, which stores `data.localized === true`, recorded the group disabled.
        // The collection and single dispatchers already read it this way.
        localized: readRequestLocalized(b),
        source: "ui",
      });

      return respondMutation(`Component "${slug}" updated.`, record);
    },
  },

  // Preview component schema changes — dry-run diff returning rename candidates
  // and classification. Mirrors previewSchemaChanges in collection-dispatcher.
  previewComponentSchemaChanges: {
    execute: async (svc, p, body) => {
      const slug = requireParam(p, "slug", "Component slug");
      const component = await svc.registry.getComponent(slug);
      if (!component) throw new Error("Component not found");
      if (component.locked) {
        throw new Error(
          "This component is managed via code and cannot be modified in the UI"
        );
      }

      const { fields } = body as { fields: unknown[] };
      if (!fields) throw new Error("fields is required in request body");
      // Same rules as the ui-schema.json mirror (see api/fields-payload):
      // an invalid field must fail HERE, not only at the file write, or
      // the DB and the committed manifest diverge silently.
      assertValidFieldsPayload(fields);

      const currentFields = (component.fields ??
        []) as unknown as FieldDefinition[];
      const tableName = component.tableName;

      const adapter = getAdapterFromDI();
      if (!adapter) throw new Error("Database adapter not initialized");
      const dialect = adapter.dialect;
      const db = adapter.getDrizzle();

      const desired = await buildFullDesiredSchema();
      desired.components[slug] = {
        slug,
        tableName,
        fields: fields as DesiredFieldGroup["fields"],
        // i18n: carry the localized flag so the push diff omits translatable columns
        // from the component's main table (they live in comp_<slug>_locales, reconciled
        // out-of-band below) — mirrors the collection/single apply path.
        localized: (component as { localized?: boolean }).localized === true,
        // Authored in the Schema Builder: this is the Builder's own save path.
        builderOwned: true,
      };

      const pipelinePreview = await previewDesiredSchema({
        desired,
        db,
        dialect,
      });

      const legacyShape = await translatePipelinePreviewToLegacy(
        pipelinePreview,
        {
          tableName,
          currentFields,
          newFields: fields as FieldDefinition[],
          db,
          dialect,
        }
      );

      const renamed = pipelinePreview.candidates.map(c => ({
        table: c.tableName,
        from: c.fromColumn,
        to: c.toColumn,
        fromType: c.fromType,
        toType: c.toType,
        typesCompatible: c.typesCompatible,
        defaultSuggestion: c.defaultSuggestion,
      }));

      const legacyAsRecord = legacyShape as unknown as Record<string, unknown>;
      return respondData({
        ...legacyAsRecord,
        renamed,
        schemaVersion: component.schemaVersion,
      });
    },
  },

  // Apply confirmed component schema changes via PushSchemaPipeline.
  // Mirrors applySchemaChanges in collection-dispatcher.
  applyComponentSchemaChanges: {
    execute: async (svc, p, body) => {
      const slug = requireParam(p, "slug", "Component slug");
      // 🔴 The exclusion opens BEFORE the component is read, because the guard below decides on
      // what that read returns. Reading the status outside it answers only whether the group was
      // diverged at the instant of the read: `updateFieldGroup` commits its companion DDL and
      // persists the row and the divergence marker as separate steps, so a read landing between
      // them sees the OLD status, passes the guard, and starts a second apply from a definition
      // the database has already moved past.
      //
      // This handler does the schema work itself rather than calling the metadata service, which
      // is why the service-level exclusion did not reach it. Taking the lock here puts the read,
      // the check, the DDL and the registry write inside one exclusion — the depth the exclusion
      // was always meant to be held at.
      // 🔴 Everything decidable from the REQUEST ALONE is decided before the lock is taken, because
      // taking it is not free: with `issuesDdl` the exclusion may CREATE and seed the lock table on
      // a database that has never had one, and it can refuse outright when a migration holds the
      // row or the role lacks DDL rights. A malformed request would then be answered with a
      // permission error, a contention error, or a new table — none of which is "this payload is
      // invalid", and the last of which is a write performed on the way to rejecting a request.
      //
      // The split is what each check READS, not how cheap it is. These three read the body and
      // nothing else, so no concurrent writer can change their answer and holding the lock buys
      // them nothing. Every check below the exclusion reads the database, and that is exactly why
      // it belongs inside.
      const {
        fields,
        confirmed,
        schemaVersion,
        resolutions,
        renameResolutions,
        eventResolutions,
        localized: requestLocalized,
      } = body as {
        fields: unknown[];
        confirmed: boolean;
        schemaVersion?: number;
        resolutions?: Record<string, FieldResolution>;
        renameResolutions?: BrowserRenameResolution[];
        eventResolutions?: Resolution[];
        // i18n: the builder sends the current toggle so a save that flips i18n AND changes fields
        // provisions the companion in the same apply. Undefined = leave the persisted value.
        localized?: boolean;
      };

      if (!confirmed) throw new Error("Schema changes must be confirmed");
      if (!fields) throw new Error("fields is required in request body");
      // Same rules as the ui-schema.json mirror (see api/fields-payload):
      // an invalid field must fail HERE, not only at the file write, or
      // the DB and the committed manifest diverge silently.
      assertValidFieldsPayload(fields);

      return withSchemaChangeExcluded(
        {
          adapter: getAdapterFromDI(),
          // An app whose DI has not registered a logger still runs its schema changes, so the
          // absence is not a reason to refuse — it only costs the report of a lock that was
          // skipped. Discarding those lines is the caller's position, stated here rather than
          // left to a partial object the exclusion would call methods on.
          logger: getLoggerFromDI() ?? DISCARDED_LOG,
          label: `apply schema changes to field group "${slug}"`,
          // This path runs the push pipeline, so it issues DDL and may create the lock table.
          issuesDdl: true,
        },
        async () => {
          const component = await svc.registry.getComponent(slug);
          if (!component) throw new Error("Component not found");
          if (component.locked) {
            throw new Error(
              "This component is managed via code and cannot be modified in the UI"
            );
          }

          // 🔴 The same refusal the metadata service makes, from the same function rather than a copy.
          // This route moves storage exactly as `updateFieldGroup` does and reaches the registry by a
          // different path, so a guard living only there left this door open: an operator refused in
          // the admin could compound the very edit that was refused by coming through the builder.
          //
          // Deliberately NOT applied to `getComponent` or `previewComponentSchemaChanges` above. Those
          // read; they move no storage, and they are how an operator inspects a diverged group in order
          // to reconcile it. Refusing them would make the state harder to escape rather than safer,
          // which is the same reason metadata-only edits stay allowed.
          assertNotDiverged(slug, component);

          // i18n: prefer the request's localized flag over the persisted one (stale on a
          // simultaneous toggle+field-change save); fall back to the registry value.
          const wasLocalized =
            (component as { localized?: boolean }).localized === true;
          const isLocalized =
            requestLocalized !== undefined
              ? requestLocalized === true
              : wasLocalized;
          // i18n: gate the Internationalization enable on the app-level
          // `localization` config (false→true transition only).
          if (!wasLocalized && isLocalized) {
            assertLocalizationConfigured("component", slug);
          }

          const currentVersion = component.schemaVersion ?? 1;
          // Reject a stale UI save before any DDL runs so two admins editing the
          // same component cannot silently overwrite each other (last-write-wins).
          assertSchemaVersionMatch(schemaVersion, currentVersion, slug);
          const tableName = component.tableName;

          const legacyBundle = resolutions
            ? { tableName, byFieldName: resolutions }
            : undefined;

          const adapter = getAdapterFromDI();
          if (!adapter) throw new Error("Database adapter not initialized");
          // 🔴 Resolved BEFORE the apply. The runtime refresh at the end of this
          // handler suppresses its own failures by design, so a probe placed there
          // could let the handler report success over an unregistered or stale
          // table. The apply only alters user columns, so this answer is the same
          // either side of it — and asking now means a probe that cannot answer
          // fails the request before anything commits.
          const componentTypeColumn = await resolveComponentTypeColumn(
            adapter,
            tableName
          );

          const dialect = adapter.dialect;
          const db = adapter.getDrizzle();
          const databaseName =
            dialect === "mysql"
              ? extractDatabaseNameFromUrl(process.env.DATABASE_URL)
              : undefined;

          const desired = await buildFullDesiredSchema();
          desired.components[slug] = {
            slug,
            tableName,
            fields: fields as DesiredFieldGroup["fields"],
            // i18n: carry the localized flag so the push diff omits translatable columns
            // from the component's main table (they live in comp_<slug>_locales, reconciled
            // out-of-band below) — mirrors the collection/single apply path.
            localized: isLocalized,
            // Authored in the Schema Builder: this is the Builder's own save path.
            builderOwned: true,
          };

          const promptDispatcher = new BrowserPromptDispatcher(
            renameResolutions ?? [],
            eventResolutions ?? [],
            legacyBundle
          );

          const migrationJournal =
            getMigrationJournalFromDI() ?? noopMigrationJournal;
          const pipeline = new PushSchemaPipeline({
            executor: new DrizzleStatementExecutor(dialect, db),
            renameDetector: new RegexRenameDetector(),
            classifier: new RealClassifier(),
            promptDispatcher,
            preRenameExecutor: noopPreRenameExecutor,
            preCleanupExecutor: new RealPreCleanupExecutor(),
            migrationJournal,
            notifier: getProductionNotifier(),
          });

          const result = await pipeline.apply({
            desired,
            db,
            dialect,
            source: "ui",
            promptChannel: "browser",
            databaseName,
            uiTargetSlug: slug,
            // Named, not defaulted: the scope defaults to a collection, and a field group recorded under
            // that kind is invisible to every history query filtered by its own.
            uiTargetKind: "component" as const,
          });

          if (!result.success) {
            throw new Error(
              result.error?.message ?? "Failed to apply schema changes"
            );
          }

          // i18n: the push pipeline excludes companion tables, so reconcile the component's companion
          // comp_<slug>_locales out-of-band — create on the first translatable field, then ADD/DROP
          // columns as the field set changes. Uses the request's `isLocalized`.
          try {
            await reconcileComponentCompanion({
              slug,
              tableName,
              oldFields: component.fields as unknown as FieldDefinition[],
              newFields: fields as unknown as FieldDefinition[],
              localized: isLocalized,
              // Detect an enable/disable transition against the persisted state so this apply
              // seeds/restores existing rows rather than only creating an empty companion.
              wasLocalized:
                (component as { localized?: boolean }).localized === true,
              adapter,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw NextlyError.internal({
              cause: err instanceof Error ? err : undefined,
              logContext: {
                op: "componentCompanionReconcile",
                slug,
                detail: msg,
              },
            });
          }

          const newSchemaVersion = currentVersion + 1;

          // Post-apply: update dynamic_components fields JSON + schema_hash directly
          // (not via the registry helper, whose auto-bump would also reset
          // migration_status). Advance schema_version here so the optimistic-lock
          // check above sees a new value on the next save (without the bump the
          // stored version never changes and a second stale save would pass), and
          // persist `localized` so a simultaneous toggle+field-change save keeps the
          // flag. The write is non-fatal (the DDL already succeeded), but track
          // whether it landed so the response never reports a version the DB did not
          // persist.
          let versionPersisted = true;
          try {
            await adapter.update(
              // The registry this database holds. The failure is otherwise silent
              // in the worst way: the DDL has already committed, this write is
              // treated as non-fatal, and the stale row rebuilds the pre-change
              // runtime schema on the next restart.
              await resolveFieldGroupRegistryName(adapter),
              {
                fields: JSON.stringify(fields),
                schema_hash: calculateSchemaHash(fields as FieldConfig[]),
                migration_status: "applied",
                localized: isLocalized,
                schema_version: newSchemaVersion,
                updated_at: new Date(),
              },
              { and: [{ column: "slug", op: "=", value: slug }] }
            );
          } catch (err) {
            versionPersisted = false;
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(
              `[applyComponentSchemaChanges] Post-apply metadata write failed for '${slug}': ${msg}. ` +
                `schema_version was not advanced; the save is reported at the current version so a retry re-attempts the bump.`
            );
          }

          // Post-apply: refresh in-memory runtime schema so CRUD paths reflect
          // the new column layout without requiring a server restart.
          // Must use registerComponentRuntimeSchema (not generateRuntimeSchema)
          // so the registered table includes component system columns
          // (_parent_id, _parent_table, _parent_field, _order, _component_type)
          // instead of collection columns (title, slug).
          registerComponentRuntimeSchema(
            adapter,
            dialect,
            tableName,
            fields as FieldConfig[],
            componentTypeColumn,
            isLocalized
          );

          return respondAction(`Schema applied for component '${slug}'`, {
            newSchemaVersion: versionPersisted
              ? newSchemaVersion
              : currentVersion,
          });
        }
      );
    },
  },

  // Repair a field group's stored definition to describe its live tables.
  //
  // The exit from `diverged`, so `assertNotDiverged` is deliberately NOT called: this is the one
  // operation the state exists to permit. Also deliberately not gated on the status being
  // `diverged` — a recording write that failed after its DDL committed leaves a divergence with no
  // mark, and the operation is idempotent on a healthy group.
  reconcileComponent: {
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Component slug");

      const adapter = getAdapterFromDI();
      if (!adapter) {
        // Without a database there are no live tables, so there is nothing to reconcile AGAINST —
        // unlike the schema services' generate-only mode, this operation is meaningless dry.
        throw NextlyError.internal({
          logContext: { reason: "reconcile-requires-adapter", slug },
        });
      }
      const logger = getLoggerFromDI() ?? DISCARDED_LOG;

      // Inside the exclusion even though no DDL runs: the plan is computed from a read of the
      // registry AND the catalog, and an apply committing between those reads would hand the
      // planner a pair that never coexisted. The version-conditional write catches the registry
      // half of that race; holding the exclusion closes the catalog half too.
      return withSchemaChangeExcluded(
        {
          adapter,
          logger,
          label: `reconcile field group "${slug}"`,
          // Reads the catalog and writes one registry row; no DDL, so a database this cannot
          // create the lock table on refuses nothing it would need.
          issuesDdl: false,
        },
        async () => {
          const { reconcileFieldGroup } = await import(
            "../../domains/field-groups/services/field-group-reconcile-service"
          );
          const report = await reconcileFieldGroup({
            registry: svc.registry,
            adapter,
            logger,
            slug,
          });

          return respondAction(
            report.unchanged
              ? `"${slug}" already describes its tables; nothing was changed.`
              : `Reconciled "${slug}" against its live tables.`,
            { report }
          );
        }
      );
    },
  },

  deleteComponent: {
    // Spec divergence: spec §5.1 / §7.4 strictly maps delete to
    // respondMutation, but registry.deleteComponent returns void (no
    // deleted record to surface). We use respondAction here so the wire
    // shape is `{ message, slug }` rather than the awkward
    // `{ message, item: undefined }` that respondMutation would emit.
    // If registry.deleteComponent is later refactored to return the
    // deleted record, switch this back to respondMutation.
    execute: async (svc, p) => {
      const slug = requireParam(p, "slug", "Component slug");

      const isLocked = await svc.registry.isLocked(slug);
      if (isLocked) {
        // Same NextlyError pattern as updateComponent's locked branch.
        throw NextlyError.forbidden({
          logContext: {
            reason: "component-locked",
            slug,
          },
        });
      }

      await svc.registry.deleteComponent(slug);

      return respondAction(`Component "${slug}" deleted successfully.`, {
        slug,
      });
    },
  },
};

/**
 * Dispatch a Components method call. Resolves the registry from DI and
 * throws a descriptive error if it isn't registered yet.
 */
export function dispatchComponents(
  method: string,
  params: Params,
  body: unknown
): Promise<unknown> {
  const componentRegistry = getComponentRegistryFromDI();
  if (!componentRegistry) {
    throw new Error(
      "Components service not initialized. " +
        "Ensure registerServices() or getNextly() has been called before API requests."
    );
  }

  const handler = COMPONENTS_METHODS[method];
  if (!handler) throw new Error(`Unknown method: ${method}`);
  return handler.execute({ registry: componentRegistry }, params, body);
}
