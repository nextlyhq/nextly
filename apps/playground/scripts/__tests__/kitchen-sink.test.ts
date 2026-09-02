/**
 * The kitchen-sink document is one the engine would accept, and shows every block.
 *
 * `BlockDocument` checks the shape of a node and not its meaning: `type` is
 * `string` and `props` is `Record<string, unknown>`, so a misspelled block name
 * and a prop no block declares both compile cleanly. They then render a
 * placeholder or nothing, on a page whose whole purpose is to be looked at —
 * where a hole reads as a defect in the block library rather than in the page.
 *
 * ## Asked of the engine, not restated here
 *
 * Unknown types, both halves of the nesting rule, ids, depth and structure all
 * go to `validateDocument` with the real registry and the real declarations.
 * That matters beyond saving code: a hand-written slot check using exact
 * `includes` rejects the two forms the canonical predicate supports — an empty
 * allow-list, which means unrestricted, and a namespace entry like `core/*` —
 * so it would fail a placement the renderer and the validator both accept.
 *
 * ## What the engine does not answer
 *
 * `invalid-props` reports only that `props` is not an object; nothing compares a
 * prop NAME against the block that declares it. So `src` written as `scr` passes
 * validation and renders nothing, and that check lives here.
 */
import { describe, expect, it } from "vitest";

import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import type { BlockNode, NestingSource } from "@nextlyhq/blocks-engine";
import { validateDocument } from "@nextlyhq/blocks-engine";

import {
  KITCHEN_SINK_DOCUMENT,
  KITCHEN_SINK_TITLE,
} from "../../seed/kitchen-sink";

interface Definition {
  name: string;
  version: number;
  parent?: readonly string[];
  props?: Record<string, unknown>;
  slots?: Record<string, { allow?: readonly string[] } | undefined>;
}

const DEFINITIONS = coreBlocks as unknown as Definition[];
const BY_NAME = new Map(DEFINITIONS.map(block => [block.name, block]));

/**
 * The declarations the engine's predicates read, supplied rather than restated.
 *
 * This is the same shape `tree.ts` builds internally for seed expansion, so a
 * placement here is judged by exactly the rule that judges an author's drag.
 * The RULE stays in the engine; only the lookup lives here, because the engine
 * keeps its own builder private.
 */
const NESTING: NestingSource = {
  parentsOf: type => BY_NAME.get(type)?.parent,
  slotAllowOf: (parentType, slot) =>
    (BY_NAME.get(parentType)?.slots?.[slot] as { allow?: readonly string[] })
      ?.allow,
};

const BREAKPOINTS = {
  viewport: [{ id: "base", label: "Base" }],
  container: [],
};

/** Every node in the document, flattened. */
function walk(nodes: readonly BlockNode[]): BlockNode[] {
  return nodes.flatMap(node => [
    node,
    ...Object.values(node.slots ?? {}).flatMap(children =>
      walk((children ?? []) as BlockNode[])
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

  it("is a document the ENGINE accepts, in strict mode", () => {
    /*
     * Unknown types, nesting from both sides, duplicate ids, depth and
     * structure, all from the implementation that judges a real document —
     * rather than a second set of rules maintained here that would agree today
     * and drift.
     */
    const result = validateDocument(KITCHEN_SINK_DOCUMENT, {
      mode: "strict",
      breakpoints: BREAKPOINTS,
      registry: { has: type => BY_NAME.has(type) },
      nesting: NESTING,
    });
    const errors = result.issues
      .filter(issue => issue.severity === "error")
      .map(issue => `${issue.path}: ${issue.code} — ${issue.message}`);

    expect(errors).toEqual([]);
  });

  it("REPORTS a document the engine would refuse", () => {
    /*
     * The positive control for the case above, which passes by finding nothing
     * and would go on passing if the registry, the nesting source or the mode
     * stopped reaching the validator.
     *
     * A column at the page root violates the child half of the nesting rule:
     * `core/column` names `core/columns` as its only parent.
     */
    const result = validateDocument(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [{ id: "loose", type: "core/column", version: 1, props: {} }],
      },
      {
        mode: "strict",
        breakpoints: BREAKPOINTS,
        registry: { has: type => BY_NAME.has(type) },
        nesting: NESTING,
      }
    );

    expect(
      result.issues.filter(issue => issue.severity === "error")
    ).not.toEqual([]);
  });

  it("carries every block the library defines", () => {
    /*
     * The completeness half, and the one the engine cannot answer: a document
     * showing three blocks is perfectly valid, and this page is only useful if
     * it shows all of them. A block added to `coreBlocks` is missing from the
     * page until it is added here, and nothing else would say so.
     */
    const present = new Set(NODES.map(node => node.type));
    const missing = DEFINITIONS.map(block => block.name).filter(
      name => !present.has(name)
    );

    expect(
      missing,
      `${missing.join(", ")} are registered blocks the page does not show, so ` +
        `the library cannot be reviewed from it`
    ).toEqual([]);
  });

  it("writes only props the block declares", () => {
    /*
     * The other question the engine leaves open. `invalid-props` reports that
     * `props` is not an object and never compares a NAME against the block, so
     * `src` written as `scr` validates cleanly and renders nothing.
     *
     * Names only, deliberately: the declared `type` of a prop — `url`, `select`,
     * `array` — is a grammar the engine owns, and re-deciding here what
     * satisfies each would be the second implementation this file avoids
     * elsewhere. A misspelling is what silently empties a node, and it is a
     * name.
     */
    const undeclared = NODES.flatMap(node => {
      const declared = BY_NAME.get(node.type)?.props;
      if (declared === undefined) return [];
      return Object.keys(node.props).filter(
        prop => !Object.hasOwn(declared, prop)
      );
    });

    expect(
      [...new Set(undeclared)],
      `the page writes props no block declares, which are dropped on read`
    ).toEqual([]);
  });

  it("stamps each node with the version its block declares", () => {
    // A node written against a version the block does not have is migrated on
    // read, silently changing what this page renders.
    const wrong = NODES.filter(
      node => BY_NAME.get(node.type)?.version !== node.version
    ).map(node => `${node.type}#${node.id}`);

    expect(wrong).toEqual([]);
  });

  it("titles the page once", () => {
    // The route derives metadata from the first heading in preference to the
    // stored title, so two spellings disagree across the admin, the browser tab
    // and the document with nothing reporting it.
    const firstHeading = NODES.find(node => node.type === "core/heading");

    expect(firstHeading?.props.text).toBe(KITCHEN_SINK_TITLE);
  });
});
