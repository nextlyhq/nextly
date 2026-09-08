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
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import type { BlockRenderArgs, PageContext } from "@nextlyhq/blocks-react";
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
  render(args: BlockRenderArgs<never>): unknown;
}

/**
 * The class this harness passes in and looks for.
 *
 * A marker of its own rather than the block's real type class, which also
 * appears in a compiled stylesheet — so looking for that would be satisfied by
 * CSS for a node that emitted no element. Nothing else can put this string in
 * the markup.
 */
const MARKER = "nx-kitchen-sink-marker";

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

  it.each(NODES.map(node => [`${node.type}#${node.id}`, node] as const))(
    "%s renders its own element from the props THIS fixture gives it",
    async (_label, node) => {
      /*
       * The check the key comparison above cannot make, and the one that
       * matters most on a page whose purpose is to be looked at.
       *
       * A declared prop can be present, correctly named, and still wrong — `src`
       * deleted from the embed, or written as `42` — and every other case here
       * stays green: `validateDocument` accepts the props object, no key is
       * undeclared, and `every-block-renders` exercises the block's own
       * `example` rather than this document. The node then renders nothing and
       * the page has an invisible hole.
       *
       * So each node is rendered with ITS OWN stored props. `render` is awaited
       * because `core/image`, `core/button` and `core/collection-loop` are async
       * — driven through `PageRenderer` and `renderToStaticMarkup` all three emit
       * an empty body, which would make this pass by rendering nothing.
       *
       * Containers are given an empty slot: a container that draws its own box
       * is what is being asserted, not the children it would hold.
       */
      const definition = BY_NAME.get(node.type);
      expect(
        definition,
        `${node.type} is not a registered block`
      ).toBeDefined();

      const context: PageContext = {
        entry: null,
        data: { find: () => Promise.resolve({ items: [], total: 0 }) },
        resolveMedia: () => Promise.resolve(null),
        resolveEntryPath: () => Promise.resolve(null),
      };
      const element = await (definition as Definition).render({
        props: node.props,
        node,
        className: MARKER,
        partClass: () => "",
        ctx: context,
        renderSlot: () => null,
      } as unknown as BlockRenderArgs<never>);

      const markup =
        element === null || element === undefined
          ? ""
          : renderToStaticMarkup(element as never);

      expect(
        markup,
        `${node.type}#${node.id} rendered nothing from its own props, so this ` +
          `page has a hole where that block should be`
      ).toContain(MARKER);
    }
  );

  it("repeats the loop's template ONCE PER ENTRY, not once", async () => {
    /*
     * The per-node case above renders every block against a reader that answers
     * with nothing, so `core/collection-loop` proves only that its empty outer
     * container exists. Breaking per-item iteration leaves it green while the
     * page shows no repeated content at all — which is the state this page was
     * in before the route was given a provider.
     *
     * So this one answers with entries and looks for repetition. The child is a
     * marker rather than the fixture's own text: counting a string the document
     * also contains elsewhere would be satisfied by the page rather than by the
     * loop.
     */
    const loop = NODES.find(node => node.type === "core/collection-loop");
    expect(
      loop,
      "the fixture no longer contains a loop to exercise"
    ).toBeDefined();

    const definition = BY_NAME.get("core/collection-loop");
    const entries = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const ITEM = "nx-loop-item-marker";

    const element = await (definition as Definition).render({
      props: (loop as BlockNode).props,
      node: loop,
      className: MARKER,
      partClass: () => "",
      ctx: {
        entry: null,
        data: { find: () => Promise.resolve({ items: entries, total: 3 }) },
        resolveMedia: () => Promise.resolve(null),
        resolveEntryPath: () => Promise.resolve(null),
      },
      renderSlot: () => ITEM,
    } as unknown as BlockRenderArgs<never>);

    const markup =
      element === null || element === undefined
        ? ""
        : renderToStaticMarkup(element as never);

    expect(
      markup.split(ITEM).length - 1,
      `the loop drew its template ${String(markup.split(ITEM).length - 1)} times ` +
        `for ${String(entries.length)} entries`
    ).toBe(entries.length);
  });

  it("stores no slot name its block does not declare", () => {
    /*
     * A slot key nothing declares is invisible to every other check here.
     * `validateDocument` asks only whether a slot value is an array, and
     * `canNestInSlot` reads the `undefined` returned for an unknown slot as no
     * restriction — so `children` misspelled `childen` validates cleanly.
     *
     * `PageRenderer` asks for the DECLARED slot, so that subtree is silently
     * dropped from the page while this file's walk still counts every type in it
     * toward completeness. The page would then be missing blocks that the
     * completeness case reports as present.
     */
    const undeclared = NODES.flatMap(node => {
      const declared = BY_NAME.get(node.type)?.slots ?? {};
      return Object.keys(node.slots ?? {})
        .filter(slot => !Object.hasOwn(declared, slot))
        .map(slot => `${node.type}#${node.id} stores slot "${slot}"`);
    });

    expect(undeclared).toEqual([]);
  });

  it("carries NO authored styles, which is the page's whole premise", () => {
    /*
     * The invariant the fixture is built on, asserted rather than described. A
     * block library is judged by what an author gets before styling anything, so
     * a node given a `styles` object turns this page from a view of the defaults
     * into a hand-styled result — hiding exactly the class of defect it exists to
     * show, while every other check here stays green because authored styles are
     * perfectly valid.
     */
    const styled = NODES.filter(
      node => (node as { styles?: unknown }).styles !== undefined
    ).map(node => `${node.type}#${node.id}`);

    expect(
      styled,
      `${styled.join(", ")} carry authored styles, so this page no longer shows ` +
        `what a block does on its own`
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
