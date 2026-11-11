/**
 * What a participant reads to bring its record up to date at start: every
 * document's held addresses, a page at a time, oldest first, and a
 * fingerprint of everything those addresses are made from.
 *
 * Read on the pool, outside any save: a participant catching up runs from its
 * plugin's start, never inside a write.
 *
 * @module domains/public-addresses/held-listing
 */
import { createHash } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { container } from "../../di";
import { whenServicesRegistered } from "../../di/service-access";
import { resolveLocalizedFieldNames } from "../i18n/classify-fields";
import { appLocalization } from "../i18n/configured-locales";
import { resolveLocaleChain } from "../i18n/resolve-locale";
import { PAGINATION_DEFAULTS } from "../../types/pagination";

import { addressLanguages, heldIn, readEveryLanguage } from "./held-addresses";
import type { HeldAddressUpdate } from "./participants";
import {
  declaredFor,
  siteTypes,
  startedNextly,
  type PublicAddressType,
} from "./public-address";

/**
 * The largest page {@link heldPage} hands back: one under the query's own
 * ceiling, so the extra row it reads to see whether another page follows is
 * never clamped away.
 */
const MAX_PAGE = PAGINATION_DEFAULTS.maxLimit - 1;
const DEFAULT_PAGE = 100;

/** The position after a page, as an opaque cursor. */
function cursorAt(offset: number): string {
  return Buffer.from(String(offset)).toString("base64url");
}

/** The position a cursor names; a cursor it never made reads as the start. */
function offsetOf(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const offset = Number(Buffer.from(cursor, "base64url").toString());
  return Number.isInteger(offset) && offset > 0 ? offset : 0;
}

function labelOf(document: Readonly<Record<string, unknown>>) {
  const title = document.title;
  return typeof title === "string" && title !== "" ? { label: title } : {};
}

/**
 * What `document` holds now, read as a save reads it (`readEveryLanguage`),
 * on a short transaction of its own.
 */
async function heldNow(
  type: PublicAddressType,
  collection: string,
  id: string,
  document: Record<string, unknown>
) {
  return container.get<DrizzleAdapter>("adapter").transaction(async tx =>
    heldIn(
      type,
      await readEveryLanguage(tx, {
        collection,
        id,
        data: document,
        operation: "update",
      }),
      tx
    )
  );
}

/**
 * A Single's one update: its fixed address in each language it is published
 * in, read as a save reads it, on a transaction of its own.
 */
async function singleHeld(
  type: PublicAddressType
): Promise<HeldAddressUpdate[]> {
  const nextly = await startedNextly();
  // Read only: a Single never saved has nothing to hold, and listing must
  // not create it.
  const single = (await nextly.findSingle({
    slug: type.slug,
    createIfMissing: false,
  } as never)) as Record<string, unknown> | null;
  if (single === null) return [];
  const id = String(single.id);
  const holds = await heldNow(type, `single:${type.slug}`, id, single);
  return [
    {
      holder: { collection: `single:${type.slug}`, id, ...labelOf(single) },
      holds,
    },
  ];
}

/**
 * One page of `type`'s documents, oldest first (by creation, then id), each
 * with every address it holds now, and the cursor of the next page where
 * there is one. One read for the page, and one per language for the versions
 * published in it.
 */
export async function heldPage(args: {
  type: PublicAddressType;
  after?: string;
  limit?: number;
}): Promise<{ items: HeldAddressUpdate[]; next?: string }> {
  // Started during the boot, not awaited, this waits for the boot to finish.
  await whenServicesRegistered();
  const { type } = args;
  const offset = offsetOf(args.after);
  if (type.kind === "single") {
    return { items: offset === 0 ? await singleHeld(type) : [] };
  }
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
  const nextly = await startedNextly();
  // One more than asked, to know whether another page follows.
  const page = await nextly.find({
    collection: type.slug,
    sort: ["createdAt", "id"],
    offset,
    limit: limit + 1,
    status: "all",
  } as never);
  const documents = (page.items as Record<string, unknown>[]).slice(0, limit);
  if (documents.length === 0) return { items: [] };

  // Each document read exactly as a save reads it, so a catch-up records
  // what the save path would, never what a read reaches through fallback.
  const items: HeldAddressUpdate[] = [];
  for (const document of documents) {
    const id = String(document.id);
    items.push({
      holder: { collection: type.slug, id, ...labelOf(document) },
      holds: await heldNow(type, type.slug, id, document),
    });
  }
  const more = page.items.length > limit;
  return more ? { items, next: cursorAt(offset + limit) } : { items };
}

/**
 * A digest of what every held address is made from: each site type's address
 * template in each language, the languages, and how each resolves an
 * untranslated field. It changes when a declaration, a template a plugin
 * supplies, the language list or the fallback settings change, and not
 * otherwise.
 */
export async function addressFingerprint(): Promise<string> {
  await whenServicesRegistered();
  const languages = addressLanguages();
  const localization = appLocalization();
  // How each language resolves an untranslated field changes what it holds,
  // so its chain counts as much as the templates do: the fallback switch,
  // each language's own fallbacks and the default all show in the chains.
  const parts: string[] = [
    `languages:${languages.join(",")}`,
    `default:${localization?.defaultLocale ?? ""}`,
    ...languages.map(
      language =>
        `chain:${language}:${(resolveLocaleChain(localization, language, undefined) ?? [language]).join(",")}`
    ),
  ];
  for (const { type, row } of await siteTypes()) {
    // Which fields are kept per language decides what an address field reads
    // in each language, so a field becoming translated changes the digest.
    const translated = resolveLocalizedFieldNames(
      (row.fields ?? []) as Parameters<typeof resolveLocalizedFieldNames>[0],
      row.localized === true
    );
    // Whether it has Draft/Published decides which documents hold at all.
    parts.push(
      `${type.kind}:${type.slug}|translated:${[...translated].sort().join(",")}`,
      `${type.kind}:${type.slug}|status:${row.status === true}`
    );
    for (const language of languages) {
      const declared = await declaredFor(type, language, row);
      parts.push(
        `${type.kind}:${type.slug}|${language}|${declared?.template ?? ""}|${declared?.pathFields.join(",") ?? ""}`
      );
    }
  }
  return createHash("sha256").update(parts.sort().join("\n")).digest("hex");
}
