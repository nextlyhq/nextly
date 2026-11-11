/**
 * The public addresses a document holds now, in each of the site's languages.
 *
 * A document holds, in each language it is published in, the address its type
 * gives it there (`publicAddressOf`'s answer, when resolved). A draft holds
 * nothing, and neither does an entry whose address cannot be filled yet. The
 * values are read on the write's own transaction, so a save's uncommitted
 * translation is what counts, and no second connection is taken.
 *
 * @module domains/public-addresses/held-addresses
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { container } from "../../di";
import type { InTransactionWrite } from "../../hooks/types";
import type { CollectionService } from "../collections/services/collection-service";
import {
  readCompanionLocaleStatusAll,
  resolveLocalizedValue,
} from "../i18n/companion-join";
import { appLocalization } from "../i18n/configured-locales";
import {
  publishesPerLanguage,
  storesPerLanguage,
} from "../i18n/per-language-storage";
import { resolveLocaleChain } from "../i18n/resolve-locale";
import {
  buildCompanionSchema,
  type CompanionSchema,
} from "../i18n/runtime/companion-io";
import { cachedCompanionReadiness } from "../i18n/runtime/companion-readiness";
import { languageIsLive } from "../i18n/runtime/language-lifecycle";
import type { SingleRegistryService } from "../singles/services/single-registry-service";
import { readCompanionValuesByLocale } from "../singles/services/single-webhook-doc";

import type { HeldAddress } from "./participants";
import {
  addressFrom,
  declaredFor,
  typeRecordOn,
  type PublicAddressType,
} from "./public-address";

/** One language's version of a document, as it is served there. */
export interface LanguageVersion {
  published: boolean;
  document: Readonly<Record<string, unknown>>;
}

/**
 * The languages an address is held in: the site's languages, or the one it
 * serves without localization, its default (`"en"` where none is named), as
 * Page Builder's address store holds them, so the two never key one page's
 * address by two languages.
 */
export function addressLanguages(): string[] {
  const codes = appLocalization()?.locales.map(locale => locale.code) ?? [];
  return codes.length > 0 ? codes : [defaultAddressLanguage()];
}

/**
 * The language an address read with none named is held in: the site's
 * default language as it is now, a choice made in Settings included, or
 * `"en"` where it names none.
 */
export function defaultAddressLanguage(): string {
  const fallback = appLocalization()?.defaultLocale;
  return fallback !== undefined && fallback !== "" ? fallback : "en";
}

/** The type a write names: `single:<slug>` is a Single, anything else a collection. */
export function typeOfWrite(collection: string): PublicAddressType {
  return collection.startsWith("single:")
    ? { kind: "single", slug: collection.slice("single:".length) }
    : { kind: "collection", slug: collection };
}

/**
 * Each translated field's value in each language, by field name, as a public
 * read in that language resolves it: along the language's fallback chain,
 * through the `live` languages only, where the site falls back, else its own
 * value alone, so a field untranslated there is null rather than the saved
 * language's value.
 */
async function translations(
  tx: TransactionContext,
  companion: CompanionSchema,
  id: string,
  languages: readonly string[],
  live: ReadonlySet<string>
): Promise<Map<string, Record<string, unknown>>> {
  const byColumn = await readCompanionValuesByLocale(
    container.get<DrizzleAdapter>("adapter"),
    tx,
    companion,
    id,
    languages
  );
  const localization = appLocalization();
  return translatedValues(
    byColumn,
    companion.localizedFields,
    languages,
    live,
    language =>
      resolveLocaleChain(localization, language, undefined) ?? [language]
  );
}

/**
 * Each language's value of each translated field, by field name, from the
 * stored values `byColumn` (each language's, keyed by column): along the
 * language's `chainOf` fallbacks, passing over a language not `live`, as a
 * public read does, since a draft translation is never what a visitor is
 * served.
 */
export function translatedValues(
  byColumn: ReadonlyMap<string, Record<string, unknown>>,
  fields: readonly { name: string; column: string }[],
  languages: readonly string[],
  live: ReadonlySet<string>,
  chainOf: (language: string) => string[]
): Map<string, Record<string, unknown>> {
  const byName = new Map<string, Record<string, unknown>>();
  for (const language of languages) {
    const chain = chainOf(language).filter(
      code => code === language || live.has(code)
    );
    const named: Record<string, unknown> = {};
    for (const field of fields) {
      const perLocale = Object.fromEntries(
        chain.map(code => [code, byColumn.get(code)?.[field.column]])
      );
      // Nothing read at all (a translations table not yet migrated reads no
      // value, not null): the main row still holds the field, and it stands.
      if (Object.values(perLocale).every(value => value === undefined)) {
        continue;
      }
      named[field.name] = resolveLocalizedValue(perLocale, chain);
    }
    byName.set(language, named);
  }
  return byName;
}

/**
 * The translations table of `type`, or null for a type that keeps no values
 * per language: a collection's from its file manager, a Single's built from
 * its registry row as every other reader of a Single's companion does.
 */
async function companionOf(
  type: PublicAddressType,
  executor: unknown
): Promise<CompanionSchema | null> {
  if (type.kind === "collection") {
    return container
      .get<CollectionService>("collectionService")
      .companionSchemaOf(type.slug, executor);
  }
  const row = await container
    .get<SingleRegistryService>("singleRegistryService")
    .getSingleBySlug(type.slug, executor);
  if (!row || !storesPerLanguage(row)) return null;
  return buildCompanionSchema({
    slug: type.slug,
    tableName: row.tableName,
    fields: row.fields as Parameters<typeof buildCompanionSchema>[0]["fields"],
    dialect: container.get<DrizzleAdapter>("adapter").dialect,
    status: publishesPerLanguage(row),
  });
}

/**
 * The main row's status, on the transaction. The main table is the one the
 * translations table is named after (`<table>_locales`).
 */
async function mainRowStatus(
  tx: TransactionContext,
  companion: CompanionSchema,
  id: string
): Promise<unknown> {
  const mainTable = companion.companionTableName.replace(/_locales$/, "");
  const row = await tx.selectOne<{ status?: unknown }>(mainTable, {
    columns: ["status"],
    where: { and: [{ column: "id", op: "=", value: id }] },
  });
  return row?.status;
}

/** Each language's own status, where the type publishes each on its own. */
async function statuses(
  tx: TransactionContext,
  companion: CompanionSchema,
  id: string
): Promise<Map<string, string | null>> {
  return readCompanionLocaleStatusAll(
    tx.getDrizzle<Parameters<typeof readCompanionLocaleStatusAll>[0]>(),
    companion.table,
    id,
    cachedCompanionReadiness(
      container.get<DrizzleAdapter>("adapter"),
      companion.companionTableName
    )
  );
}

/**
 * Whether a document is published in `language`: always for a type without
 * Draft/Published, and otherwise by the rule every read of a language's
 * liveness uses (`languageIsLive`): the main row must be live, and the
 * language's own status too where the type publishes per language, the
 * default language falling back to the main row where it has none.
 */
export function publishedIn(
  language: string,
  statuses: {
    lifecycle: boolean;
    mainStatus: unknown;
    ownStatus: ReadonlyMap<string, string | null> | undefined;
  }
): boolean {
  if (!statuses.lifecycle) return true;
  return languageIsLive({
    mainStatus: statuses.mainStatus,
    ownStatus: statuses.ownStatus?.get(language) ?? null,
    locale: language,
    defaultLocale: appLocalization()?.defaultLocale ?? null,
    perLanguageStatus: statuses.ownStatus !== undefined,
  });
}

/**
 * The document `write` leaves, in each of the site's languages: its values
 * there and whether it is published there. A delete leaves nothing.
 *
 * At most three reads, all on `tx`: the translations, and, where the type
 * publishes per language, each language's status and the main row's. A Single, whose
 * address names no field, is read the same way.
 */
export async function readEveryLanguage(
  tx: TransactionContext,
  write: Pick<InTransactionWrite, "collection" | "id" | "data" | "operation">
): Promise<Map<string, LanguageVersion>> {
  const versions = new Map<string, LanguageVersion>();
  if (write.operation === "delete" || write.data === undefined) return versions;
  const type = typeOfWrite(write.collection);
  const executor = tx.getDrizzle();
  const record = await typeRecordOn(type, executor);
  const lifecycle = record?.status === true;
  const shared = write.data;
  const languages = addressLanguages();

  const companion = await companionOf(type, executor);
  const ownStatus =
    companion?.hasStatus === true
      ? await statuses(tx, companion, write.id)
      : undefined;
  // Where each language has a status of its own, the saved document shows
  // the saved language's, so the main row's is read for itself.
  const mainStatus =
    companion?.hasStatus === true
      ? await mainRowStatus(tx, companion, write.id)
      : shared.status;
  const live = new Set(
    languages.filter(language =>
      publishedIn(language, { lifecycle, mainStatus, ownStatus })
    )
  );
  const translated = companion
    ? await translations(tx, companion, write.id, languages, live)
    : undefined;

  for (const language of languages) {
    versions.set(language, {
      published: live.has(language),
      document: { ...shared, ...translated?.get(language) },
    });
  }
  return versions;
}

/**
 * The addresses `type` gives the published versions in `perLanguage`, in
 * language order. Declarations are read on `executor`.
 */
export async function heldIn(
  type: PublicAddressType,
  perLanguage: ReadonlyMap<string, LanguageVersion>,
  tx?: TransactionContext
): Promise<HeldAddress[]> {
  const executor = tx?.getDrizzle();
  const held: HeldAddress[] = [];
  for (const [locale, version] of perLanguage) {
    if (!version.published) continue;
    const declared = await declaredFor(type, locale, undefined, executor);
    const address = addressFrom(type, declared, version.document);
    if (address.status === "resolved") {
      held.push({ locale, path: address.path });
    }
  }
  return held;
}
