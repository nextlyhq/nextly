/**
 * The registered blocks a blocks field accepts, with their props.
 *
 * Signed-in callers only: the route declares no permission and is not public,
 * so any signed-in user or key may read it and nobody else, as with the
 * schema reads it sits beside. It answers code-defined block metadata only.
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
  BLOCKS_LIST_ALLOW_PARAM,
  BLOCKS_LIST_ROUTE_PATH,
  type BlockListItem,
} from "./blocks-list-contract";
import { onePage } from "./loop-collections-route";
import { parseRouteQuery } from "./route-query";

/** What the listing reads: the running registry, unless a test hands its own. */
export interface BlocksListReads {
  blocks(): readonly AnyBlockDefinition[];
  sourceOf(name: string): string | undefined;
}

const REGISTRY_READS: BlocksListReads = {
  blocks: allBlocks,
  sourceOf: getBlockSource,
};

/** At most this many allow-list entries, each at most this long. */
const MAX_ENTRIES = 200;
const MAX_ENTRY_LENGTH = 200;

/** The entries of an allow-list, as a blocks field stores them. */
const ALLOW_LIST = z.array(z.string().max(MAX_ENTRY_LENGTH)).max(MAX_ENTRIES);

/**
 * The `allow` parameter: absent for "any block", else the field's allow-list
 * as a JSON array, read exactly as sent: no entry split, trimmed or dropped,
 * so the listing judges the very policy a save judges. Bounded, since it is
 * outside input; anything but an array of strings is refused.
 */
const QUERY_SCHEMA = z.object({
  [BLOCKS_LIST_ALLOW_PARAM]: z
    .string()
    .max(MAX_ENTRIES * (MAX_ENTRY_LENGTH + 4) + 2)
    .transform((value, ctx): unknown => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "not a JSON array" });
        return z.NEVER;
      }
    })
    .pipe(ALLOW_LIST)
    .optional(),
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
  method: "GET";
  path: string;
  handler: (req: Request) => Response;
} {
  return {
    method: "GET",
    path: BLOCKS_LIST_ROUTE_PATH,
    handler: req => {
      const query = parseRouteQuery(
        req.url,
        [BLOCKS_LIST_ALLOW_PARAM],
        QUERY_SCHEMA,
        "block listing"
      );
      const items = listAcceptedBlocks(query[BLOCKS_LIST_ALLOW_PARAM], reads);
      return respondList(items, onePage(items.length));
    },
  };
}
