/**
 * The address a language layer gives a placement's value.
 *
 * A placement keeps its values raw, keyed by exposure id, and a later language
 * layer stores a translation per node and prop path (`LocaleOverlay`). So a
 * translated value of a placed component is addressed as the placement's node
 * plus `overrides.<id>`: never a node inside the component, which every page
 * placing it shares, and never the component's own prop. What is pinned here
 * is that this address is the one the editor can derive from what it draws,
 * that it holds the stored value, and that a value written there is the one
 * the page shows, with the component and its other placements untouched.
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type LocaleOverlay,
} from "./document";
import {
  resolveComponentInstances,
  type ResolvedBlockNode,
} from "./resolve-instances";

const HEADER: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "title",
      type: "core/text",
      version: 1,
      props: { text: "Site name" },
    },
  ],
  exposed: [
    {
      id: "headline",
      label: "Headline",
      nodeId: "title",
      propPath: "text",
      type: "text",
    },
  ],
};

const placement = (
  id: string,
  overrides: Record<string, unknown>
): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId: "header", overrides },
});

const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    placement("p1", { headline: "Hello" }),
    placement("p2", { headline: "Welcome" }),
  ],
};

/** A language layer's address: a node id and a dotted path into its props. */
interface Address {
  readonly nodeId: string;
  readonly path: string;
}

/**
 * Where the value an editor sees on a composed node lives, from the editor's
 * own map: the placement the node belongs to, and the exposure feeding `prop`.
 */
function addressOf(node: ResolvedBlockNode, prop: string): Address | undefined {
  const exposure = node.exposedProps?.[prop];
  if (node.instanceOf === undefined || exposure === undefined) return undefined;
  return { nodeId: node.instanceOf, path: `overrides.${exposure.id}` };
}

function read(document: BlockDocument, at: Address): unknown {
  const node = document.nodes.find(entry => entry.id === at.nodeId);
  let value: unknown = node?.props;
  for (const segment of at.path.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[segment];
  }
  return value;
}

/** The page with an overlay's values written at their addresses, as a language layer would. */
function overlaid(
  document: BlockDocument,
  overlay: LocaleOverlay
): BlockDocument {
  const copy = structuredClone(document);
  for (const [nodeId, paths] of Object.entries(overlay.props)) {
    const node = copy.nodes.find(entry => entry.id === nodeId);
    if (node === undefined) continue;
    for (const [path, entry] of Object.entries(paths)) {
      const segments = path.split(".");
      const last = segments.pop()!;
      let target = node.props as Record<string, unknown>;
      for (const segment of segments) {
        target = target[segment] as Record<string, unknown>;
      }
      target[last] = entry.value;
    }
  }
  return copy;
}

function flatten(nodes: readonly ResolvedBlockNode[]): ResolvedBlockNode[] {
  return nodes.flatMap(entry => [
    entry,
    ...Object.values(entry.slots ?? {}).flatMap(children => flatten(children)),
  ]);
}

/** The composed node a placement draws for the header's title. */
function titleOf(
  nodes: readonly ResolvedBlockNode[],
  placementId: string
): ResolvedBlockNode | undefined {
  return flatten(nodes).find(entry => entry.instanceOf === placementId);
}

/** Every text the composed page draws, in order. */
const textsOf = (nodes: readonly ResolvedBlockNode[]) =>
  flatten(nodes).map(entry => entry.props.text);

describe("a placement's value, as a language layer addresses it", () => {
  it("is the placement node plus overrides.<id>, read from what the editor draws", () => {
    const { document } = resolveComponentInstances(
      PAGE,
      new Map([["header", HEADER]]),
      { exposures: true }
    );
    const title = titleOf(document.nodes, "p1");

    const address = title === undefined ? undefined : addressOf(title, "text");

    expect(address).toEqual({ nodeId: "p1", path: "overrides.headline" });
    expect(read(PAGE, address!)).toBe("Hello");
    expect(title?.props.text).toBe("Hello");
  });

  it("draws a value written at that address on that placement only, leaving the component as it is", () => {
    const definition = structuredClone(HEADER);
    const overlay: LocaleOverlay = {
      contentMode: "overlay",
      props: { p1: { "overrides.headline": { value: "Hola" } } },
    };

    const { document } = resolveComponentInstances(
      overlaid(PAGE, overlay),
      new Map([["header", definition]])
    );

    expect(textsOf(document.nodes)).toEqual(["Hola", "Welcome"]);
    expect(definition).toEqual(HEADER);
  });
});
