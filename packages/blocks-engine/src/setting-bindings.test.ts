/**
 * A block inside a component that follows one of the component's own
 * settings: `{ $bind: "<setting id>", source: "setting" }`. Composed, it
 * shows what the placement gives the setting (its value, else its binding,
 * else the setting's default, the value on the setting's own block); shown
 * alone, the component shows the default; anywhere else it is unbound.
 */
import { describe, expect, it } from "vitest";

import {
  type Binding,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ExposedProperty,
} from "./document";
import { planDetach } from "./composition-planners";
import { COLLECTION_LIST_TYPE, LIST_ENTRY_SLOT } from "./list-query";
import { applyOps } from "./ops";
import { bindDocument, createBindingRun } from "./resolve-bindings";
import {
  resolveComponentInstances,
  type ResolvedBlockNode,
} from "./resolve-instances";
import { settingBindingIssues } from "./setting-bindings";
import { validateDocument } from "./validation";
import { componentEnvelopeIssues } from "./validation-components";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";

const heading = (
  id: string,
  text: string,
  bindings?: Record<string, Binding>
): BlockNode => ({
  id,
  type: "core/heading",
  version: 1,
  // The level carries the stored id, so a composed copy is found by it.
  props: { text, level: id },
  ...(bindings === undefined ? {} : { bindings }),
});

const follows = (id: string): Binding => ({ $bind: id, source: "setting" });

const placement = (
  id: string,
  componentId: string,
  props: Record<string, unknown> = {},
  bindings?: Record<string, unknown>
): BlockNode => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId, ...props },
  ...(bindings === undefined
    ? {}
    : { bindings: bindings as Record<string, Binding> }),
});

const exposure = (
  id: string,
  nodeId: string,
  propPath: string,
  type: ExposedProperty["type"] = "text"
): ExposedProperty => ({ id, label: id, nodeId, propPath, type });

const component = (
  nodes: BlockNode[],
  exposed: ExposedProperty[]
): ComponentDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
  exposed,
});

const page = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

function flatten(nodes: readonly ResolvedBlockNode[]): ResolvedBlockNode[] {
  return nodes.flatMap(entry => [
    entry,
    ...Object.values(entry.slots ?? {}).flatMap(children => flatten(children)),
  ]);
}

/** Every node of the composed page. */
function composed(
  document: BlockDocument,
  definitions: ReadonlyMap<string, BlockDocument>
): ResolvedBlockNode[] {
  return flatten(
    resolveComponentInstances(document, definitions).document
      .nodes as ResolvedBlockNode[]
  );
}

/** The composed copy of the component's block stored as `id`. */
function copyOf(
  nodes: readonly ResolvedBlockNode[],
  id: string
): ResolvedBlockNode | undefined {
  return nodes.find(
    entry => entry.instanceOf !== undefined && entry.props.level === id
  );
}

// A card whose Title setting is on its heading, and whose image's alt text
// follows that setting.
const CARD = component(
  [
    heading("card-title", "Plain title"),
    heading("card-echo", "Stored echo", { text: follows("title") }),
  ],
  [exposure("title", "card-title", "text")]
);
const DEFS = new Map<string, BlockDocument>([["card", CARD]]);

describe("a block following its component's setting, composed", () => {
  it("shows the placement's value for the setting", () => {
    const nodes = composed(
      page([placement("p", "card", { overrides: { title: "Typed" } })]),
      DEFS
    );
    const echo = copyOf(nodes, "card-echo");
    expect(echo?.props.text).toBe("Typed");
    expect(echo?.bindings?.text).toBeUndefined();
  });

  it("shows the setting's default when the placement sets nothing", () => {
    const echo = copyOf(
      composed(page([placement("p", "card")]), DEFS),
      "card-echo"
    );
    expect(echo?.props.text).toBe("Plain title");
    expect(echo?.bindings).toBeUndefined();
  });

  it("reads the placement's binding of the setting, as the setting's block does", () => {
    const byTitle = { $bind: "title", source: "item", list: "posts" };
    const nodes = composed(
      page([
        {
          id: "posts",
          type: COLLECTION_LIST_TYPE,
          version: 1,
          props: { query: { collection: "posts" } },
          slots: {
            [LIST_ENTRY_SLOT]: [
              placement("p", "card", {}, { "overrides.title": byTitle }),
            ],
          },
        },
      ]),
      DEFS
    );
    expect(copyOf(nodes, "card-echo")?.bindings?.text).toEqual(byTitle);
    expect(copyOf(nodes, "card-title")?.bindings?.text).toEqual(byTitle);
  });

  it("carries the setting's own block's binding when the placement sets nothing", () => {
    const fromSite: Binding = { $bind: "name", source: "site" };
    const defs = new Map<string, BlockDocument>([
      [
        "card",
        component(
          [
            heading("card-title", "Plain title", { text: fromSite }),
            heading("card-echo", "Stored echo", { text: follows("title") }),
          ],
          [exposure("title", "card-title", "text")]
        ),
      ],
    ]);
    const echo = copyOf(
      composed(page([placement("p", "card")]), defs),
      "card-echo"
    );
    expect(echo?.bindings?.text).toEqual(fromSite);
  });

  it("follows a setting whose id is not a field path", () => {
    // Setting ids are minted from labels, hyphens and all.
    const card = component(
      [
        heading("card-title", "Plain title"),
        heading("card-echo", "Stored echo", { text: follows("hero-title") }),
      ],
      [exposure("hero-title", "card-title", "text")]
    );
    const echo = copyOf(
      composed(
        page([
          placement("p", "card", { overrides: { "hero-title": "Typed" } }),
        ]),
        new Map<string, BlockDocument>([["card", card]])
      ),
      "card-echo"
    );
    expect(echo?.props.text).toBe("Typed");
  });

  it("follows the setting of the component it sits in, inside a component", () => {
    // The badge's own Label setting is on its text; the card places the badge
    // and feeds its Label from the card's Title.
    const badge = component(
      [
        heading("badge-label", "Badge label"),
        heading("badge-echo", "Badge echo", { text: follows("label") }),
      ],
      [exposure("label", "badge-label", "text")]
    );
    const card = component(
      [
        heading("card-title", "Plain title"),
        placement(
          "card-badge",
          "badge",
          {},
          {
            "overrides.label": follows("title"),
          }
        ),
      ],
      [exposure("title", "card-title", "text")]
    );
    const nodes = composed(
      page([placement("p", "card", { overrides: { title: "Typed" } })]),
      new Map<string, BlockDocument>([
        ["card", card],
        ["badge", badge],
      ])
    );
    expect(copyOf(nodes, "badge-label")?.props.text).toBe("Typed");
    expect(copyOf(nodes, "badge-echo")?.props.text).toBe("Typed");
  });

  it("keeps what it showed when the placement is detached", () => {
    const host = page([
      placement("p", "card", { overrides: { title: "Typed" } }),
    ]);
    const plan = planDetach(host, "p", DEFS, { parentsOf: () => undefined });
    if (plan.pageOps === undefined) throw new Error(String(plan.problem));
    const detached = flatten(
      applyOps(host, plan.pageOps).document.nodes as ResolvedBlockNode[]
    );
    const echo = detached.find(entry => entry.props.level === "card-echo");
    expect(echo?.props.text).toBe("Typed");
    expect(echo?.bindings).toBeUndefined();
  });
});

describe("a block following a setting, outside composition", () => {
  const run = createBindingRun({
    sources: { site: { name: "Acme" } },
    props: {
      get: type =>
        type === "core/heading"
          ? { props: { text: { type: "text" } } }
          : undefined,
    },
  });
  const textOf = (document: BlockDocument, id: string): unknown =>
    flatten(
      bindDocument(document, run).document.nodes as ResolvedBlockNode[]
    ).find(entry => entry.id === id)?.props.text;

  it("shows the setting's default in the component shown alone", () => {
    expect(textOf(CARD, "card-echo")).toBe("Plain title");
  });

  it("shows the default's own binding in the component shown alone", () => {
    const card = component(
      [
        heading("card-title", "Plain title", {
          text: { $bind: "name", source: "site" },
        }),
        heading("card-echo", "Stored echo", { text: follows("title") }),
      ],
      [exposure("title", "card-title", "text")]
    );
    expect(textOf(card, "card-echo")).toBe("Acme");
  });

  it("is unbound on a page, showing the block's own value", () => {
    const stray = page([heading("h", "Own text", { text: follows("title") })]);
    const bound = bindDocument(stray, run);
    expect(textOf(stray, "h")).toBe("Own text");
    expect(bound.issues.map(issue => issue.code)).toEqual([
      "binding-source-unavailable",
    ]);
  });
});

describe("where a setting binding may be saved", () => {
  const codes = (doc: BlockDocument) =>
    [...componentEnvelopeIssues(doc), ...settingBindingIssues(doc)].map(
      issue => [issue.path, issue.code, issue.severity]
    );

  it("takes one following a setting of its own component", () => {
    expect(codes(CARD)).toEqual([]);
  });

  it("refuses one following a setting the component doesn't have", () => {
    const card = component(
      [heading("a", "A"), heading("b", "B", { text: follows("gone") })],
      [exposure("title", "a", "text")]
    );
    expect(codes(card)).toEqual([
      ["/nodes/1/bindings/text", "invalid-binding", "error"],
    ]);
  });

  it("refuses one following a visibility setting", () => {
    const card = component(
      [heading("a", "A"), heading("b", "B", { text: follows("shown") })],
      [exposure("shown", "a", "text", "visibility")]
    );
    expect(codes(card)).toEqual([
      ["/nodes/1/bindings/text", "invalid-binding", "error"],
    ]);
  });

  it("refuses the setting's own block following it", () => {
    const card = component(
      [heading("a", "A", { text: follows("title") })],
      [exposure("title", "a", "text")]
    );
    expect(codes(card)).toEqual([
      ["/nodes/0/bindings/text", "invalid-binding", "error"],
    ]);
  });

  it("is judged by the document's own validation", () => {
    const judged = (doc: BlockDocument) =>
      validateDocument(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
      })
        .issues.filter(issue => issue.path.includes("/bindings"))
        .map(issue => [issue.path, issue.code, issue.severity]);
    const card = component(
      [
        heading("a", "A"),
        heading("b", "B", { text: follows("hero-title") }),
        heading("c", "C", { text: follows("gone") }),
      ],
      [exposure("hero-title", "a", "text")]
    );
    // A minted id is no field path, and is taken as one of the component's.
    expect(judged(card)).toEqual([
      ["/nodes/2/bindings/text", "invalid-binding", "error"],
    ]);
  });

  it("only warns on a page, where it shows the block's own value", () => {
    const stray = page([heading("h", "Own", { text: follows("title") })]);
    expect(codes(stray)).toEqual([
      ["/nodes/0/bindings/text", "invalid-binding", "warning"],
    ]);
  });
});
