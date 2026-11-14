/**
 * The registered blocks a blocks field accepts, with their props.
 *
 * Signed-in callers only: the route declares no permission and is not public,
 * so any signed-in user or key may read it and nobody else, as with the
 * schema reads it sits beside. It answers code-defined block metadata only.
 *
 * A POST that changes nothing: the allow-list it is asked about travels in
 * the body because it need not fit in a URL. A field may name any number of
 * entries, each of any length, and the listing takes whatever the field may
 * declare, bounded only by the app's own request-body limit.
 *
 * Which blocks a field accepts is decided by the engine's one reading of an
 * allow-list (`slotAdmits`), the same one the field's validator refuses a save
 * by, so the listing cannot offer a block a save would refuse, or hide one it
 * would keep.
 *
 * @module blocks-list-route
 */
import {
  allBlocks,
  blockLabelFrom,
  getBlockSource,
  slotAdmits,
  type AnyBlockDefinition,
} from "@nextlyhq/blocks-engine";
import { propLabel } from "@nextlyhq/builder/ops";
import { respondList } from "nextly";
import { z } from "nextly/zod";

import {
  BLOCKS_LIST_ROUTE_PATH,
  type BlockListItem,
  type BlocksListRequest,
} from "./blocks-list-contract";
import { readBodyWith } from "./composition-route-kit";
import { onePage } from "./loop-collections-route";

/** What the listing reads: the running registry, unless a test hands its own. */
export interface BlocksListReads {
  blocks(): readonly AnyBlockDefinition[];
  sourceOf(name: string): string | undefined;
}

const REGISTRY_READS: BlocksListReads = {
  blocks: allBlocks,
  sourceOf: getBlockSource,
};

/**
 * The body: the field's allow-list exactly as stored, or `null` for a field
 * naming none. Read as sent, no entry split, trimmed or dropped, so the
 * listing judges the very policy a save judges, and no cap of its own, so it
 * takes every list the field accepts.
 */
const REQUEST_SCHEMA = z.object({
  allow: z.array(z.string()).nullable(),
});

/**
 * The blocks `allow` admits, each with the entries that admit it and its
 * props; every registered block when `allow` is undefined. Sorted by name, so
 * the answer does not depend on registration order.
 */
export function listAcceptedBlocks(
  allow: readonly string[] | undefined,
  reads: BlocksListReads = REGISTRY_READS
): BlockListItem[] {
  return reads
    .blocks()
    .filter(block => allow === undefined || slotAdmits(allow, block.name))
    .map(block => ({
      name: block.name,
      label: blockLabelFrom(block.name, block),
      description: block.description,
      source: reads.sourceOf(block.name) ?? null,
      // Each entry asked alone, by the same matcher, so the entries named are
      // exactly the ones that admit it.
      matchedBy:
        allow === undefined
          ? []
          : allow.filter(entry => slotAdmits([entry], block.name)),
      props: Object.entries(block.props ?? {}).flatMap(([name, schema]) =>
        schema === undefined
          ? []
          : [
              {
                name,
                label: propLabel(name, schema),
                type: schema.type,
              },
            ]
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The route the plugin contributes. */
export function blocksListRoute(reads: BlocksListReads = REGISTRY_READS): {
  method: "POST";
  siteWide: false;
  path: string;
  handler: (req: Request) => Promise<Response>;
} {
  return {
    method: "POST",
    path: BLOCKS_LIST_ROUTE_PATH,
    siteWide: false, // Acts on no site content; signing in is enough.
    handler: async req => {
      // Typed as the contract, so the schema cannot drift from what the
      // listing is documented to be asked.
      const { allow }: BlocksListRequest = await readBodyWith(
        req,
        REQUEST_SCHEMA,
        "block listing"
      );
      const items = listAcceptedBlocks(allow ?? undefined, reads);
      return respondList(items, onePage(items.length));
    },
  };
}
