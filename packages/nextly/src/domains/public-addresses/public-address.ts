/**
 * Where an entry is served, as the site declares it: one answer for every
 * reader that needs a page's public address (a canonical link, a sitemap
 * entry, a redirect).
 *
 * A type declared in code states its address in its configuration
 * (`publicAddress`), and only there: no plugin is asked about it. A type made
 * in the Schema Builder has none of its own, so a plugin supplies it through
 * the `publicAddress.template` seam (the SEO plugin, from its settings),
 * judged by the same rule a declared one is. A type with neither is not
 * public yet, and is answered as having no address, never a guessed one.
 *
 * @module domains/public-addresses/public-address
 * @experimental
 */
import { container } from "../../di";
import type { NextlyServiceConfig } from "../../di/register";
import { NextlyError } from "../../errors/nextly-error";
import { getFilterRegistry } from "../../filters";
import { FilterSeams } from "../../filters/seams";
import type { Nextly } from "../../init/nextly-instance";
import type { CollectionRegistryService } from "../collections/services/collection-registry-service";
import type { SingleRegistryService } from "../singles/services/single-registry-service";

import {
  addressableFieldNames,
  fillPublicAddress,
  publicAddressProblem,
  type PublicAddressKind,
} from "./public-address-template";

/**
 * The running Nextly, started first if it is not yet. The boot entry is
 * loaded here, at the call, so the plugin context that imports this module
 * does not load the whole boot with it.
 */
export async function startedNextly(): Promise<Nextly> {
  const { getCachedNextly } = await import("../../init");
  return getCachedNextly();
}

/** @experimental A content type, by kind and slug. */
export interface PublicAddressType {
  kind: PublicAddressKind;
  slug: string;
}

/**
 * @experimental An entry's public address: the path it is served at, none
 * where its type is not public, or unavailable where the type is public but
 * this entry has no value yet to fill its address with.
 */
export type PublicAddress =
  | { status: "resolved"; path: string }
  | { status: "none" }
  | { status: "unavailable" };

/** A type's address template, and how its values are filled in. */
export interface Declared {
  template: string;
  pathFields: readonly string[];
}

/** A type as the configuration or the registry holds it. */
export interface TypeRecord {
  fields?: readonly unknown[];
  publicAddress?: string;
  db?: { slugPaths?: boolean };
  source?: string;
  /** Whether it has Draft/Published. */
  status?: boolean;
  /** Whether it is translated. */
  localized?: boolean;
}

/** The type `type` names in the configuration, where it is declared in code. */
function configured(type: PublicAddressType): TypeRecord | undefined {
  const config = container.get<NextlyServiceConfig>("config");
  const list =
    type.kind === "collection" ? config?.collections : config?.singles;
  return (list as readonly ({ slug: string } & TypeRecord)[] | undefined)?.find(
    entity => entity.slug === type.slug
  );
}

/**
 * The registry's row for `type`, for a type made in the Schema Builder, read
 * on `executor` where a caller inside a transaction passes one, so the read
 * takes no second connection and sees the transaction's own writes.
 */
async function registered(
  type: PublicAddressType,
  executor?: unknown
): Promise<TypeRecord | undefined> {
  if (type.kind === "collection") {
    const registry = container.get<CollectionRegistryService>(
      "collectionRegistryService"
    );
    return (
      (await registry.getCollectionBySlug(type.slug, executor)) ?? undefined
    );
  }
  const registry = container.get<SingleRegistryService>(
    "singleRegistryService"
  );
  return (await registry.getSingleBySlug(type.slug, executor)) ?? undefined;
}

/**
 * `type` as the configuration declares it, or else as the registry holds it,
 * read on `executor`; undefined where neither does.
 */
export async function typeRecordOn(
  type: PublicAddressType,
  executor?: unknown
): Promise<TypeRecord | undefined> {
  return configured(type) ?? (await registered(type, executor));
}

/**
 * The address a plugin supplies for a type made in the Schema Builder, or
 * undefined where none does, its handler fails, or what it answers breaks the
 * rule a declared address is judged by: never a guess.
 */
async function supplied(
  type: PublicAddressType,
  record: TypeRecord,
  locale: string | undefined
): Promise<string | undefined> {
  // A throwing handler is skipped by the registry, keeping the value before it.
  const answer = await getFilterRegistry().applyFilters<
    string | undefined,
    { kind: PublicAddressKind; slug: string; locale?: string }
  >(FilterSeams.PublicAddressTemplate, undefined, {
    kind: type.kind,
    slug: type.slug,
    ...(locale === undefined ? {} : { locale }),
  });
  if (answer === undefined) return undefined;
  const problem = publicAddressProblem(answer, {
    kind: type.kind,
    fieldNames: addressableFieldNames(record.fields ?? []),
  });
  return problem === null ? answer : undefined;
}

/**
 * What `type` declares: from its configuration where it is declared in code,
 * from a plugin where it was made in the Schema Builder, and nothing for a
 * plugin's own or a system type, which are never pages of the site.
 *
 * `row` is the type's registry row where the caller has read it already, so
 * a list of types costs no lookup per type; without it, the row is read, on
 * `executor` when one is given.
 *
 * @throws NextlyError `NOT_FOUND` when no such type exists
 */
export async function declaredFor(
  type: PublicAddressType,
  locale?: string,
  row?: TypeRecord,
  executor?: unknown
): Promise<Declared | undefined> {
  // No wait for the boot here: a save made during the boot (a plugin's
  // `onReady` writing an entry) reaches this through the address phase, and
  // waiting for the boot it is part of would never finish. The public entry
  // points wait instead.
  const code = configured(type);
  if (code !== undefined) {
    if (code.publicAddress === undefined) return undefined;
    return {
      template: code.publicAddress,
      pathFields: code.db?.slugPaths === true ? ["slug"] : [],
    };
  }
  const record = row ?? (await registered(type, executor));
  if (record === undefined) {
    throw NextlyError.notFound({
      logContext: { reason: "no such content type", ...type },
    });
  }
  if (record.source !== "ui") return undefined;
  const template = await supplied(type, record, locale);
  return template === undefined ? undefined : { template, pathFields: [] };
}

/**
 * @experimental The public address of `entry`, an entry of `type`, in
 * `locale`. A Single is one page, so it needs no entry.
 *
 * @throws NextlyError `NOT_FOUND` when `type` names no content type
 */
export async function publicAddressOf(
  type: PublicAddressType,
  entry?: Readonly<Record<string, unknown>>,
  locale?: string
): Promise<PublicAddress> {
  await startedNextly();
  return addressFrom(type, await declaredFor(type, locale), entry);
}

/**
 * The address `declared` gives `entry`, an entry of `type`: what
 * {@link publicAddressOf} answers once it knows the declaration, for a
 * caller that read the declaration itself (on a transaction).
 */
export function addressFrom(
  type: PublicAddressType,
  declared: Declared | undefined,
  entry?: Readonly<Record<string, unknown>>
): PublicAddress {
  if (declared === undefined) return { status: "none" };
  if (type.kind === "single") {
    return { status: "resolved", path: declared.template };
  }
  if (entry === undefined) return { status: "unavailable" };
  const path = fillPublicAddress(declared.template, entry, {
    pathFields: declared.pathFields,
  });
  return path === null
    ? { status: "unavailable" }
    : { status: "resolved", path };
}

/**
 * @experimental The site's content types with no public address yet: those
 * declared in code with none, and those made in the Schema Builder that no
 * plugin supplies one for. A plugin's own types and the system's are never
 * listed, since they are not pages of the site.
 */
export async function typesWithoutAddress(): Promise<PublicAddressType[]> {
  const without: PublicAddressType[] = [];
  for (const { type, row } of await siteTypes()) {
    if ((await declaredFor(type, undefined, row)) === undefined) {
      without.push(type);
    }
  }
  return without;
}

/**
 * The site's own content types with their registry rows: those declared in
 * code and those made in the Schema Builder, never a plugin's own or the
 * system's. One list for every reader that walks the site's types.
 */
export async function siteTypes(): Promise<
  { type: PublicAddressType; row: TypeRecord }[]
> {
  await startedNextly();
  const collections = container.get<CollectionRegistryService>(
    "collectionRegistryService"
  );
  const singles = container.get<SingleRegistryService>("singleRegistryService");
  const rows: { type: PublicAddressType; row: TypeRecord }[] = [
    ...(await collections.getAllCollections()).map(row => ({
      type: { kind: "collection" as const, slug: row.slug },
      row: row as TypeRecord,
    })),
    ...(await singles.getAllSingles()).map(row => ({
      type: { kind: "single" as const, slug: row.slug },
      row: row as TypeRecord,
    })),
  ];
  return rows.filter(({ row }) => row.source === "code" || row.source === "ui");
}
