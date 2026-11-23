/**
 * The changes not yet in a migration (`PendingChanges`), planned from `migrate:create`'s own inputs
 * as it plans a run (`planRun`), asking nothing and writing nothing: a rename or a move it would
 * ask about is read as the delete and the add the diff holds, which is pending either way.
 *
 * @module domains/schema/pending/plan-pending
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { AppMigrationInputs } from "../migrate-create/app-migration-inputs";
import type { PermissionRecord } from "../migrate-create/declared-permissions";
import { planRun } from "../migrate-create/generate";

import { type PendingChanges, pendingChangesOf } from "./pending-changes";

/** What a run names when the plan holds nothing: no table, file, setting or permission. */
const NOTHING: PendingChanges = {
  tables: [],
  beside: [],
  settings: [],
  permissions: [],
  movesValues: false,
  noSnapshot: false,
  perLanguageMoves: [],
};

/**
 * The changes `migrate:create` would write a migration for, from the inputs it reads
 * (`appMigrationInputs`). A declaration it would refuse is thrown, as it throws it.
 */
export async function pendingChanges(args: {
  inputs: Pick<
    AppMigrationInputs,
    "collections" | "singles" | "components" | "appStream" | "latest"
  >;
  dialect: SupportedDialect;
  migrationsDir: string;
  /** Every permission the configuration declares, by owner (`declaredPermissionsOf`). */
  permissions?: PermissionRecord;
  /** The configuration's default language and its order of languages. */
  defaultLocale?: string;
  languageOrder?: readonly string[];
}): Promise<PendingChanges> {
  const { inputs } = args;
  const planned = await planRun({
    name: "pending",
    dialect: args.dialect,
    migrationsDir: args.migrationsDir,
    appStream: inputs.appStream,
    collections: inputs.collections,
    singles: inputs.singles,
    components: inputs.components,
    previous: inputs.latest,
    ...(args.permissions !== undefined
      ? { permissions: args.permissions }
      : {}),
    ...(args.defaultLocale !== undefined
      ? { defaultLocale: args.defaultLocale }
      : {}),
    ...(args.languageOrder !== undefined
      ? { languageOrder: args.languageOrder }
      : {}),
    nonInteractive: true,
    // A report: what a run refuses to write is still a change it would have to write.
    reportOnly: true,
    // Nobody is asked: a rename stays the delete and the add the diff reads.
    decideRenames: () => Promise.resolve([]),
  });
  // Only a run that records the snapshot plans nothing at all, which this one never is.
  return planned === null ? NOTHING : pendingChangesOf(planned);
}
