/**
 * The address record's rows as every reader of them sees them: the claim key
 * an address, range or lock row is stored under, the paths above an address
 * whose ranges it falls within, and a row's shape once read back. Kept apart
 * from the participant and the store, so a reader of the record (the Proxy,
 * the redirect rules) shares these without depending on either.
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
  /** The key it is stored under, unique across the record. */
  claimKey: string;
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

/**
 * The slug of the collection an earlier version kept the record in, as this
 * site has it: the plugin's own, or the name the site renamed it to with the
 * plugin's `rename`. Read only by the move of its rows to the plugin's table.
 */
export function recordSlug(ctx: PluginContext): string {
  return ctx.self.collections[ADDRESS_RECORD_SLUG] ?? ADDRESS_RECORD_SLUG;
}

/**
 * The claim keys of the rows that hold `path` in `locale`: the address
 * itself, held exactly or as a range, and every range above it.
 */
export function keysHolding(locale: string, path: string): string[] {
  return [
    claimKey("address", locale, path),
    ...[path, ...pathsAbove(path)].map(at => claimKey("range", locale, at)),
  ];
}

/**
 * Whether `path` is the range `range` or below it, by whole path parts:
 * `/old/x` is below `/old`, `/older` is not. The one rule every reader of a
 * range asks: the record's claims, the redirects a pattern matches, and the
 * logged addresses a pattern answers.
 */
export function within(path: string, range: string): boolean {
  if (path === range) return true;
  return path.startsWith(range === "/" ? "/" : `${range}/`);
}
