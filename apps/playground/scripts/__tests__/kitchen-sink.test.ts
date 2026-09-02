/**
 * The kitchen-sink document names real blocks, all of them, arranged legally.
 *
 * `BlockDocument` checks the shape of a node and not its meaning: `type` is
 * `string` and `props` is `Record<string, unknown>`, so a misspelled block name
 * and a prop no block declares both compile cleanly. They then render a
 * placeholder or nothing, on a page whose whole purpose is to be looked at — the
 * one failure mode a fixture like this cannot afford, because a hole in it reads
 * as a defect in the block library.
 *
 * These are the checks the type cannot make.
 */
import { describe, expect, it } from "vitest";

import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import type { BlockNode } from "@nextlyhq/blocks-engine";

import {
  KITCHEN_SINK_DOCUMENT,
  KITCHEN_SINK_TITLE,
} from "../../seed/kitchen-sink";

interface Definition {
  name: string;
  version: number;
  parent?: readonly string[];
  slots?: Record<string, { allow?: readonly string[] } | undefined>;
}

const DEFINITIONS = coreBlocks as unknown as Definition[];
const BY_NAME = new Map(DEFINITIONS.map(block => [block.name, block]));

/** Every node in the document, with the node that holds it. */
function walk(
  nodes: readonly BlockNode[],
  parent: BlockNode | undefined = undefined
): { node: BlockNode; parent: BlockNode | undefined }[] {
  return nodes.flatMap(node => [
    { node, parent },
    ...Object.values(node.slots ?? {}).flatMap(children =>
      walk((children ?? []) as BlockNode[], node)
    ),
  ]);
}

const NODES = walk(KITCHEN_SINK_DOCUMENT.nodes as BlockNode[]);

describe("the kitchen-sink document", () => {
  it("was actually walked", () => {
    /*
     * The control. Every case below reports by finding nothing, so a walk that
     * returned an empty list — a renamed `slots` field, a changed document
     * shape — would leave the whole file green having inspected no node.
     */
    expect(NODES.length).toBeGreaterThan(20);
    expect(DEFINITIONS.length).toBeGreaterThan(15);
  });

  it("names only blocks the library defines", () => {
    /*
     * The check `BlockDocument` cannot make. A misspelled type is a string like
     * any other, and the renderer answers it with a placeholder rather than an
     * error.
     */
    const unknown = NODES.map(({ node }) => node.type).filter(
      type => !BY_NAME.has(type)
    );

    expect(
      [...new Set(unknown)],
      `the document names blocks the library does not define, which render as ` +
        `placeholders`
    ).toEqual([]);
  });

  it("carries every block the library defines", () => {
    /*
     * The completeness half, and the reason this file exists rather than a note
     * asking someone to remember. A block added to `coreBlocks` is missing from
     * the page until it is added here, and nothing else would say so.
     */
    const present = new Set(NODES.map(({ node }) => node.type));
    const missing = DEFINITIONS.map(block => block.name).filter(
      name => !present.has(name)
    );

    expect(
      missing,
      `${missing.join(", ")} are registered blocks the page does not show, so ` +
        `the library cannot be reviewed from it`
    ).toEqual([]);
  });

  it("stamps each node with the version its block declares", () => {
    // A node written against a version the block does not have is migrated on
    // read, silently changing what this page renders.
    const wrong = NODES.filter(
      ({ node }) => BY_NAME.get(node.type)?.version !== node.version
    ).map(({ node }) => `${node.type}#${node.id}`);

    expect(wrong).toEqual([]);
  });

  it("gives every node an id of its own", () => {
    // The engine refuses a document with a repeated id, so a duplicate here
    // fails at seed time rather than on the page.
    const ids = NODES.map(({ node }) => node.id);
    const seen = new Set<string>();
    const repeated = ids.filter(id =>
      seen.has(id) ? true : (seen.add(id), false)
    );

    expect(repeated).toEqual([]);
  });

  it("respects the nesting rule from BOTH sides", () => {
    /*
     * Two halves, and the engine states them separately because neither implies
     * the other: a block may name the parents it is allowed in, and a slot may
     * name the children it admits.
     */
    const misplaced = NODES.flatMap(({ node, parent }) => {
      const definition = BY_NAME.get(node.type);
      if (definition === undefined) return [];
      const problems: string[] = [];

      // The CHILD half: `core/column` outside `core/columns` is a node the
      // editor refuses and the renderer has no arrangement for.
      const parents = definition.parent;
      if (parents !== undefined && parents.length > 0) {
        if (parent === undefined || !parents.includes(parent.type)) {
          problems.push(
            `${node.type} must sit inside ${parents.join(" or ")}, not ${parent?.type ?? "the page root"}`
          );
        }
      }

      // The PARENT half: a gallery admits images only, and a block it refuses
      // renders outside the arrangement the slot exists to create.
      const allow = parent && BY_NAME.get(parent.type)?.slots?.children?.allow;
      if (allow !== undefined && !allow.includes(node.type)) {
        problems.push(
          `${parent?.type ?? "?"} admits ${allow.join(" or ")}, not ${node.type}`
        );
      }
      return problems;
    });

    expect(misplaced).toEqual([]);
  });

  it("titles the page once", () => {
    // The route derives metadata from the first heading in preference to the
    // stored title, so two spellings disagree across the admin, the browser tab
    // and the document with nothing reporting it.
    const firstHeading = NODES.map(({ node }) => node).find(
      node => node.type === "core/heading"
    );

    expect(firstHeading?.props.text).toBe(KITCHEN_SINK_TITLE);
  });
});
