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
import { planRemoveExposure } from "./exposure-planners";
import { withSettingDefaults } from "./setting-defaults";
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

describe("a block following a setting, its edges", () => {
  it("keeps the list of the setting's item binding when its follower sits in another list", () => {
    // The Title setting's heading reads each post; its follower sits in a
    // Comments list inside, and must still read the post, not the comment.
    const list = (id: string, children: BlockNode[]): BlockNode => ({
      id,
      type: COLLECTION_LIST_TYPE,
      version: 1,
      props: { query: { collection: id } },
      slots: { [LIST_ENTRY_SLOT]: children },
    });
    const card = component(
      [
        list("posts", [
          heading("card-title", "Plain title", {
            text: { $bind: "title", source: "item" },
          }),
          list("comments", [
            heading("card-echo", "Stored echo", { text: follows("title") }),
          ]),
        ]),
      ],
      [exposure("title", "card-title", "text")]
    );
    const echo = copyOf(
      composed(
        page([placement("p", "card")]),
        new Map<string, BlockDocument>([["card", card]])
      ),
      "card-echo"
    );
    const posts = copyOf(
      composed(
        page([placement("p", "card")]),
        new Map<string, BlockDocument>([["card", card]])
      ),
      "card-title"
    );
    expect(echo?.bindings?.text).toMatchObject({
      $bind: "title",
      source: "item",
    });
    // Named, and named as the composed Posts list is.
    const named = (echo?.bindings?.text as { list?: string } | undefined)?.list;
    expect(named).toBeDefined();
    expect(named).not.toBe("comments");
    expect(posts).toBeDefined();
  });

  it("shows the setting's default in a component placed inside the one shown alone", () => {
    const badge = component(
      [heading("badge-label", "Badge label")],
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
    const nodes = flatten(
      resolveComponentInstances(card, new Map([["badge", badge]])).document
        .nodes as ResolvedBlockNode[]
    );
    expect(copyOf(nodes, "badge-label")?.props.text).toBe("Plain title");
  });

  it("settles only the bindings following the setting taken away", () => {
    const card = component(
      [
        heading("a", "Default title"),
        {
          ...heading("b", "Stored", {
            text: follows("title"),
            href: follows("link"),
          }),
        },
      ],
      [exposure("title", "a", "text"), exposure("link", "a", "level", "link")]
    );
    const settled = withSettingDefaults(card, "title");
    expect(settled.nodes[1]?.props.text).toBe("Default title");
    expect(settled.nodes[1]?.bindings).toEqual({ href: follows("link") });
    const removed = planRemoveExposure(card, "title");
    if ("problem" in removed) throw new Error(removed.problem);
    expect(removed.document.nodes[1]?.bindings).toEqual({
      href: follows("link"),
    });
  });

  it("composes a component too deep to fill, rather than throwing", () => {
    // A follower near the root, and a slot chain far past the node cap.
    let chain: BlockNode = heading("deep-0", "x");
    for (let i = 1; i < 20_000; i += 1) {
      chain = {
        id: `deep-${String(i)}`,
        type: "core/box",
        version: 1,
        props: {},
        slots: { children: [chain] },
      };
    }
    const card = component(
      [
        heading("card-title", "Plain title"),
        heading("card-echo", "Stored echo", { text: follows("title") }),
        chain,
      ],
      [exposure("title", "card-title", "text")]
    );
    expect(() =>
      resolveComponentInstances(card, new Map<string, BlockDocument>())
    ).not.toThrow();
    expect(() => withSettingDefaults(card)).not.toThrow();
  });

  it("fills a follower past the default node budget when the limits allow it", () => {
    const filler = Array.from({ length: 5001 }, (_, i) =>
      heading(`f${String(i)}`, "x")
    );
    const card = component(
      [
        heading("card-title", "Plain title"),
        ...filler,
        heading("card-echo", "Stored echo", { text: follows("title") }),
      ],
      [exposure("title", "card-title", "text")]
    );
    const limits = { maxDepth: 12, maxNodes: 20_000, maxBytes: 50_000_000 };
    const echo = flatten(
      resolveComponentInstances(
        page([placement("p", "card")]),
        new Map<string, BlockDocument>([["card", card]]),
        { limits }
      ).document.nodes as ResolvedBlockNode[]
    ).find(
      entry =>
        entry.instanceOf !== undefined && entry.props.level === "card-echo"
    );
    expect(echo?.props.text).toBe("Plain title");
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

  it("refuses a follower whose prop the setting's type doesn't fit", () => {
    const judged = (doc: BlockDocument) =>
      validateDocument(doc, {
        breakpoints: FIXTURE_BREAKPOINTS,
        mode: "strict",
        definitions: {
          get: type =>
            type === "core/heading"
              ? {
                  version: 1,
                  props: {
                    text: { type: "text", role: "content" },
                    level: { type: "text" },
                  },
                }
              : undefined,
        },
      })
        .issues.filter(issue => issue.path.includes("/bindings"))
        .map(issue => [issue.path, issue.code, issue.severity]);
    const card = component(
      [
        heading("a", "A"),
        heading("b", "B", { text: follows("body") }),
        heading("c", "C", { text: follows("title") }),
      ],
      [
        exposure("body", "a", "level", "richText"),
        exposure("title", "a", "text", "text"),
      ]
    );
    expect(judged(card)).toEqual([
      ["/nodes/1/bindings/text", "invalid-binding", "error"],
    ]);
  });

  it("only warns on a page, where it shows the block's own value", () => {
    const stray = page([heading("h", "Own", { text: follows("title") })]);
    expect(codes(stray)).toEqual([
      ["/nodes/0/bindings/text", "invalid-binding", "warning"],
    ]);
  });
});
