// Core orchestrator for schema change confirmation flow.
// Shared by both Code-First (terminal prompt) and Visual (admin modal) paths.
// Handles: preview (compute diff + classify), apply (update registry + push DDL), rollback.

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { count, getTableColumns, isNull, not } from "drizzle-orm";

import type { SchemaRegistry } from "../../../database/schema-registry.js";
import type { FieldDefinition } from "../../../schemas/dynamic-collections.js";

import type { DrizzlePushService } from "./drizzle-push-service.js";
import { computeFieldDiff, type FieldDiffResult } from "./field-diff.js";
import { generateRuntimeSchema } from "./runtime-schema-generator.js";
import type {
  AddedField,
  ChangeClassification,
  ChangedField,
  FieldResolution,
  InteractiveField,
  RemovedField,
  SchemaApplyResult,
  SchemaClassification,
  SchemaPreviewResult,
} from "./schema-change-types.js";
import { calculateSchemaHash } from "./schema-hash.js";

// Interface for the collection registry methods we need
// (avoids importing the full CollectionRegistryService to prevent circular deps)
interface CollectionRegistryLike {
  updateCollection(
    slug: string,
    data: Record<string, unknown>,
    options?: { source?: "code" | "ui" } & Record<string, unknown>
  ): Promise<unknown>;
  getCollectionBySlug(slug: string): Promise<Record<string, unknown> | null>;
  // Optional: code-first + UI-first both call apply() with only the changed
  // collection registered in SchemaRegistry. drizzle-kit's pushSchema treats
  // missing tables as "desired = drop", so unless we pre-register every
  // existing dynamic collection before apply, other dc_* tables get dropped.
  // Interface is optional so test doubles without this method still compile.
  getAllCollections?: () => Promise<Record<string, unknown>[]>;
}

export class SchemaChangeService {
  // Optional callback invoked after a successful apply.
  // Used by routeHandler to bump the global schema version counter.
  private onApplySuccess?: () => void;

  constructor(
    private adapter: DrizzleAdapter,
    private schemaRegistry: SchemaRegistry,
    private pushService: DrizzlePushService
  ) {}

  // Set a callback to be invoked after each successful schema apply.
  setOnApplySuccess(callback: () => void): void {
    this.onApplySuccess = callback;
  }

  // Compute a full preview of what a schema change will do.
  // Returns classified changes with row-count impact and DDL preview.
  async preview(
    tableName: string,
    currentFields: FieldDefinition[],
    newFields: FieldDefinition[]
  ): Promise<SchemaPreviewResult> {
    // Step 1: Field-level diff
    const diff = computeFieldDiff(currentFields, newFields);

    if (!diff.hasChanges) {
      return {
        hasChanges: false,
        hasDestructiveChanges: false,
        classification: "safe",
        changes: {
          added: [],
          removed: [],
          changed: [],
          unchanged: diff.unchanged,
        },
        warnings: [],
        interactiveFields: [],
        ddlPreview: [],
      };
    }

    // Step 2: Get row counts for impact assessment
    const tableRowCount = await this.getTableRowCount(tableName);
    const fieldRowCounts = await this.getFieldRowCounts(
      tableName,
      diff.removed
    );
    const nullCounts = await this.getNullCounts(tableName, diff.changed);

    // Step 3: Classify
    const classified = this.classifyChanges(
      diff,
      tableRowCount,
      fieldRowCounts,
      nullCounts
    );

    // Step 4: DDL preview via Drizzle Kit dry-run (best-effort)
    let ddlPreview: string[] = [];
    try {
      const dialect = this.schemaRegistry.getDialect();
      const { schemaRecord } = generateRuntimeSchema(
        tableName,
        newFields,
        dialect
      );
      const pushResult = await this.pushService.preview(schemaRecord);
      ddlPreview = pushResult.statementsToExecute ?? [];
    } catch {
      // DDL preview is best-effort; don't fail the preview if it errors
    }

    return {
      ...classified,
      ddlPreview,
    };
  }

  // Classify changes based on field diff and row counts.
  // Pure logic, no DB access -- easy to test.
  classifyChanges(
    diff: FieldDiffResult,
    tableRowCount: number,
    fieldRowCounts: Record<string, number> = {},
    nullCounts: Record<string, number> = {}
  ): Omit<SchemaPreviewResult, "ddlPreview"> {
    const added: AddedField[] = [];
    const removed: RemovedField[] = [];
    const changed: ChangedField[] = [];
    const interactiveFields: InteractiveField[] = [];
    const warnings: string[] = [];

    // Classify added fields
    for (const field of diff.added) {
      const isRequired = field.required === true;
      const hasDefault =
        field.default !== undefined || field.defaultValue !== undefined;
      let classification: ChangeClassification = "safe";

      // New required field with no default on a non-empty table needs user input
      if (isRequired && !hasDefault && tableRowCount > 0) {
        classification = "interactive";
        interactiveFields.push({
          name: field.name,
          reason: "new_required_no_default",
          tableRowCount,
          options: ["provide_default", "mark_nullable", "cancel"],
        });
      }

      added.push({
        name: field.name,
        type: field.type,
        required: isRequired,
        hasDefault,
        classification,
      });
    }

    // Classify removed fields
    for (const field of diff.removed) {
      const rowCount = fieldRowCounts[field.name] ?? 0;
      const classification: ChangeClassification =
        rowCount > 0 ? "destructive" : "safe";

      if (rowCount > 0) {
        warnings.push(
          `Removing field '${field.name}' will drop ${rowCount.toLocaleString()} rows of data.`
        );
      }

      removed.push({
        name: field.name,
        type: field.type,
        rowCount,
        classification,
      });
    }

    // Classify changed fields
    for (const change of diff.changed) {
      const rowCount = fieldRowCounts[change.name] ?? 0;
      let classification: ChangeClassification = "safe";

      if (change.reason === "constraint_changed") {
        // nullable -> NOT NULL: check for existing NULLs
        const nullCount = nullCounts[change.name] ?? 0;
        if (nullCount > 0) {
          classification = "interactive";
          interactiveFields.push({
            name: change.name,
            reason: "nullable_to_not_null_with_nulls",
            tableRowCount,
            nullCount,
            options: ["provide_default", "mark_nullable", "cancel"],
          });
          warnings.push(
            `Setting field '${change.name}' to required will fail: ${nullCount.toLocaleString()} rows have NULL values.`
          );
        }
      } else if (change.reason === "type_changed") {
        classification = "destructive";
        warnings.push(
          `Changing field '${change.name}' type (${change.from} -> ${change.to}) may cause data loss.`
        );
      }

      changed.push({
        name: change.name,
        from: change.from,
        to: change.to,
        rowCount,
        classification,
        reason: change.reason ?? "type_changed",
      });
    }

    // Overall classification: most severe wins
    // interactive > destructive > safe
    const allClassifications = [
      ...added.map(f => f.classification),
      ...removed.map(f => f.classification),
      ...changed.map(f => f.classification),
    ];

    let overallClassification: SchemaClassification = "safe";
    if (allClassifications.includes("interactive")) {
      overallClassification = "interactive";
    } else if (allClassifications.includes("destructive")) {
      overallClassification = "destructive";
    }

    return {
      hasChanges: diff.hasChanges,
      hasDestructiveChanges: overallClassification !== "safe",
      classification: overallClassification,
      changes: { added, removed, changed, unchanged: diff.unchanged },
      warnings,
      interactiveFields,
    };
  }

  // Apply schema changes: update metadata, registry, push DDL.
  // Returns success or error. On failure, rolls back metadata + registry.
  async apply(
    slug: string,
    tableName: string,
    currentFields: FieldDefinition[],
    newFields: FieldDefinition[],
    currentSchemaVersion: number,
    registry: CollectionRegistryLike,
    resolutions?: Record<string, FieldResolution>,
    // Source of this apply - used so code-first applies can update
    // their own locked rows (UI edits remain blocked on locked=1).
    // Defaults to "ui" to preserve the existing admin-UI behaviour.
    options?: { source?: "code" | "ui" }
  ): Promise<SchemaApplyResult> {
    const updateOptions = options?.source
      ? { source: options.source }
      : undefined;

    // Pre-register every existing dynamic collection in the SchemaRegistry.
    // drizzle-kit's pushSchema uses the passed schema as the authoritative
    // desired state - any tables missing from it are dropped. Without this
    // loop, applying a change to one collection would silently drop every
    // other dc_* table. Idempotent: re-registering an existing table with
    // the same Drizzle object is a no-op.
    if (typeof registry.getAllCollections === "function") {
      try {
        const allCollections = await registry.getAllCollections();
        const dialectStr = this.schemaRegistry.getDialect();
        for (const raw of allCollections) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const c = raw as any;
          if (c.slug === slug) continue; // current collection - caller will register later
          const tName = c.tableName ?? `dc_${c.slug}`;
          const flds = (c.fields ?? []) as unknown[];
          if (flds.length === 0) continue;
          const { table } = generateRuntimeSchema(
            tName,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            flds as any,
            dialectStr
          );
          this.schemaRegistry.registerDynamicSchema(tName, table);
        }
      } catch (preRegErr) {
        // Non-fatal: if we can't enumerate, apply will still work for the
        // current collection but unrelated tables may drop. Log loudly.
        console.warn(
          `[SchemaChange] Failed to pre-register sibling collections: ${preRegErr instanceof Error ? preRegErr.message : String(preRegErr)}`
        );
      }
    }
    const dialect = this.schemaRegistry.getDialect();

    // Save old state for rollback
    const oldTable = this.schemaRegistry.getTable(tableName);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FieldDefinition is structurally compatible with FieldConfig
    const oldHash = calculateSchemaHash(currentFields as any);

    // Step 1: Process resolutions (modify newFields based on user choices)
    const resolvedFields = this.processResolutions(newFields, resolutions);

    // Step 2: Run backfills for interactive resolutions (BEFORE DDL)
    try {
      await this.runBackfills(tableName, resolutions);
    } catch (error) {
      return {
        success: false,
        message: "Failed to backfill existing rows",
        newSchemaVersion: currentSchemaVersion,
        error: String(error),
      };
    }

    // Step 3: Update metadata in dynamic_collections
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FieldDefinition is structurally compatible with FieldConfig
    const newHash = calculateSchemaHash(resolvedFields as any);
    const newVersion = currentSchemaVersion + 1;
    try {
      await registry.updateCollection(
        slug,
        {
          fields: resolvedFields,
          schemaHash: newHash,
          schemaVersion: newVersion,
          migrationStatus: "applied",
        },
        updateOptions
      );
    } catch (error) {
      return {
        success: false,
        message: "Failed to update collection metadata",
        newSchemaVersion: currentSchemaVersion,
        error: String(error),
      };
    }

    // Step 4: Generate new Drizzle table object and update registry
    const { table: newTable } = generateRuntimeSchema(
      tableName,
      resolvedFields,
      dialect
    );
    this.schemaRegistry.registerDynamicSchema(tableName, newTable);

    // Step 5: Push DDL. If it fails, roll back metadata and registry.
    // What: run DDL via Drizzle Kit; on any failure, restore the previous state
    // in both dynamic_collections and the in-memory SchemaRegistry before
    // surfacing the error to the caller.
    // Why: the previous behaviour silently marked migrationStatus: "pending"
    // and returned success: true with a reassuring message, while the database
    // was unchanged. Admin UI showed green toasts on what was actually a
    // failure. Task 11 requires honest reporting so the caller (admin dialog
    // or wrapper CLI) can display the real error.
    //
    // IMPORTANT: drizzle-kit's pushSchema diffs the passed schema against the
    // live DB and drops any table not in the passed schema. Pass the FULL
    // registry (static system tables + all dynamic collections) so unrelated
    // tables like users, sessions, dynamic_collections are preserved.
    try {
      const fullSchemaRecord = this.schemaRegistry.getAllSchemas() as Record<
        string,
        unknown
      >;
      await this.pushService.apply(fullSchemaRecord);
    } catch (ddlError) {
      const errorMsg =
        ddlError instanceof Error ? ddlError.message : String(ddlError);

      // Roll back dynamic_collections metadata to the pre-apply state so the
      // DB view and code view agree that this change did not land.
      try {
        await registry.updateCollection(
          slug,
          {
            fields: currentFields,
            schemaHash: oldHash,
            schemaVersion: currentSchemaVersion,
            migrationStatus: "failed",
          },
          updateOptions
        );
      } catch (rollbackError) {
        // Rollback of metadata failed. Log for diagnosis but still return the
        // original DDL error since that is the root cause.
        console.warn(
          `[SchemaChange] Metadata rollback failed for "${slug}": ${String(rollbackError)}`
        );
      }

      // Restore the old Drizzle table object in the registry so queries against
      // the live table continue to reflect the real database shape.
      if (oldTable) {
        this.schemaRegistry.registerDynamicSchema(tableName, oldTable);
      }

      return {
        success: false,
        message: `Schema change failed: ${errorMsg}`,
        newSchemaVersion: currentSchemaVersion,
        error: errorMsg,
      };
    }

    // Notify listeners (e.g., bump global schema version for response header)
    this.onApplySuccess?.();

    return {
      success: true,
      message: "Schema changes applied successfully",
      newSchemaVersion: newVersion,
    };
  }

  // Process user resolutions: modify field definitions based on choices
  private processResolutions(
    fields: FieldDefinition[],
    resolutions?: Record<string, FieldResolution>
  ): FieldDefinition[] {
    if (!resolutions) return fields;

    return fields.map(field => {
      const resolution = resolutions[field.name];
      if (!resolution) return field;

      switch (resolution.action) {
        case "provide_default":
          // Add default value to the field definition
          return { ...field, defaultValue: resolution.value };
        case "mark_nullable":
          // Remove the required constraint
          return { ...field, required: false };
        default:
          return field;
      }
    });
  }

  // Run backfill queries for nullable->NOT NULL with existing NULLs.
  // Uses Drizzle query builder, not raw SQL.
  private async runBackfills(
    tableName: string,
    resolutions?: Record<string, FieldResolution>
  ): Promise<void> {
    if (!resolutions) return;

    for (const [fieldName, resolution] of Object.entries(resolutions)) {
      if (
        resolution.action === "provide_default" &&
        resolution.value !== undefined
      ) {
        // Backfill NULL rows before constraint tightening
        const tableObj = this.schemaRegistry.getTable(tableName);
        if (tableObj) {
          const columns = getTableColumns(tableObj as never);
          const col = columns[fieldName];
          if (col) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle's db is dialect-specific
            const db = this.adapter.getDrizzle() as any;
            await db
              .update(tableObj)
              .set({ [fieldName]: resolution.value })
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle column type mismatch
              .where(isNull(col as any));
          }
        }
      }
    }
  }

  // Count total rows in a table
  private async getTableRowCount(tableName: string): Promise<number> {
    try {
      const tableObj = this.schemaRegistry.getTable(tableName);
      if (!tableObj) return 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle's db is dialect-specific
      const db = this.adapter.getDrizzle() as any;
      const result = await db.select({ value: count() }).from(tableObj);
      return result[0]?.value ?? 0;
    } catch {
      return 0;
    }
  }

  // Count non-null rows per field (for removed fields impact)
  private async getFieldRowCounts(
    tableName: string,
    removedFields: FieldDefinition[]
  ): Promise<Record<string, number>> {
    if (removedFields.length === 0) return {};

    const counts: Record<string, number> = {};
    const tableObj = this.schemaRegistry.getTable(tableName);
    if (!tableObj) return counts;

    const columns = getTableColumns(tableObj as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle's db is dialect-specific
    const db = this.adapter.getDrizzle() as any;

    for (const field of removedFields) {
      try {
        const col = columns[field.name];
        if (!col) {
          counts[field.name] = 0;
          continue;
        }
        // COUNT(*) WHERE field IS NOT NULL -- via Drizzle ORM helper
        const result = await db
          .select({ value: count() })
          .from(tableObj)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle column type mismatch
          .where(not(isNull(col as any)));
        counts[field.name] = result[0]?.value ?? 0;
      } catch {
        counts[field.name] = 0;
      }
    }
    return counts;
  }

  // Count NULL rows per field (for nullable->NOT NULL detection)
  private async getNullCounts(
    tableName: string,
    changedFields: { name: string; reason?: string }[]
  ): Promise<Record<string, number>> {
    const constraintChanges = changedFields.filter(
      f => f.reason === "constraint_changed"
    );
    if (constraintChanges.length === 0) return {};

    const counts: Record<string, number> = {};
    const tableObj = this.schemaRegistry.getTable(tableName);
    if (!tableObj) return counts;

    const columns = getTableColumns(tableObj as never);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle's db is dialect-specific
    const db = this.adapter.getDrizzle() as any;

    for (const field of constraintChanges) {
      try {
        const col = columns[field.name];
        if (!col) {
          counts[field.name] = 0;
          continue;
        }
        const result = await db
          .select({ value: count() })
          .from(tableObj)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle column type mismatch
          .where(isNull(col as any));
        counts[field.name] = result[0]?.value ?? 0;
      } catch {
        counts[field.name] = 0;
      }
    }
    return counts;
  }
}
