/**
 * The address record's tables as the integration tests read and empty them,
 * through the SEO plugin's own `ctx.db`: what each holder holds, the notes
 * beside it, and the record emptied as on a site the plugin was just added
 * to.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { eq, inArray } from "@nextlyhq/plugin-sdk/db";

import { keptSeoContext } from "../../not-found/report";
import { addressClaims, addressNotes } from "../../schema/tables";
import { noteKey } from "../store";

/** The SEO plugin's context, once a boot has started it. */
export function seoContext(): PluginContext {
  const seo = keptSeoContext();
  if (seo === undefined) throw new Error("the SEO plugin never started");
  return seo;
}

/** Every row of the record, lock rows included. */
export async function claimRows(
  seo: PluginContext = seoContext()
): Promise<Record<string, unknown>[]> {
  return (await seo.db.select(addressClaims).all()) as unknown as Record<
    string,
    unknown
  >[];
}

/** The record's address and range rows, as `locale|path` → `collection:id`. */
export async function recordedRows(
  seo: PluginContext = seoContext()
): Promise<Record<string, string>> {
  return Object.fromEntries(
    (await claimRows(seo))
      .filter(row => row.kind === "address" || row.kind === "range")
      .map(row => [
        `${String(row.locale)}|${String(row.path)}`,
        `${String(row.holderCollection)}:${String(row.holderId)}`,
      ])
  );
}

/** Every note beside the record. */
export async function noteRows(
  seo: PluginContext = seoContext()
): Promise<Record<string, unknown>[]> {
  return (await seo.db.select(addressNotes).all()) as unknown as Record<
    string,
    unknown
  >[];
}

/**
 * Empty the record and its notes, as on a site the plugin has just been
 * added to, or one whose tables a full uninstall dropped. The notes that
 * an earlier record has moved, and of what it held then, are kept: there is
 * none to move, and nothing written there since to take in.
 */
export async function forgetRecord(
  seo: PluginContext = seoContext()
): Promise<void> {
  await seo.db
    .delete(addressClaims)
    .where(
      inArray(seo.db.table(addressClaims).kind, ["address", "range", "lock"])
    );
  const kept = new Set([noteKey("record-moved"), noteKey("record-drained")]);
  for (const row of await noteRows(seo)) {
    if (!kept.has(String(row.noteKey))) {
      await forgetNoteKey(seo, String(row.noteKey));
    }
  }
}

/** Forget the note `name`, as though it was never noted. */
export async function forgetNote(
  name: string,
  seo: PluginContext = seoContext()
): Promise<void> {
  await forgetNoteKey(seo, noteKey(name));
}

async function forgetNoteKey(seo: PluginContext, key: string): Promise<void> {
  await seo.db
    .delete(addressNotes)
    .where(eq(seo.db.table(addressNotes).noteKey, key));
}
