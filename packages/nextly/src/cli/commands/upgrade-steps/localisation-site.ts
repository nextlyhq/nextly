/**
 * The site as the upgrade's localisation steps judge it: its languages and every entity it holds,
 * whether its configuration declares it or the Schema Builder made it.
 *
 * @module cli/commands/upgrade-steps/localisation-site
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  declaredLaidOutEntitiesAsStored,
  readLayoutScanEntities,
} from "../../../di/layout-scan-entities";
import { standardLanguageCode } from "../../../domains/i18n/config/standard-code";
import {
  IMPLICIT_LANGUAGE,
  localizationFromStoredLanguages,
} from "../../../domains/i18n/config/stored-languages";
import type { LaidOutEntity } from "../../../domains/i18n/per-language-storage-layout";
import { storedLanguageReader } from "../../../domains/i18n/stored-language-reader";
import { NextlyError } from "../../../errors/nextly-error";
import { introspectLiveColumns } from "../../../domains/schema/pipeline/diff/introspect-live";
import type { ColumnOrigin } from "../../../domains/schema/services/field-column-descriptor";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { UpgradeSite, UpgradeStepContext } from "../upgrade-step";

/**
 * The site a run of the data steps judges by, from the configuration the command loaded: its
 * languages and the entities it declares.
 */
export function upgradeSiteOf(config: {
  localization?: UpgradeSite["localization"];
  collections?: UpgradeSite["collections"];
  singles?: UpgradeSite["singles"];
  fieldGroups?: UpgradeSite["fieldGroups"];
}): UpgradeSite {
  return {
    ...(config.localization === undefined
      ? {}
      : { localization: config.localization }),
    collections: config.collections ?? [],
    singles: config.singles ?? [],
    fieldGroups: config.fieldGroups ?? [],
  };
}

/** The site's languages in its order, its default first among equals. */
export interface SiteLanguages {
  codes: string[];
  defaultLocale: string;
}

/**
 * The site's languages as a running site reads them, each code in its standard form
 * (`standardLanguageCode`), which every row is stored under once the codes are converted.
 */
export async function siteLanguages(
  context: UpgradeStepContext
): Promise<SiteLanguages> {
  const configured = await configuredLanguages(context);
  const standard = (code: string) => standardLanguageCode(code) ?? code;
  return {
    codes: [...new Set(configured.codes.map(standard))],
    defaultLocale: standard(configured.defaultLocale),
  };
}

/**
 * The site's languages as its configuration writes them: those it declares, else those kept in
 * Settings, else the one implicit language a site that declares none serves. Only the step that
 * converts codes reads them as written.
 */
export async function configuredLanguages(
  context: UpgradeStepContext
): Promise<SiteLanguages> {
  const declared = context.site?.localization;
  if (declared) {
    // A configuration read through the loader holds each code in standard form; the codes it
    // wrote the earlier way are named beside them (`olderCodes`), and read back as written here.
    const asWritten = (code: string) =>
      declared.olderCodes?.find(older => older.to === code)?.from ?? code;
    return {
      codes: declared.locales.map(locale =>
        asWritten(typeof locale === "string" ? locale : locale.code)
      ),
      defaultLocale: asWritten(declared.defaultLocale),
    };
  }
  const stored = localizationFromStoredLanguages(
    await storedLanguageReader(
      context.adapter as unknown as DrizzleAdapter
    ).rows()
  );
  if (stored) {
    return {
      codes: stored.locales.map(locale => locale.code),
      defaultLocale: stored.defaultLocale,
    };
  }
  return {
    codes: [IMPLICIT_LANGUAGE.code],
    defaultLocale: IMPLICIT_LANGUAGE.code,
  };
}

/**
 * Every entity the site holds: those its configuration declares, and those the Schema Builder's
 * registries hold that it does not, as the boot's storage-layout check reads them.
 */
export async function siteEntities(
  context: UpgradeStepContext
): Promise<LaidOutEntity[]> {
  const declared = await declaredLaidOutEntitiesAsStored(
    context.adapter as unknown as DrizzleAdapter,
    context.site ?? {}
  );
  return [
    ...declared,
    ...(await readLayoutScanEntities(
      context.adapter as unknown as DrizzleAdapter,
      new Set(declared.map(entity => entity.tableName))
    )),
  ];
}

/** The version-history columns the steps that rewrite pending changes read and write. */
const PENDING_CHANGE_COLUMNS = [
  "draft_key",
  "changed_locales",
  "shared_changed",
] as const;

/**
 * Whether the version history is laid out as this release keeps it: the steps that rewrite
 * pending changes read and write its newer columns, which an earlier release's table lacks until
 * `nextly migrate`'s migrations add them. Where it is not, those steps refuse
 * (`assertVersionHistoryReady`) rather than skip.
 */
export async function versionHistoryReady(
  context: UpgradeStepContext
): Promise<boolean> {
  if (!(await context.adapter.tableExists(VERSIONS_TABLE))) return false;
  const adapter = context.adapter as unknown as DrizzleAdapter;
  const { tables } = await introspectLiveColumns(
    adapter.getDrizzle(),
    adapter.dialect,
    [VERSIONS_TABLE]
  );
  const present = new Set(
    (tables[0]?.columns ?? []).map(column => column.name)
  );
  return PENDING_CHANGE_COLUMNS.every(column => present.has(column));
}

/**
 * Refuses, naming the repair, where the version history is not laid out as this release keeps it
 * (`versionHistoryReady`) yet holds pending changes a localisation step would rewrite: keying,
 * splitting or recoding them writes the newer columns, which only `nextly migrate`'s migrations
 * add. Nothing is skipped in silence, and nothing is changed. A database with no pending change
 * has nothing for those steps to do, and passes.
 */
export async function assertVersionHistoryReady(
  context: UpgradeStepContext
): Promise<void> {
  if (!(await context.adapter.tableExists(VERSIONS_TABLE))) return;
  if (await versionHistoryReady(context)) return;
  const adapter = context.adapter as unknown as DrizzleAdapter;
  // Read with the columns every release's table has.
  const pending = await adapter.select<{ id: string }>(VERSIONS_TABLE, {
    columns: ["id"],
    where: {
      and: [
        { column: "versionNo", op: "IS NULL" },
        { column: "status", op: "=", value: "draft" },
      ],
    },
    limit: 1,
  });
  if (pending.length === 0) return;
  throw new NextlyError({
    code: "NEXTLY_UPGRADE_LOCALISATION_UNRESOLVED",
    publicMessage:
      "The version history holds pending changes but is not laid out as this release keeps it " +
      `(it lacks ${PENDING_CHANGE_COLUMNS.join(", ")}). Run \`nextly migrate\` without --step, ` +
      "so its migrations add them before its data steps key and split the pending changes. " +
      "Nothing was changed.",
    logContext: { table: VERSIONS_TABLE },
  });
}

/**
 * How `entity`'s columns were built, which decides a moved column's type: a component by the
 * component builder, one the Schema Builder made by its own, and anything code declared by the
 * pipeline's.
 */
export function builtByOf(entity: LaidOutEntity): ColumnOrigin {
  if (entity.kind === "component") return "fieldGroup";
  return entity.builderOwned === true ? "collection" : "codeFirst";
}
