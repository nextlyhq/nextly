/**
 * The site as the upgrade's localisation steps judge it: its languages and every entity it holds,
 * whether its configuration declares it or the Schema Builder made it.
 *
 * @module cli/commands/upgrade-steps/localisation-site
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  declaredLaidOutEntities,
  readLayoutScanEntities,
} from "../../../di/layout-scan-entities";
import { standardLanguageCode } from "../../../domains/i18n/config/standard-code";
import {
  IMPLICIT_LANGUAGE,
  localizationFromStoredLanguages,
} from "../../../domains/i18n/config/stored-languages";
import type { LaidOutEntity } from "../../../domains/i18n/per-language-storage-layout";
import { storedLanguageReader } from "../../../domains/i18n/stored-language-reader";
import type { ColumnOrigin } from "../../../domains/schema/services/field-column-descriptor";
import type { UpgradeStepContext } from "../upgrade-step";

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
    return {
      codes: declared.locales.map(locale =>
        typeof locale === "string" ? locale : locale.code
      ),
      defaultLocale: declared.defaultLocale,
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
  const declared = declaredLaidOutEntities(context.site ?? {});
  return [
    ...declared,
    ...(await readLayoutScanEntities(
      context.adapter as unknown as DrizzleAdapter,
      new Set(declared.map(entity => entity.tableName))
    )),
  ];
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
