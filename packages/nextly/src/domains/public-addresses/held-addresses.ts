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
import { readCompanionLocaleStatusAll } from "../i18n/companion-join";
import { appLocalization } from "../i18n/configured-locales";
import { cachedCompanionReadiness } from "../i18n/runtime/companion-readiness";
import type { CompanionSchema } from "../i18n/runtime/companion-io";
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
  const localization = appLocalization();
  const codes = localization?.locales.map(locale => locale.code) ?? [];
  if (codes.length > 0) return codes;
  const fallback = localization?.defaultLocale;
  return [fallback !== undefined && fallback !== "" ? fallback : "en"];
}

/** The type a write names: `single:<slug>` is a Single, anything else a collection. */
export function typeOfWrite(collection: string): PublicAddressType {
  return collection.startsWith("single:")
    ? { kind: "single", slug: collection.slice("single:".length) }
    : { kind: "collection", slug: collection };
}

/** Each translated field's value in each language, by field name. */
async function translations(
  tx: TransactionContext,
  companion: CompanionSchema,
  id: string,
  languages: readonly string[]
): Promise<Map<string, Record<string, unknown>>> {
  const byColumn = await readCompanionValuesByLocale(
    container.get<DrizzleAdapter>("adapter"),
    tx,
    companion,
    id,
    languages
  );
  const byName = new Map<string, Record<string, unknown>>();
  for (const [language, values] of byColumn) {
    const named: Record<string, unknown> = {};
    for (const field of companion.localizedFields) {
      const value = values[field.column];
      // An untranslated field reads as null; the shared value stands then.
      if (value !== undefined && value !== null) named[field.name] = value;
    }
    byName.set(language, named);
  }
  return byName;
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
 * The document `write` leaves, in each of the site's languages: its values
 * there and whether it is published there. A delete leaves nothing.
 *
 * At most two reads, both on `tx`: the translations, and each language's
 * status where the type publishes per language. A Single's address names no
 * field, and is held in every language while the Single is published.
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
  const shared = write.data as Record<string, unknown>;
  const languages = addressLanguages();

  const companion =
    type.kind === "collection"
      ? await container
          .get<CollectionService>("collectionService")
          .companionSchemaOf(type.slug, executor)
      : null;
  const translated = companion
    ? await translations(tx, companion, write.id, languages)
    : undefined;
  const ownStatus =
    companion?.hasStatus === true
      ? await statuses(tx, companion, write.id)
      : undefined;

  for (const language of languages) {
    // Where each language is published on its own, one with no row of its
    // own was never published there.
    const status = ownStatus ? ownStatus.get(language) : shared.status;
    versions.set(language, {
      published: !lifecycle || status === "published",
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
