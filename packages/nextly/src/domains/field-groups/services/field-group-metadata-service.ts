/**
 * Schema changes for a Field Group, owned in one place with the registry write they belong to.
 *
 * ## Why this exists
 *
 * A field group can be created through three transports, and only one of them made the table. The
 * dispatcher generated the DDL, ran it and wrote the registry row; `api/field-groups.ts` POST and
 * the Direct API wrote the row and returned success. The registry then described a `comp_<slug>`
 * table that did not exist, and every read and write to that field group failed against the
 * database. The reason was structural rather than careless: the code that provisions the table was
 * private to the dispatcher, so nothing else could reach it.
 *
 * One service owns both halves, and every transport goes through it.
 *
 * ## What it guarantees, and what it does not
 *
 * **NOT atomic.** MySQL commits DDL implicitly, so a table change and a row write cannot be made
 * atomic there by any ordering or any transaction. The migration engine reached the same conclusion
 * and says so in `field-groups/migration/steps.ts`. Promising atomicity would be a promise that
 * silently does not hold on one of the three supported databases.
 *
 * The DDL runs first and the row is written last, carrying the outcome the apply reached. A crash
 * between the two leaves a table nothing has a record of, and a DDL that FAILS still writes its row
 * recording `failed`. Writing the intent first would trade the first cost for a worse one: a row
 * persisted before the table is touched owns the slug from that moment, and nothing here can yet
 * finish or discard an interrupted attempt, so a create killed mid-flight would block every retry.
 * The ordering changes when a recovery path exists to release what an interrupted attempt claimed.
 *
 * 🔴 Everything that can REJECT a create runs before `createFieldGroup` is called, so a rejected
 * request neither creates a table nor writes a row.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { readRequestLocalized } from "../../../dispatcher/helpers/request-localized";
import { NEXTLY_ERROR_STATUS, NextlyError } from "../../../errors";
import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import type {
  DynamicFieldGroupInsert,
  DynamicFieldGroupRecord,
} from "../../../schemas/dynamic-field-groups/types";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { Logger } from "../../../shared/types";
import { withSchemaChangeExcluded } from "../../schema/services/schema-change-exclusion";

import { assertNotDiverged } from "./assert-not-diverged";
import type { FieldGroupRegistryService } from "./field-group-registry-service";

/**
 * 🔴 The schema service and the table provisioning are loaded on demand, NOT at the top of this
 * file.
 *
 * This service is registered in the DI container, and the registration module is imported during
 * boot by anything that touches the container. A static import here would pull the whole schema and
 * i18n machinery into that graph for every consumer, including every process that never creates a
 * field group. `di/register.ts` avoids exactly this with its `await import()` calls covering these
 * same modules, and a static import from a registration module quietly undoes that work.
 */

/** How far a schema change got. The registry stores this and the admin reads it back. */
export type FieldGroupMigrationStatus =
  | "pending"
  | "applied"
  | "failed"
  // The tables were changed and the row recording it was not written. Distinct from `failed`
  // because the two call for opposite actions: `failed` means the change did not happen and
  // retrying is the repair, `diverged` means half of it did and retrying compounds it.
  | "diverged";

/**
 * The registry row to create, minus the one field this service owns.
 *
 * Deliberately the registry's own insert type rather than a hand-listed subset: a bespoke input
 * shape silently drops whatever it forgets, and that is not hypothetical — the singles equivalent
 * listed its fields by hand and lost three of them, which nothing in the types or the tests caught.
 */
export type CreateFieldGroupInput = Omit<
  DynamicFieldGroupInsert,
  "migrationStatus"
>;

export interface CreateFieldGroupResult {
  record: DynamicFieldGroupRecord;
  migrationStatus: FieldGroupMigrationStatus;
}

/**
 * A field group's metadata edit, with the physical change it implies.
 *
 * Every property is optional and `undefined` means UNTOUCHED rather than cleared, which is the
 * shape all three transports already spoke — a PATCH that omits `label` must not erase it. The
 * distinction matters most for `localized`: absent leaves the persisted value alone, while `false`
 * is a request to disable and moves data back out of the companion table.
 */
export interface UpdateFieldGroupInput {
  slug: string;
  label?: string;
  description?: string;
  admin?: Record<string, unknown>;
  fields?: FieldDefinition[];
  localized?: boolean;
  /**
   * Who is asking, which decides whether a LOCKED field group may be written.
   *
   * A locked field group is owned by code, so only the code-first sync may change it. Defaulting to
   * `"ui"` means a transport that forgets to say gets the restrictive answer.
   */
  source?: "ui" | "code";
}

export interface UpdateFieldGroupResult {
  record: DynamicFieldGroupRecord;
}

export class FieldGroupMetadataService {
  constructor(
    private readonly registry: FieldGroupRegistryService,
    private readonly logger: Logger,
    /**
     * Optional on purpose, and it changes what this service does rather than whether it works.
     *
     * With no adapter registered the statements are generated and never run, which is the behaviour
     * the request handler had before this service existed. Demanding a connection here would turn a
     * configuration this product supports into a crash.
     */
    private readonly adapter?: DrizzleAdapter
  ) {}

  /**
   * The dialect the DDL is generated for.
   *
   * Read from the adapter that will RUN the statements, never from a default. `DB_DIALECT` is
   * optional and falls back to `postgresql`, so an app configured with only a MySQL or SQLite URL
   * would otherwise have its table created as PostgreSQL.
   */
  private get dialect(): "postgresql" | "mysql" | "sqlite" {
    return this.adapter?.getCapabilities().dialect ?? "postgresql";
  }

  /**
   * Create a field group's table and its registry row.
   *
   * The caller has already validated the input's shape.
   */
  async createFieldGroup(
    input: CreateFieldGroupInput
  ): Promise<CreateFieldGroupResult> {
    // 🔴 Everything is inside, including the planning, and the reason planning is inside is not the
    // storage migration.
    //
    // Rendering DDL consults the PROCESS-GLOBAL field-type registry for plugin fields
    // (`pluginEmptyColumnDefault` -> `getFieldType`), and an HMR reload replaces that registry
    // wholesale — `clearFieldTypes()` then re-registration — from inside this same exclusion. Plan
    // outside it and a create can render its columns against one mapping while the binding below
    // uses another, leaving a registered schema that disagrees with the column that was created.
    // Worse, the swap has a window where the registry is EMPTY, so a plan running through it can
    // refuse a field type that is perfectly valid.
    //
    // The ownership check is inside for its own reason: it reads which table names are taken, and a
    // migration renaming tables is what makes such a read stale.
    //
    // What that costs, stated rather than glossed: taking the exclusion may CREATE and seed the
    // lock table, so a create refused for a malformed field can leave that table behind. It is
    // empty, it holds no user data, its creation is idempotent, and the next valid request would
    // have made it anyway — a far smaller price than a column whose type disagrees with the schema
    // bound to it.
    return withSchemaChangeExcluded(
      {
        adapter: this.adapter,
        logger: this.logger,
        label: `create field group "${input.slug}"`,
        issuesDdl: true,
      },
      () => this.createFieldGroupExcluded(input)
    );
  }

  private async createFieldGroupExcluded(
    input: CreateFieldGroupInput
  ): Promise<CreateFieldGroupResult> {
    // 0. RE-ESTABLISH every precondition the caller checked outside this exclusion.
    //
    // 🔴 One step, deliberately, and the place a NEW precondition goes. Both of these were checked
    // by the transport before the lock existed: a table another field group owns, and whether each
    // plugin field's options satisfy that plugin. The second is the subtle one — what changes while
    // this request waits is not the input but the JUDGE, because an HMR reload replaces the
    // process-global field-type registry from inside this same exclusion. A declaration the old
    // registration accepted would otherwise be built and stored against the new one, and every
    // later write to the field group would fail on options the active plugin rejects.
    await this.assertTableUnowned(input);
    const { assertValidPluginFieldOptions } = await import(
      "../../../api/fields-payload"
    );
    assertValidPluginFieldOptions(input.fields);

    // 1. PLAN. The generator validates as well as renders, so a request it refuses leaves no table
    // and no row behind.
    const migrationSQL = await this.planCreate(input);

    // 1a. REFUSE names the database would not store, read from the statements themselves.
    await this.assertIdentifiersFit(input, migrationSQL);

    // 2. APPLY. Never throws; a failure is reported as a status so the row can still record it.
    const migrationStatus = await this.applyCreateDdl(input, migrationSQL);

    // 3. RECORD, with the outcome already known.
    const record = await this.registry.registerComponent({
      ...input,
      migrationStatus,
    });

    // 4. BIND the runtime schema, and only now.
    //
    // 🔴 The order here is what decides a race, so it is not arbitrary. Two creates whose slugs
    // normalise to one table can both pass the ownership check above, because a read cannot exclude
    // a write that has not happened yet. What separates them is the registry's own `table_name`
    // unique index: the second INSERT is rejected by the database.
    //
    // That only helps if nothing irreversible has happened first. Binding before the insert meant
    // the loser rebound the shared table to ITS field list and only then failed, leaving the winner
    // reading through a schema that does not describe it until the process restarts. Binding after
    // the insert means the loser never reaches this line.
    //
    // A lock spanning the check, the DDL and the insert would be stronger, and is what the migration
    // lock will provide once it exists. It cannot be built here: MySQL commits DDL implicitly, so no
    // transaction opened around this can cover the table change on all three dialects.
    if (migrationStatus === "applied") {
      await this.bindRuntimeSchema(input);
    }

    return { record, migrationStatus };
  }

  /**
   * Change a field group's schema and its registry row, as one operation.
   *
   * 🔴 The founding defect of this service, still live on the UPDATE path until now. Three
   * transports edit a field group and only the dispatcher moved the physical schema: the mounted
   * route and the Direct API wrote new `fields` and a new `schema_hash` to the registry and ran no
   * DDL at all, because the provisioning was private to the dispatcher. The row then described
   * columns the table did not have. Bounded rather than silent — the registry marks
   * `migration_status: "pending"` and a preview introspects the live database — but two transports
   * performing different halves of one operation is not a difference any caller can be expected to
   * know about.
   *
   * Inside the exclusion for the same reasons the create is, and one more. Rendering the companion
   * transition consults the process-global field-type registry, which an HMR reload replaces
   * wholesale from inside this same exclusion; and the OLD fields this diffs against are read here
   * rather than passed in, so a concurrent writer cannot make the transition describe a shape that
   * is no longer current.
   */
  async updateFieldGroup(
    input: UpdateFieldGroupInput
  ): Promise<UpdateFieldGroupResult> {
    // 🔴 Validated BEFORE the exclusion, because it is a PRECONDITION and preconditions run first.
    // Inside, the flag below has already given this request permission to create the lock table, so
    // a deployment whose role holds DML but not DDL answers an invalid `localized` with a database
    // permission error instead of the validation error that actually describes it — a caller told
    // the wrong thing about their own mistake. Nothing here reads the database, so there is no
    // reason for it to wait behind a lock.
    const requestedLocalized = readRequestLocalized(input);

    return withSchemaChangeExcluded(
      {
        adapter: this.adapter,
        logger: this.logger,
        label: `update field group "${input.slug}"`,
        // 🔴 Derived from the request, CONSERVATIVELY, because claiming DDL is not free: the
        // exclusion may create and seed its lock table, and a deployment whose role holds DML but
        // not DDL then fails an otherwise valid metadata edit on that `CREATE TABLE`.
        //
        // `fields` or `localized` being PRESENT is the conservative test, not whether they turn out
        // to differ from what is stored. A `localized` toggle carries no fields while moving every
        // translatable column, so reading the request for "does this touch schema" has to treat the
        // key's presence as a yes — the comparison that would say otherwise needs the stored row,
        // which cannot be read before deciding whether to take the lock that protects reading it.
        issuesDdl: input.fields !== undefined || input.localized !== undefined,
      },
      () => this.updateFieldGroupExcluded(input, requestedLocalized)
    );
  }

  private async updateFieldGroupExcluded(
    input: UpdateFieldGroupInput,
    /** Already validated by the caller, which runs outside the lock. */
    requestedLocalized: boolean | undefined
  ): Promise<UpdateFieldGroupResult> {
    // 0. RE-ESTABLISH every precondition, against the state as it is NOW.
    //
    // Read inside the exclusion rather than accepted from the caller: whether the field group
    // exists, whether it is locked, and what its current fields are all decide what this does, and
    // all three can change while a request waits for the lock.
    // Raises NOT_FOUND itself when the slug is gone, so there is no absence branch here. One that
    // existed would be a guard that can never fire, and a guard that cannot fire reads as coverage
    // while proving nothing.
    const existing = await this.registry.getComponent(input.slug);
    // 🔴 A diverged field group is REFUSED for any edit that would move storage again.
    //
    // Recording the state is only half of it. Without this, an editor opened after the mark reads
    // the bumped `schema_version` together with the STALE stored fields, satisfies
    // `assertSchemaVersionMatch`, and plans its next transition from a shape the tables no longer
    // have — the exact retry the state exists to declare unsafe. A status nothing enforces is a
    // note, not a control.
    //
    // Metadata-only edits are deliberately still allowed: a label or a description moves no
    // storage, and locking an operator out of renaming the thing they are trying to reconcile
    // would make the state harder to get out of rather than safer.
    // Only edits that MOVE STORAGE are refused; a label or description change is still allowed, so
    // an operator is never locked out of renaming the thing they are trying to reconcile.
    if (input.fields !== undefined || input.localized !== undefined) {
      assertNotDiverged(input.slug, existing);
    }
    if (existing.locked && input.source !== "code") {
      throw NextlyError.forbidden({
        logContext: {
          reason: "component-locked",
          slug: input.slug,
          source: input.source ?? "ui",
        },
      });
    }
    if (input.fields !== undefined) {
      const { assertValidPluginFieldOptions } = await import(
        "../../../api/fields-payload"
      );
      assertValidPluginFieldOptions(input.fields);
    }

    const wasLocalized = existing.localized === true;
    const localized = requestedLocalized ?? wasLocalized;
    const fields = (input.fields ??
      existing.fields) as unknown as FieldDefinition[];

    // Gated only on the false -> true transition: a field group that is ALREADY localized must stay
    // editable after the app's localization config is removed, or its content becomes unreachable.
    if (!wasLocalized && localized) {
      const { assertLocalizationConfigured } = await import(
        "../../i18n/config/require-app-config"
      );
      assertLocalizationConfigured("component", input.slug);
    }

    // 1. REFUSE a field set this path cannot deliver.
    //
    // 🔴 This method changes the COMPANION table and nothing else. A field whose column lives on the
    // main table therefore needs DDL that only `applySchemaChanges` emits — and without this guard
    // the request SUCCEEDED, wrote the new fields and a matching `schema_hash`, and left the table
    // without the columns the registry now claims it has. The registry marks
    // `migration_status: "pending"` and a preview still introspects the truth, so the drift is
    // recorded rather than silent; it is still a success answered to a caller whose change did not
    // happen.
    //
    // Refusing rather than applying the pipeline here is deliberate. `applySchemaChanges` carries a
    // version guard, rename detection and an interactive resolution step — a rename is ambiguous
    // (rename versus drop-and-add) and a PATCH has no way to ask. Duplicating that inside a metadata
    // edit would be a second implementation of "apply a schema change"; refusing keeps one, and
    // turns a silent wrong result into an actionable error.
    await this.assertNoUnappliableSchemaChange({ existing, fields, localized });

    // 2. MOVE the physical schema, when this edit implies one. A `localized` toggle alone does:
    // enabling seeds the companion from the main table and drops those columns, disabling restores
    // and archives them. A save that skipped that would persist the flag while the content stayed
    // where the runtime no longer looks for it.
    // 🔴 What the reconciler DID, not what the request implied. A field-set change on a group that
    // was and remains non-localized reaches the reconciler and moves nothing — this path emits no
    // main-table DDL at all — so inferring a physical transition from the request shape would mark a
    // row diverged and tell a caller not to retry an edit that changed nothing.
    const movedSchema =
      (input.fields !== undefined || localized !== wasLocalized) &&
      (await this.reconcileCompanion({
        existing,
        fields,
        localized,
        wasLocalized,
      }));

    // 3. RECORD, after the physical change succeeded.
    try {
      const record = await this.registry.updateComponent(
        input.slug,
        {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.admin !== undefined ? { admin: input.admin } : {}),
          ...(requestedLocalized !== undefined
            ? { localized: requestedLocalized }
            : {}),
          ...(input.fields !== undefined
            ? {
                fields:
                  input.fields as unknown as DynamicFieldGroupInsert["fields"],
                schemaHash: await this.hashFields(input.fields),
              }
            : {}),
        },
        { source: input.source ?? "ui" }
      );

      return { record };
    } catch (error) {
      // Only when the tables actually MOVED. A metadata-only edit that fails to write has changed
      // nothing, so the row still describes the database correctly and there is no divergence to
      // record — marking it `failed` there would invent a repair for a state that is fine.
      if (!movedSchema) throw error;
      // 🔴 A throw from the registry does NOT mean the row went unwritten.
      //
      // MySQL has no `RETURNING`, so `DrizzleAdapter.update` runs the UPDATE and then SELECTs the
      // row back on the same executor. A failure in that second query raises out of a write that
      // already committed — and marking a fully synchronized row as diverged, bumping its version
      // again and telling the caller its definition is stale would all be false.
      //
      // Asked of the DATABASE rather than inferred from the error, because no error shape
      // distinguishes the two: the read-back and the write raise through the same path.
      const settled = await this.readBackSettledRow(input, requestedLocalized);
      if (settled) {
        this.logger.warn(
          "[FieldGroups] The registry write raised but the row already carries the change; the error was in reading it back.",
          { slug: input.slug }
        );
        return { record: settled };
      }
      // Returns `never`, so this is a raise rather than a value — written as a return so the
      // compiler, not a comment, is what establishes that nothing falls out of this method.
      return await this.recordUnrecordedTransition(input.slug, existing, error);
    }
  }

  /**
   * Re-read the row and answer whether it ALREADY carries this edit.
   *
   * Only the properties this edit actually sent are compared, and only the ones that decide the
   * physical shape: this is reached exclusively when the tables moved, which means `fields`,
   * `localized`, or both were present. Comparing anything else would let a concurrent label edit
   * decide whether a schema transition was recorded.
   *
   * `null` on any doubt — including a re-read that itself fails, which is the likely case when the
   * database is the reason the first write raised. Doubt has to resolve to "not settled": treating
   * an unreadable row as written would swallow a real divergence, which is the failure this whole
   * path exists to surface.
   */
  private async readBackSettledRow(
    input: UpdateFieldGroupInput,
    requestedLocalized: boolean | undefined
  ): Promise<DynamicFieldGroupRecord | null> {
    try {
      const current = await this.registry.getComponent(input.slug);
      if (input.fields !== undefined) {
        if (current.schemaHash !== (await this.hashFields(input.fields)))
          return null;
      }
      if (requestedLocalized !== undefined) {
        if ((current.localized === true) !== requestedLocalized) return null;
      }
      return current;
    } catch {
      return null;
    }
  }

  /**
   * Refuse a field change whose physical consequence this path cannot carry out.
   *
   * 🔴 Two tables, and exactly one of them can be moved from here:
   *
   * - the MAIN `comp_<slug>` table receives no DDL at all on this path, so ANY difference in the
   *   table it should have — a column added, dropped or reshaped, an index created or removed — is
   *   unappliable and has to be refused;
   * - the companion `comp_<slug>_locales` IS reconciled, but only by ADDING and DROPPING columns by
   *   NAME. A localized field that keeps its name while its column changes shape emits no statement
   *   there either, so that case is refused too.
   *
   * Every question is answered by the code that already owns it, so this guard cannot disagree with
   * what actually emits DDL:
   *
   * - `buildDesiredTableFromComponentFields` is the desired-state builder the diff engine runs for a
   *   field group. It renders each column for the dialect, injects the same system columns both
   *   sides get, carries the `idx_`/`uq_` indexes the schema service creates, and omits translatable
   *   columns when the group is localized. Comparing the table it describes for the old fields
   *   against the one it describes for the new is comparing what the generator would build;
   * - `fieldToLocalizedColumnSpec` and `ddlType` are what the companion reconciler renders its
   *   `ADD COLUMN` from, so the text they produce is the companion column itself;
   * - `isFieldLocalized` is the predicate `reconcileCompanion` filters on, and it folds in the
   *   entity flag, so a non-localized field group needs no separate branch.
   *
   * Both sides are built at the SAME localization state, deliberately. A `localized` toggle moves
   * columns between the two tables and `reconcileCompanion` performs exactly that move, so holding
   * the flag constant asks the question this guard is for — does the FIELD SET edit need DDL — and
   * leaves the transition to the code that applies it.
   *
   * A fourth opinion about where a column lives, or about what shape it takes, is exactly how the
   * three transports came to disagree in the first place.
   */
  private async assertNoUnappliableSchemaChange(args: {
    existing: DynamicFieldGroupRecord;
    fields: FieldDefinition[];
    localized: boolean;
  }): Promise<void> {
    const { buildDesiredTableFromComponentFields } = await import(
      "../../schema/pipeline/diff/build-from-fields"
    );
    const { getColumnDescriptor } = await import(
      "../../schema/services/field-column-descriptor"
    );
    const { isFieldLocalized } = await import("../../i18n/classify-fields");
    const { fieldToLocalizedColumnSpec } = await import(
      "../../i18n/migration/field-to-column-spec"
    );
    const { ddlType } = await import("../../i18n/migration/ddl-types");

    const oldFields = args.existing.fields as unknown as FieldDefinition[];
    const dialect = this.dialect;

    const desiredTable = (fields: FieldDefinition[]) =>
      buildDesiredTableFromComponentFields(
        args.existing.tableName,
        fields,
        dialect,
        { localized: args.localized, builtBy: "fieldGroup" }
      );

    const before = desiredTable(oldFields);
    const after = desiredTable(args.fields);

    /**
     * Which field a column belongs to, for the error path only.
     *
     * The comparison above has already decided; this just names the field so the caller is told
     * WHICH one to take through the apply flow. It reads the same `getColumnDescriptor(...).name`
     * the builder resolves its own column names with, and falls back to the raw column name when a
     * column belongs to no field — the system columns, which are identical on both sides and so
     * never appear here.
     */
    const fieldNameByColumn = new Map<string, string>();
    for (const field of [...oldFields, ...args.fields]) {
      const column = getColumnDescriptor(field, dialect, "fieldGroup");
      if (column) fieldNameByColumn.set(column.name, field.name);
    }
    const attribute = (column: string): string =>
      fieldNameByColumn.get(column) ?? column;

    const changed = new Set<string>();

    // Columns, by name: a serialised ColumnSpec so a spec gaining a property is not silently
    // excluded from the check that exists to notice it.
    const columnsOf = (table: typeof before): Map<string, string> =>
      new Map(
        table.columns.map(column => [column.name, JSON.stringify(column)])
      );
    const columnsBefore = columnsOf(before);
    const columnsAfter = columnsOf(after);
    for (const [name, spec] of columnsAfter) {
      if (columnsBefore.get(name) !== spec) changed.add(attribute(name));
    }
    for (const name of columnsBefore.keys()) {
      if (!columnsAfter.has(name)) changed.add(attribute(name));
    }

    // Indexes, by name. A field toggling `unique` or `index` leaves its COLUMN identical and moves
    // only this list, which is why the column comparison alone let it through. An index is
    // attributed to every field it covers, so a composite one names all of them.
    const indexesOf = (table: typeof before) =>
      new Map((table.indexes ?? []).map(index => [index.name, index]));
    const indexesBefore = indexesOf(before);
    const indexesAfter = indexesOf(after);
    for (const [name, index] of indexesAfter) {
      const was = indexesBefore.get(name);
      if (was && JSON.stringify(was) === JSON.stringify(index)) continue;
      for (const column of index.columns) changed.add(attribute(column));
    }
    for (const [name, index] of indexesBefore) {
      if (indexesAfter.has(name)) continue;
      for (const column of index.columns) changed.add(attribute(column));
    }

    // What the CREATOR would write for the main table, line by line.
    //
    // 🔴 The desired-table builder answers "which columns and indexes exist", which is what the diff
    // engine compares against introspection — and it deliberately carries no DEFAULT for a user
    // column, because a live database reports defaults in a form that would make every reconcile
    // propose changing them. `FieldGroupSchemaService` is the thing that actually creates a field
    // group's table, and it DOES emit a checkbox's `DEFAULT`. So a `defaultValue` edit changes the
    // column the creator writes while leaving the desired table identical, and rows inserted without
    // the field would keep taking the old default.
    //
    // Each user column is one line beginning with its quoted name, so a changed line still names the
    // field it belongs to.
    const { FieldGroupSchemaService } = await import(
      "../../../services/field-groups/field-group-schema-service"
    );
    const creatorLines = (fields: FieldDefinition[]): Map<string, string> => {
      const sql = new FieldGroupSchemaService(dialect).generateMigrationSQL(
        args.existing.tableName,
        // The stored field list and the config field list are two representations of one thing, and
        // this service already crosses between them where it writes the registry row and where it
        // reconciles the companion. Crossed here for the same reason: the creator is declared
        // against the config shape, and it is the creator's answer this needs.
        fields as unknown as Parameters<
          InstanceType<typeof FieldGroupSchemaService>["generateMigrationSQL"]
        >[1],
        { localized: args.localized }
      );
      const out = new Map<string, string>();
      for (const line of sql.split("\n")) {
        // A column definition, and nothing else: INDENTED and QUOTED, which the statements are
        // not. Matching an unquoted leading word instead picked up `CREATE TABLE ...` and reported
        // a field called "CREATE". The index statements are excluded on purpose — they are already
        // compared, by name and uniqueness, from the desired table above.
        const column = /^\s+["`]([A-Za-z0-9_]+)["`]\s+\S/.exec(line);
        if (column) out.set(column[1], line.trim());
      }
      return out;
    };
    const creatorBefore = creatorLines(oldFields);
    const creatorAfter = creatorLines(args.fields);
    for (const [column, line] of creatorAfter) {
      if (creatorBefore.get(column) !== line) changed.add(attribute(column));
    }
    for (const column of creatorBefore.keys()) {
      if (!creatorAfter.has(column)) changed.add(attribute(column));
    }

    // The companion, for a field localized on both sides. Compared as the rendered DDL type rather
    // than the spec object, because that string IS the column the reconciler would write: on SQLite
    // a `maxLength` change moves the spec and renders to the same TEXT, which needs no statement and
    // must not be refused.
    // Not a valid rendering of any column, so it can never equal one.
    const NO_COMPANION_COLUMN = "\u0000none";
    const companionOf = (fields: FieldDefinition[]): Map<string, string> => {
      const out = new Map<string, string>();
      for (const field of fields) {
        if (!isFieldLocalized(field, args.localized)) continue;
        const column = fieldToLocalizedColumnSpec(field, dialect, "fieldGroup");
        // 🔴 Recorded even when it materialises NO column, rather than skipped.
        //
        // Skipping made a field that gains or loses its column invisible: a `component` or
        // many-to-many field stores its data elsewhere and produces none, so changing it to `text`
        // under the same name left this map without a "before" entry and the change without a
        // common name to compare. `buildCompanionReconcileStatements` then diffs the raw localized
        // NAMES, sees the name already present, and emits no ADD — so the registry and the runtime
        // advance to a companion column nothing created. The reverse leaves the old one behind.
        //
        // A sentinel keeps the name in the map with a value that cannot collide with a rendered
        // column, so the transition reads as what it is: a change on a name present in both.
        out.set(
          field.name,
          column
            ? `${column.name} ${ddlType(column, dialect)}`
            : NO_COMPANION_COLUMN
        );
      }
      return out;
    };
    const companionBefore = companionOf(oldFields);
    const companionAfter = companionOf(args.fields);
    for (const [name, column] of companionAfter) {
      // Only a field present on BOTH sides: an add or a drop is the delta the reconciler applies.
      const was = companionBefore.get(name);
      if (was !== undefined && was !== column) changed.add(name);
    }

    // 🔴 A companion that both GAINS and LOSES a column in one edit is a rename the reconciler
    // cannot see, and the consequence is destroyed content rather than a stale shape.
    //
    // Neither companion path resolves it. While the group STAYS localized,
    // `buildCompanionReconcileStatements` diffs by name alone, so a rename becomes ADD the new
    // column, DROP the old — and every stored translation goes with the drop. While localization is
    // being ENABLED, `buildCompanionTransitionStatements` seeds only the new columns whose name
    // already exists on main, so a renamed field is seeded from nothing and its old column is left
    // behind on the main table.
    //
    // A drop-and-add pair is the ambiguity the apply pipeline exists to resolve — its rename
    // detector asks which of the two a caller meant, and a PATCH has no way to ask. So this refuses
    // only the PAIR: a pure add is a new translatable field and a pure drop is a removed one, and
    // the reconciler applies both correctly.
    // 🔴 Only fields that actually RENDER a column, which is narrower than the map's keys.
    //
    // The map deliberately records every localized field, sentinel included, so that a field
    // GAINING or LOSING its column shows up as a change on a common name. That is the right domain
    // for the value comparison above and the wrong one here: two columnless fields swapped for each
    // other — a `component` removed and a differently named `component` added — are one add and one
    // drop by key, which reads as a rename pair, while neither materialises a companion column and
    // `buildCompanionReconcileStatements` emits nothing for either. Refusing that would reject a
    // safe metadata-only edit.
    //
    // The same narrowing is correct for the enablement rule below: a columnless field removed during
    // an enable leaves no column behind on the main table, so there is nothing stranded to refuse.
    const rendersColumn = (map: Map<string, string>, name: string): boolean =>
      map.get(name) !== NO_COMPANION_COLUMN;
    const companionAdded = [...companionAfter.keys()].filter(
      name => !companionBefore.has(name) && rendersColumn(companionAfter, name)
    );
    const companionDropped = [...companionBefore.keys()].filter(
      name => !companionAfter.has(name) && rendersColumn(companionBefore, name)
    );
    if (companionAdded.length > 0 && companionDropped.length > 0) {
      for (const name of [...companionAdded, ...companionDropped])
        changed.add(name);
    }

    // 🔴 A DROP is only appliable when the companion already exists, which an ENABLE means it does
    // not.
    //
    // Both main-table snapshots are built at the requested state, so a field that is translatable
    // under it never appears on either — including one this edit REMOVES, whose column is still
    // physically on the main table because the group is not localized yet. The enable planner then
    // derives its companion from the NEW fields alone, so nothing drops that column: the registry
    // stops describing the field while its data sits on a column nothing will ever read again.
    //
    // The pair rule above cannot catch it, because a removal on its own has no matching add.
    const isEnabling = args.existing.localized !== true && args.localized;
    if (isEnabling && companionDropped.length > 0) {
      for (const name of companionDropped) changed.add(name);
    }

    if (changed.size === 0) return;

    const names = [...changed];
    throw NextlyError.validation({
      errors: names.map(name => ({
        path: `fields.${name}`,
        code: "requires_schema_change",
        message: `Changing "${name}" alters the field group's table. Use the schema preview and apply flow, which reviews the change and resolves renames, rather than updating the field group directly.`,
      })),
      logContext: {
        reason: "field update requires ddl this path does not emit",
        slug: args.existing.slug,
        fields: names,
      },
    });
  }

  /**
   * The registry write failed AFTER the companion transition committed. Say so, and mark the row.
   *
   * 🔴 The two halves of this operation cannot be made atomic — MySQL commits DDL implicitly, which
   * is why this service says so at the top of the file — so this is the state the ordering leaves
   * when the second half fails. The tables have the new shape and the row still describes the old
   * one.
   *
   * Raising the registry's own error would be worse than useless here: it reads as "the write did
   * not happen", which invites a retry, and a retry re-derives `wasLocalized` from the row that
   * still says the old value. For an enable that means seeding the companion a second time from
   * main-table columns the first attempt already dropped. The caller has to be told the physical
   * change stands.
   *
   * The status write is BEST EFFORT and its failure is not raised. It is a narrow single-column
   * update, so it survives the failures that realistically break the full write — a rejected field
   * list, an oversized label, a value the driver cannot encode — and if the database is genuinely
   * unreachable it fails too, which is why the log carries everything needed to find the field
   * group without it.
   */
  private async recordUnrecordedTransition(
    slug: string,
    existing: DynamicFieldGroupRecord,
    cause: unknown
  ): Promise<never> {
    this.logger.error(
      "[FieldGroups] Schema transition committed but its registry row was not written.",
      {
        slug,
        tableName: existing.tableName,
        wasLocalized: existing.localized === true,
        error: cause instanceof Error ? cause.message : String(cause),
      }
    );

    let marked = false;
    try {
      await this.registry.updateComponent(
        slug,
        { migrationStatus: "diverged" },
        // The version advances even though this write carries no new field set: the TABLES moved,
        // and an editor loaded before that is now describing a shape that is gone. Leaving the
        // version alone would let such a preview pass `assertSchemaVersionMatch` and apply its
        // stale resolutions against the tables this transition already changed.
        { source: "code", invalidateSchemaVersion: true }
      );
      marked = true;
    } catch (markError) {
      this.logger.error(
        "[FieldGroups] Could not mark the field group as diverged either.",
        {
          slug,
          error:
            markError instanceof Error ? markError.message : String(markError),
        }
      );
    }

    // Constructed rather than `NextlyError.internal`, which fixes the public message to "An
    // unexpected error occurred." That is the one thing this caller must NOT be told: the whole
    // point is that the edit half-happened and repeating it is harmful. The status still comes from
    // the central mapping rather than a literal, so this cannot drift from the code it carries.
    //
    // 🔴 The message distinguishes whether the mark was PERSISTED. Claiming a durable record that
    // does not exist is worse than admitting the log is the only trace: the first sends an operator
    // looking at a row that reads normal, the second tells them where to look.
    throw new NextlyError({
      code: "INTERNAL_ERROR",
      statusCode: NEXTLY_ERROR_STATUS.INTERNAL_ERROR,
      publicMessage: marked
        ? `The field group's tables were changed, but recording the change failed. "${slug}" is marked as diverged and its stored definition still describes the previous shape. Do not retry the same edit: check the server logs and reconcile the field group before editing it again.`
        : `The field group's tables were changed, but neither the change nor the failure could be recorded. "${slug}" still reads as though nothing happened, and the only trace is the server log. Do not retry the same edit: reconcile the field group against its tables before editing it again.`,
      cause: cause instanceof Error ? cause : undefined,
      logContext: {
        reason: "registry write failed after committed schema transition",
        slug,
        tableName: existing.tableName,
      },
    });
  }

  /** The stored hash for a field set, from the one implementation the whole pipeline uses. */
  private async hashFields(fields: FieldDefinition[]): Promise<string> {
    const { calculateSchemaHash } = await import(
      "../../schema/services/schema-hash"
    );
    return calculateSchemaHash(fields as never);
  }

  /**
   * Apply the companion-table transition this edit implies, and let a failure be a failure.
   *
   * 🔴 NOT swallowed, and that is a deliberate change from the dispatcher this replaces. It logged
   * the error and fell through to the registry write, so a transition that failed still committed a
   * row saying the field group was localized with the new field set — the exact state whose
   * consequence the code above it describes as content stranded in the wrong table. Refusing leaves
   * the registry describing the old shape, which is the shape the table still has.
   *
   * The runtime rebinding happens only after the move succeeds, for the reason the create path
   * gives: the binding DESCRIBES the table, so describing a change that did not happen points the
   * running process at columns nothing created.
   */
  private async reconcileCompanion(args: {
    existing: DynamicFieldGroupRecord;
    fields: FieldDefinition[];
    localized: boolean;
    wasLocalized: boolean;
    // Whether DDL actually ran, carried up from the reconciler rather than re-derived. With no
    // adapter registered nothing runs at all, which is a supported configuration and reports false.
  }): Promise<boolean> {
    const adapter = this.adapter;
    if (!adapter) return false;

    const {
      reconcileComponentCompanion,
      registerComponentRuntimeSchema,
      resolveComponentTypeColumn,
    } = await import("./field-group-table-provisioning");

    // 🔴 Probed BEFORE the transition, which is the helper's own documented contract. Resolving it
    // afterwards means a probe that cannot answer rejects the request with the physical move
    // already committed — an enable that dropped the main table's columns while the registry still
    // records the group as non-localized. The discriminator is unaffected by the transition, so
    // asking first is equivalent and fails while nothing has moved.
    const typeColumn = await resolveComponentTypeColumn(
      adapter,
      args.existing.tableName
    );

    const moved = await reconcileComponentCompanion({
      slug: args.existing.slug,
      tableName: args.existing.tableName,
      oldFields: args.existing.fields as unknown as FieldDefinition[],
      newFields: args.fields,
      localized: args.localized,
      wasLocalized: args.wasLocalized,
      adapter,
    });

    registerComponentRuntimeSchema(
      adapter,
      this.dialect,
      args.existing.tableName,
      args.fields as never,
      // PROBED, not the constant: unlike the create path this table already exists and the storage
      // migration may have moved it, so which discriminator column it carries is a fact about the
      // database rather than something this code can infer from its own version.
      typeColumn,
      args.localized
    );

    return moved;
  }

  /**
   * Point the runtime at the table that was just created.
   *
   * Separated from the apply so it can run after the registry write rather than with the DDL. It
   * describes the table to the running process; the DDL only makes it exist.
   */
  private async bindRuntimeSchema(input: CreateFieldGroupInput): Promise<void> {
    const adapter = this.adapter;
    if (!adapter) return;

    const { registerComponentRuntimeSchema } = await import(
      "./field-group-table-provisioning"
    );
    registerComponentRuntimeSchema(
      adapter,
      this.dialect,
      input.tableName,
      input.fields,
      // The constant, NOT a probe, and this is the one path where that inference is sound: this is
      // the CREATE path for a new slug, and the statements just executed are the DDL generator's
      // own, which write this column. A table the storage migration had moved would carry the
      // migrated prefix and could not be addressed by this name at all.
      STORAGE_FORMAT.columns.type,
      input.localized === true
    );
  }

  /**
   * Refuse a create whose generated names the database would not store intact.
   *
   * 🔴 Checked over the NAMES rather than over the slug, because the slug is not the only input.
   * A field's index is named `idx_<tableName>_<columnName>`, so the longest identifier depends on
   * the slug AND the longest indexed field name — and no bound on one can constrain the other. A
   * slug inside its limit paired with `authorId` still produces a 66-character index.
   *
   * Refused BEFORE any DDL because the failure is otherwise partial and silent-ish: the table and
   * the parent index are created, the field index fails, and the caller gets back a record whose
   * migration is recorded failed. Nothing is corrupted, but a field group exists that nothing can
   * query, and the request that made it reported a success shape.
   *
   * Here rather than in a transport for the same reason the ownership check is: the mounted route
   * bounded its slug and the other two transports did not, which is this service's founding defect
   * reappearing one level up.
   */
  private async assertIdentifiersFit(
    input: CreateFieldGroupInput,
    migrationSQL: string
  ): Promise<void> {
    const { FieldGroupSchemaService, MAX_IDENTIFIER_LENGTH } = await import(
      "./field-group-schema-service"
    );

    const schema = new FieldGroupSchemaService(this.dialect);
    // The rendered statements, plus the companion this create would provision alongside them. The
    // companion's DDL is generated later and separately, so its name is the one identifier the scan
    // cannot see.
    const names = schema.identifiersIn(migrationSQL);
    if (input.localized === true) {
      names.push(`${input.tableName}${STORAGE_FORMAT.companionSuffix}`);
    }

    const tooLong = names.filter(name => name.length > MAX_IDENTIFIER_LENGTH);
    if (tooLong.length === 0) return;

    throw NextlyError.validation({
      errors: tooLong.map(name => ({
        path: "slug",
        code: "IDENTIFIER_TOO_LONG",
        // The offending NAME, not just its length: a slug, a field name and the index derived from
        // both all reach this, and the caller cannot otherwise tell which to shorten.
        message: `Generated database identifier "${name}" is ${name.length} characters; the limit is ${MAX_IDENTIFIER_LENGTH}. Shorten the field group's slug or the field name it derives from.`,
      })),
    });
  }

  /**
   * Refuse a create whose table another field group already owns.
   *
   * Keyed on the TABLE NAME rather than the slug, because the two are not the same key: a slug is
   * normalised on its way to a table name, so `foo-bar` and `foo_bar` name one physical table while
   * looking like two free slugs.
   *
   * It has to run before the DDL rather than after. `CREATE TABLE IF NOT EXISTS` reports success
   * against a table that already exists, the runtime registration that follows then rebinds that
   * table to THIS request's fields, and only afterwards does the registry reject the duplicate — so
   * a refused create would leave the existing field group reading through a schema that does not
   * describe it, until the process restarts.
   *
   * Here rather than in a request handler because all three create transports need it and only one
   * of them had it. The same reason the DDL itself moved into this service.
   *
   * Two callers racing can still both pass this check; the registry table declares `table_name`
   * unique, so the second insert is rejected by the database rather than by this.
   */
  private async assertTableUnowned(
    input: CreateFieldGroupInput
  ): Promise<void> {
    const owner = (await this.registry.getAllComponents()).find(
      existing => existing.tableName === input.tableName
    );
    if (!owner) return;

    throw NextlyError.duplicate({
      logContext: {
        reason: "component-table-conflict",
        slug: input.slug,
        tableName: input.tableName,
        ownedBy: owner.slug,
      },
    });
  }

  /** Render the DDL. Separated from the apply because this half is allowed to reject the request. */
  private async planCreate(input: CreateFieldGroupInput): Promise<string> {
    const { FieldGroupSchemaService } = await import(
      "../../../services/field-groups/field-group-schema-service"
    );
    return new FieldGroupSchemaService(this.dialect).generateMigrationSQL(
      input.tableName,
      input.fields,
      // i18n: translatable columns are omitted from the main comp_ table when localized; they live
      // in the companion `comp_<slug>_locales`, provisioned below.
      { localized: input.localized === true }
    );
  }

  /**
   * Run the create DDL, reporting how far it got.
   *
   * Never throws: a schema change that fails is recorded rather than raised, so the caller still has
   * a row describing what was attempted. That is what makes the state repairable instead of lost.
   */
  private async applyCreateDdl(
    input: CreateFieldGroupInput,
    migrationSQL: string
  ): Promise<FieldGroupMigrationStatus> {
    const adapter = this.adapter;
    if (!adapter) {
      this.logger.warn(
        "[FieldGroups] No adapter registered, migration not executed"
      );
      return "pending";
    }

    const isLocalized = input.localized === true;
    const fields = input.fields as unknown as FieldDefinition[];

    // The verification shares the statements' catch rather than following it. `tableExists`
    // re-raises the query failures it meets, and left outside this it would reject the whole apply
    // — breaking the one promise this method makes, that a schema change which fails is RECORDED
    // rather than raised. A transient failure there would take the registry write with it and leave
    // the table that was just created with nothing describing it.
    try {
      const { applyMigrationStatements } = await import(
        "../../schema/services/apply-migration-statements"
      );
      await applyMigrationStatements(adapter, migrationSQL);

      // Observed, not assumed. "Applied" has to mean the table is there.
      if (!(await adapter.tableExists(input.tableName))) {
        this.logger.error(
          `[FieldGroups] Table "${input.tableName}" was not created after migration`
        );
        return "failed";
      }
    } catch (error) {
      this.logger.error(
        `[FieldGroups] Migration execution failed for "${input.tableName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return "failed";
    }

    const { reconcileComponentCompanion } = await import(
      "./field-group-table-provisioning"
    );

    // The companion is the other half of a localized field group's storage, so failing to provision
    // it leaves translatable values with nowhere to live. Reported as a failed migration rather than
    // thrown: the main table exists and the row describes it, which is what makes a retry possible.
    try {
      await reconcileComponentCompanion({
        slug: input.slug,
        tableName: input.tableName,
        oldFields: [],
        newFields: fields,
        localized: isLocalized,
        // A brand-new field group was never localized, so a localized create is a create-only
        // companion rather than an enable transition.
        wasLocalized: false,
        adapter,
      });
    } catch (error) {
      this.logger.error(
        `[FieldGroups] Companion provisioning failed for "${input.tableName}": ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return "failed";
    }

    return "applied";
  }
}
