/**
 * The small pieces every node of a page's graph is written with: an
 * address made absolute on the site's origin, a node without its absent
 * keys, and a list of official accounts kept to whole addresses. Shared by
 * the page's graph and the site's People, so both write nodes one way.
 *
 * @module structured-data/node-parts
 */
import { originOf } from "../origin";

import type { StructuredDataNode } from "./graph";

/** A JSON value, as a node holds it. */
type Json = StructuredDataNode[string];

/** `address` as an absolute address on `origin`, where it is not already. */
export function absolute(address: string, origin: string): string | undefined {
  try {
    const url = new URL(address, `${origin}/`);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** `value` without its absent keys, as a node. */
export function node(
  value: Record<string, Json | undefined>
): StructuredDataNode {
  return Object.fromEntries(
    Object.entries(value).filter(([, inner]) => inner !== undefined)
  ) as StructuredDataNode;
}

/** Absolute addresses only: an official account is always one. */
export function linksOf(
  urls: readonly string[] | undefined
): string[] | undefined {
  const links = (urls ?? []).filter(url => originOf(url) !== undefined);
  return links.length > 0 ? links : undefined;
}
