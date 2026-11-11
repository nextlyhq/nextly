/**
 * The address record's rows as every reader of them sees them: the claim key
 * an address, range or lock row is stored under, the paths above an address
 * whose ranges it falls within, and a stored row read back. Kept apart from
 * the participant, so a reader of the record (the Proxy, the redirect rules)
 * shares these without depending on the participant itself.
 *
 * @module address-record/rows
 */
import { createHash } from "node:crypto";

import type {
  AddressHolder,
  HeldAddress,
  PluginContext,
} from "@nextlyhq/plugin-sdk";

import { ADDRESS_RECORD_SLUG } from "./collection";

/** What a row of the record is. */
export type RowKind = "address" | "range" | "lock";

/** A row of the record, read back. */
export interface RecordRow {
  id: string;
  kind: RowKind;
  address: HeldAddress | null;
  holder: AddressHolder | null;
}

/** The SHA-256 of `text`, the same on every dialect. */
export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The stored claim key of an address, range or path lock row. */
export function claimKey(kind: RowKind, locale: string, path: string): string {
  return sha256(`${kind}:${locale}|${path}`);
}

/** Every path above `path`, root first, the root itself included. */
export function pathsAbove(path: string): string[] {
  if (path === "/") return [];
  const segments = path.split("/").filter(segment => segment !== "");
  const above = ["/"];
  for (let at = 1; at < segments.length; at++) {
    above.push(`/${segments.slice(0, at).join("/")}`);
  }
  return above;
}

/** A stored row read back, every column checked rather than trusted. */
export function rowOf(entry: unknown): RecordRow {
  const row = entry as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const locale = text(row.locale);
  const path = text(row.path);
  const kind: RowKind =
    row.kind === "address" || row.kind === "range" ? row.kind : "lock";
  const collection = text(row.holderCollection);
  const id = text(row.holderId);
  const label = text(row.holderLabel);
  return {
    id: String(row.id),
    kind,
    address:
      locale === null || path === null
        ? null
        : { locale, path, ...(kind === "range" ? { range: true } : {}) },
    holder:
      collection === null || id === null
        ? null
        : { collection, id, ...(label ? { label } : {}) },
  };
}

/**
 * The record's slug as this site has it: the plugin's own, or the name the
 * site renamed it to with the plugin's `rename`.
 */
export function recordSlug(ctx: PluginContext): string {
  return ctx.self.collections[ADDRESS_RECORD_SLUG] ?? ADDRESS_RECORD_SLUG;
}
