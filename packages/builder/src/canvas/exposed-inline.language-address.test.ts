/**
 * The address a language layer gives a placement's value.
 *
 * A placement keeps its values raw, keyed by exposure id, and a later language
 * layer stores a translation per node and prop path (`LocaleOverlay`). So a
 * translated value of a placed component is addressed as the placement's node
 * plus `overrides.<id>`: never a node inside the component, which every page
 * placing it shares, and never the component's own prop.
 *
 * What is pinned here is that the editor's own answers agree with that address:
 * the target the canvas derives for a component's exposed text names that
 * placement and exposure, the edit it makes lands at exactly that path of the
 * placement node, and a value written there, as an overlay would write it, is
 * the one the resolver draws, on that placement only. Only the overlay's
 * writer is this file's, since no language layer applies one yet.
 */
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  findNode,
  registerBlocks,
  resolveComponentInstances,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type LocaleOverlay,
  type ResolvedBlockNode,
} from "@nextlyhq/blocks-engine";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { composedTextAt, exposedTextOp } from "./exposed-inline";
import { applyOps } from "./ops";

beforeEach(() => {
  registerBlocks(
    [
      {
        name: "acme/heading",
        version: 1,
        description: "A heading.",
        example: { props: {} },
        render: () => null,
        props: { text: { type: "text", inline: true, role: "content" } },
      },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => clearBlocks());

/** A header whose heading node `h` shows the exposure `title`. */
const HEADER: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "h",
      type: "acme/heading",
      version: 1,
      props: { text: "Site name" },
    },
  ],
  exposed: [
    {
      id: "title",
      label: "Title",
      nodeId: "h",
      propPath: "text",
      type: "text",
    },
  ],
};

const placed = (
  id: string,
  overrides?: Record<string, unknown>
): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId: "header", ...(overrides ? { overrides } : {}) },
});

const page = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const lookup = () => new Map<string, BlockDocument>([["header", HEADER]]);

/** The value at a dotted path of a node's props. */
function readAt(
  document: BlockDocument,
  nodeId: string,
  path: string
): unknown {
  let value: unknown = findNode(document.nodes, nodeId)?.props;
  for (const segment of path.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[segment];
  }
  return value;
}

/** The page with an overlay's values written at their addresses. */
function overlaid(
  document: BlockDocument,
  overlay: LocaleOverlay
): BlockDocument {
  const copy = structuredClone(document);
  for (const [nodeId, paths] of Object.entries(overlay.props)) {
    const node = findNode(copy.nodes, nodeId);
    if (node === undefined) continue;
    for (const [path, entry] of Object.entries(paths)) {
      const segments = path.split(".");
      const last = segments.pop()!;
      let target = node.props as Record<string, unknown>;
      for (const segment of segments) {
        target[segment] ??= {};
        target = target[segment] as Record<string, unknown>;
      }
      target[last] = entry.value;
    }
  }
  return copy;
}

/** The composed heading a placement draws. */
function headingOf(
  composed: BlockDocument,
  placementId: string
): ResolvedBlockNode | undefined {
  return (composed.nodes as ResolvedBlockNode[]).find(
    entry => entry.instanceOf === placementId
  );
}

describe("a placement's value, as a language layer addresses it", () => {
  it("is the placement node plus overrides.<id>: where the canvas's target points and its edit lands", () => {
    const document = page(placed("p1", { title: "Hello" }), placed("p2"));
    const composed = resolveComponentInstances(document, lookup(), {
      exposures: true,
    }).document;
    const answer = composedTextAt(
      document,
      composed,
      headingOf(composed, "p1")?.id ?? "",
      "text"
    );
    if (answer?.kind !== "exposed") throw new Error("expected exposed text");
    const { placementId, exposureId } = answer.target;
    const path = `overrides.${exposureId}`;

    expect({ placementId, path }).toEqual({
      placementId: "p1",
      path: "overrides.title",
    });
    expect(readAt(document, placementId, path)).toBe("Hello");

    const op = exposedTextOp(document, answer.target, "Acme");
    if (op === null) throw new Error("expected an op");
    const after = applyOps(document, [op]).document;
    expect(readAt(after, placementId, path)).toBe("Acme");
    expect(readAt(after, "p2", path)).toBeUndefined();
  });

  it("draws a value written at that address on that placement only, leaving the component as it is", () => {
    const definition = structuredClone(HEADER);
    const document = page(
      placed("p1", { title: "Hello" }),
      placed("p2", { title: "Welcome" })
    );
    const overlay: LocaleOverlay = {
      contentMode: "overlay",
      props: { p1: { "overrides.title": { value: "Hola" } } },
    };

    const { document: composed } = resolveComponentInstances(
      overlaid(document, overlay),
      new Map([["header", definition]])
    );

    expect(composed.nodes.map(node => node.props.text)).toEqual([
      "Hola",
      "Welcome",
    ]);
    expect(definition).toEqual(HEADER);
  });
});
