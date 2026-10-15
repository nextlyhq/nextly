/**
 * What the blocks field refuses about a document as a reader would receive it.
 *
 * Every case is a document that passes the field's own rules, so the refusals
 * here can only come from composing it over the library its write reads.
 */
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldWrite,
  PluginStoredValueTarget,
} from "@nextlyhq/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compositionIssues,
  type BrokenHosts,
  type HostFinder,
  type HostRef,
  type UnjudgedHosts,
} from "./blocks-composition";

const COMPONENTS = "nx_pb_components";
const FIELD = "content";
const STORE = { collection: COMPONENTS, field: FIELD };

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

beforeEach(() => {
  registerBlocks(
    [
      { ...base, name: "acme/box" },
      { ...base, name: "acme/columns" },
      { ...base, name: "acme/column", parent: ["acme/columns"] },
      {
        ...base,
        name: "acme/button",
        slots: { label: { allow: ["acme/text"] } },
      },
      { ...base, name: "acme/text" },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  clearBlocks();
});

type Node = Record<string, unknown>;

const node = (
  id: string,
  type = "acme/text",
  slots?: Record<string, Node[]>
) =>
  slots === undefined
    ? { id, type, version: 1, props: {} }
    : { id, type, version: 1, props: {}, slots };

const box = (id: string, children: Node[]) =>
  node(id, "acme/box", { children });

const placing = (id: string, componentId: string, extra: Node = {}) => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
  ...extra,
});

const page = (nodes: Node[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

const component = (nodes: Node[], envelope: Node = {}) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
  ...envelope,
});

/** Both stored forms of one entry; a draft read falls back to the live row. */
interface Stored {
  published?: unknown;
  draft?: unknown;
}

/** A store keyed by collection and id, read as `readStored` reads. */
function storeOf(rows: Record<string, Record<string, Stored>>) {
  const asked: PluginStoredValueTarget[] = [];
  const readStored: PluginFieldWrite["readStored"] = async target => {
    asked.push(target);
    const row = rows[target.collection]?.[target.id];
    if (row === undefined) return { kind: "absent" };
    const value =
      target.form === "draft" ? (row.draft ?? row.published) : row.published;
    if (value === "unreadable") throw new Error("this row could not be read");
    return { kind: "value", value };
  };
  return { readStored, asked };
}

/** A write to `slug`, with the stored id an update carries. */
function write(
  readStored: PluginFieldWrite["readStored"],
  slug: string,
  id?: string,
  inTransaction = false
): PluginFieldWrite {
  return {
    kind: "collection",
    slug,
    ...(id === undefined ? {} : { id }),
    inTransaction,
    readStored,
  };
}

/** Judge `value` as the `content` field of a write, with the data it carries. */
function judge(
  value: unknown,
  w: PluginFieldWrite | undefined,
  options: {
    status?: string;
    limits?: DocumentLimits;
    hostsOf?: HostFinder;
    onUnjudged?: (unjudged: UnjudgedHosts) => void;
    onHostsBroken?: (broken: BrokenHosts) => void;
    composesDocuments?: boolean;
  } = {}
) {
  return compositionIssues(
    value,
    {
      path: FIELD,
      data: {
        [FIELD]: value,
        ...(options.status === undefined ? {} : { status: options.status }),
      },
      ...(w === undefined ? {} : { write: w }),
    },
    {
      store: STORE,
      limits: options.limits ?? DEFAULT_LIMITS,
      ...(options.hostsOf === undefined ? {} : { hostsOf: options.hostsOf }),
      ...(options.onUnjudged === undefined
        ? {}
        : { onUnjudged: options.onUnjudged }),
      ...(options.onHostsBroken === undefined
        ? {}
        : { onHostsBroken: options.onHostsBroken }),
      composesDocuments: options.composesDocuments ?? true,
    }
  );
}

const codes = (issues: readonly { code: string }[]) => issues.map(i => i.code);

describe("a component that would contain itself", () => {
  it("is refused, naming the chain", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { b: { published: component([placing("n", "a")]) } },
    });

    const issues = await judge(
      component([placing("n", "b")]),
      write(readStored, COMPONENTS, "a")
    );

    expect(codes(issues)).toEqual(["COMPONENT_CYCLE"]);
    expect(issues[0]!.message).toContain("a → b → a");
  });

  it("is allowed when the chain leads nowhere back", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { b: { published: component([node("t")]) } },
    });

    expect(
      await judge(
        component([placing("n", "b")]),
        write(readStored, COMPONENTS, "a")
      )
    ).toEqual([]);
  });

  it("judges a status-less save against the preview forms only", async () => {
    // The loop exists only in b's LIVE form; a status-less save changes the
    // preview, where b's pending draft places nothing.
    const { readStored } = storeOf({
      [COMPONENTS]: {
        b: {
          published: component([placing("n", "a")]),
          draft: component([node("t")]),
        },
      },
    });
    const doc = component([placing("n", "b")]);

    expect(await judge(doc, write(readStored, COMPONENTS, "a"))).toEqual([]);
    expect(
      codes(
        await judge(doc, write(readStored, COMPONENTS, "a"), {
          status: "published",
        })
      )
    ).toEqual(["COMPONENT_CYCLE"]);
  });

  it("is not judged for a component being created, which nothing can reference yet", async () => {
    const { readStored, asked } = storeOf({});

    expect(
      await judge(component([placing("n", "b")]), write(readStored, COMPONENTS))
    ).toEqual([]);
    expect(asked.filter(t => "id" in t && t.id === "b")).toHaveLength(1);
  });
});

describe("a page judged as a reader receives it", () => {
  it("refuses a component whose root may not sit where the page places it", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: {
        cols: { published: component([node("c", "acme/column")]) },
      },
    });

    const issues = await judge(
      page([placing("i1", "cols")]),
      write(readStored, "pages", "p1")
    );

    expect(codes(issues)).toEqual(["restricted-at-root"]);
    expect(issues[0]!.message).toContain('"cols"');
  });

  it("refuses page content a placement puts where the component cannot hold it", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: {
        button: {
          published: component([node("d1", "acme/button", { label: [] })], {
            slots: { label: { label: "Label", nodeId: "d1", slot: "label" } },
          }),
        },
      },
    });
    const doc = page([
      placing("i1", "button", { slots: { label: [box("mine", [])] } }),
    ]);

    expect(codes(await judge(doc, write(readStored, "pages", "p1")))).toEqual([
      "not-allowed-in-slot",
    ]);
  });

  it("refuses a disallowed child inside a definition", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: {
        outer: { published: component([box("o1", [placing("o2", "inner")])]) },
        inner: { published: component([node("x", "acme/column")]) },
      },
    });

    expect(
      codes(
        await judge(
          page([placing("i1", "outer")]),
          write(readStored, "pages", "p1")
        )
      )
    ).toEqual(["wrong-parent"]);
  });

  it("refuses a page that composes past the depth limit", async () => {
    const limits = { ...DEFAULT_LIMITS, maxDepth: 3 };
    const { readStored } = storeOf({
      [COMPONENTS]: {
        deep: { published: component([box("d1", [node("d2")])]) },
      },
    });
    const doc = page([box("p1", [box("p2", [placing("i1", "deep")])])]);

    expect(
      codes(await judge(doc, write(readStored, "pages", "p1"), { limits }))
    ).toEqual(["depth-exceeded"]);
  });

  it("judges a status-less save against the preview, and a publish against both forms", async () => {
    // Only the component's DRAFT puts a restricted block at the top level.
    const { readStored } = storeOf({
      [COMPONENTS]: {
        cols: {
          published: component([node("c", "acme/text")]),
          draft: component([node("c", "acme/column")]),
        },
      },
    });
    const doc = page([placing("i1", "cols")]);

    expect(codes(await judge(doc, write(readStored, "pages", "p1")))).toEqual([
      "restricted-at-root",
    ]);
    expect(
      codes(
        await judge(doc, write(readStored, "pages", "p1"), {
          status: "published",
        })
      )
    ).toEqual(["restricted-at-root"]);
  });

  it("does not refuse a page for a component only its live form breaks, until it publishes", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: {
        cols: {
          published: component([node("c", "acme/column")]),
          draft: component([node("c", "acme/text")]),
        },
      },
    });
    const doc = page([placing("i1", "cols")]);

    expect(await judge(doc, write(readStored, "pages", "p1"))).toEqual([]);
    expect(
      codes(
        await judge(doc, write(readStored, "pages", "p1"), {
          status: "published",
        })
      )
    ).toEqual(["restricted-at-root"]);
  });

  it("draws an unreadable component as a placeholder rather than refusing the page", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { broken: { published: "unreadable" } },
    });

    expect(
      await judge(
        page([placing("i1", "broken")]),
        write(readStored, "pages", "p1")
      )
    ).toEqual([]);
  });

  it("refuses a page placing more distinct components than one save can read", async () => {
    const rows: Record<string, Stored> = {};
    const nodes: Node[] = [];
    for (let i = 0; i < 101; i += 1) {
      rows[`c${String(i)}`] = { published: component([node(`t${String(i)}`)]) };
      nodes.push(placing(`i${String(i)}`, `c${String(i)}`));
    }
    const { readStored } = storeOf({ [COMPONENTS]: rows });

    expect(
      codes(await judge(page(nodes), write(readStored, "pages", "p1")))
    ).toEqual(["COMPOSITION_UNCHECKED"]);
  });

  it("judges nothing when no entry write is behind the validation", async () => {
    // A default being judged, or a caller of validateFieldValues: there is no
    // write to read the library through.
    expect(await judge(page([placing("i1", "cols")]), undefined)).toEqual([]);
  });
});

describe("a component save judged inside the documents that use it", () => {
  const limits = { ...DEFAULT_LIMITS, maxDepth: 3 };
  const hostPage: HostRef = {
    slug: "pages",
    id: "home",
    field: FIELD,
    localized: false,
  };

  /** A finder over a fixed map of who places whom. */
  function finder(map: Record<string, HostRef[]>, whole = true) {
    const asked: string[] = [];
    const hostsOf: HostFinder = {
      whole: async () => whole,
      placing: async ids => {
        asked.push(...ids);
        return { hosts: ids.flatMap(id => map[id] ?? []), complete: true };
      },
    };
    return { hostsOf, asked };
  }

  it("refuses deepening a component a page places at the depth limit, naming the page only to the log", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: {
        deep: { published: component([box("d1", [node("d2")])]) },
      },
      pages: {
        home: { published: page([box("p1", [placing("i1", "deep")])]) },
      },
    });
    const { hostsOf } = finder({ deep: [hostPage] });
    const logged: BrokenHosts[] = [];

    // Three deep where the page places it: one level deeper is past the limit.
    const deeper = component([box("d1", [box("d2", [node("d3")])])]);
    const issues = await judge(deeper, write(readStored, COMPONENTS, "deep"), {
      limits,
      hostsOf,
      status: "published",
      onHostsBroken: b => logged.push(b),
    });

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
    // The refusal says how many and which rule, and names no document: the
    // pages were found and read as the system.
    expect(issues[0]!.message).toBe(
      "Saving this component would break 1 document that places it: content would be nested deeper than the maximum of 3 levels. Make the change in a new component, or ask someone who can open those documents to adjust them first."
    );
    expect(issues[0]!.message).not.toContain("home");
    // The operator is told which.
    expect(logged).toEqual([
      {
        componentId: "deep",
        hosts: [
          {
            slug: "pages",
            id: "home",
            fields: ["content"],
            messages: [expect.stringContaining("deeper")],
          },
        ],
      },
    ]);
  });

  it("reaches a page through a component that places the one being saved", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: {
        deep: { published: component([node("d1")]) },
        wrapper: { published: component([box("w1", [placing("w2", "deep")])]) },
      },
      pages: { home: { published: page([placing("i1", "wrapper")]) } },
    });
    const wrapperHost: HostRef = {
      slug: COMPONENTS,
      id: "wrapper",
      field: FIELD,
      localized: false,
    };
    const { hostsOf } = finder({ deep: [wrapperHost], wrapper: [hostPage] });
    const logged: BrokenHosts[] = [];

    const deeper = component([box("d1", [box("d2", [node("d3")])])]);
    await judge(deeper, write(readStored, COMPONENTS, "deep"), {
      limits,
      hostsOf,
      status: "published",
      onHostsBroken: b => logged.push(b),
    });

    expect(logged[0]!.hosts.map(h => h.id)).toContain("home");
  });

  it("does not look for hosts when the change cannot worsen any of them", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: {
        deep: { published: component([box("d1", [node("d2")])]) },
      },
    });
    const { hostsOf, asked } = finder({ deep: [hostPage] });

    // The same shape with different text: nothing a host is judged on moved.
    const reworded = component([box("d1", [node("d2", "acme/text")])]);
    expect(
      await judge(reworded, write(readStored, COMPONENTS, "deep"), {
        limits,
        hostsOf,
        status: "published",
      })
    ).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("does not report a host that was already broken before this save", async () => {
    // The page already places a restricted block at its top level through the
    // component; deepening the component changes nothing about that fault.
    const { readStored } = storeOf({
      [COMPONENTS]: {
        cols: { published: component([node("c", "acme/column")]) },
      },
      pages: { home: { published: page([placing("i1", "cols")]) } },
    });
    const { hostsOf } = finder({ cols: [hostPage] });

    const deeper = component([node("c", "acme/column"), box("b", [node("t")])]);
    const issues = await judge(deeper, write(readStored, COMPONENTS, "cols"), {
      hostsOf,
      status: "published",
    });

    // Its own save still reports what IT breaks at its own top level.
    expect(codes(issues)).not.toContain("COMPONENT_HOST_BROKEN");
  });

  it("judges the hosts it can list, and reports the rest as unjudged", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: {
        deep: { published: component([box("d1", [node("d2")])]) },
      },
      pages: {
        home: { published: page([box("p1", [placing("i1", "deep")])]) },
      },
    });
    // The index cannot vouch for every document, but it does list this one.
    const { hostsOf } = finder({ deep: [hostPage] }, false);
    const unjudged: UnjudgedHosts[] = [];

    const deeper = component([box("d1", [box("d2", [node("d3")])])]);
    const issues = await judge(deeper, write(readStored, COMPONENTS, "deep"), {
      limits,
      hostsOf,
      status: "published",
      onUnjudged: u => unjudged.push(u),
    });

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
    expect(unjudged).toEqual([
      {
        componentId: "deep",
        count: 0,
        listIncomplete: true,
        reasons: expect.arrayContaining([
          expect.stringContaining("cannot list every document"),
          expect.stringContaining("through a placement's override"),
        ]),
      },
    ]);
  });

  it("reports a host it cannot read as unjudged rather than passing over it", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { deep: { published: component([node("d1")]) } },
    });
    const { hostsOf } = finder({ deep: [{ ...hostPage, localized: true }] });
    const unjudged: UnjudgedHosts[] = [];

    const deeper = component([box("d1", [node("d2")])]);
    expect(
      await judge(deeper, write(readStored, COMPONENTS, "deep"), {
        limits,
        hostsOf,
        status: "published",
        onUnjudged: u => unjudged.push(u),
      })
    ).toEqual([]);
    // Judged in both forms a publish changes, and still one host, said once.
    expect(unjudged).toHaveLength(1);
    expect(unjudged[0]!.componentId).toBe("deep");
    expect(unjudged[0]!.count).toBe(1);
    expect(unjudged[0]!.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('"home" in "pages"')])
    );
  });

  it("reports every host as unjudged when no finder is wired", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { deep: { published: component([node("d1")]) } },
    });
    const unjudged: UnjudgedHosts[] = [];

    const deeper = component([box("d1", [node("d2")])]);
    expect(
      await judge(deeper, write(readStored, COMPONENTS, "deep"), {
        limits,
        status: "published",
        onUnjudged: u => unjudged.push(u),
      })
    ).toEqual([]);
    expect(unjudged[0]!.listIncomplete).toBe(true);
    expect(unjudged[0]!.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("no usage index")])
    );
  });

  it("does not report a save that cannot worsen any host as unjudged", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: {
        deep: { published: component([box("d1", [node("d2")])]) },
      },
    });
    const unjudged: UnjudgedHosts[] = [];

    await judge(
      component([box("d1", [node("d2")])]),
      write(readStored, COMPONENTS, "deep"),
      {
        limits,
        status: "published",
        onUnjudged: u => unjudged.push(u),
      }
    );
    expect(unjudged).toEqual([]);
  });

  it("judges only the forms the save changes", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: {
        deep: { published: component([box("d1", [node("d2")])]) },
      },
      pages: {
        home: { published: page([box("p1", [placing("i1", "deep")])]) },
      },
    });
    const { hostsOf, lookups } = listing([hostPage]);

    // A status-less save changes the preview; the page's preview IS its live
    // row here, so the deepening reaches it there too.
    const deeper = component([box("d1", [box("d2", [node("d3")])])]);
    const issues = await judge(deeper, write(readStored, COMPONENTS, "deep"), {
      limits,
      hostsOf,
    });

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
  });
});

describe("a component save judged inside its hosts: what each selection and write can see", () => {
  const limits = { ...DEFAULT_LIMITS, maxDepth: 4 };
  const hostPage: HostRef = {
    slug: "pages",
    id: "home",
    field: FIELD,
    localized: false,
  };
  const deepComponent = component([box("k1", [box("k2", [node("k3")])])]);
  const shallowComponent = component([node("s1")]);

  /** A component whose placement `n` a variant can re-point. */
  const swapping = (stored: string, inVariant: string) =>
    component([box("x1", [placing("n", stored)])], {
      exposed: [
        {
          id: "swap",
          label: "Which",
          nodeId: "n",
          propPath: "componentId",
          type: "select",
        },
      ],
      variants: { v: { label: "V", overrides: { swap: inVariant } } },
    });

  it("judges each selection on its own, so a variant made deeper is not hidden by a default made shallower", async () => {
    // Before: default deep, variant shallow. After: the other way round. The
    // deepest selection and the root types are the same either way; only the
    // page that picks the variant breaks.
    const { readStored } = storeOf({
      [COMPONENTS]: {
        x: { published: swapping("deep", "shallow") },
        deep: { published: deepComponent },
        shallow: { published: shallowComponent },
      },
      pages: {
        home: {
          published: page([
            box("p1", [
              {
                ...placing("i1", "x"),
                props: { componentId: "x", variant: "v" },
              },
            ]),
          ]),
        },
      },
    });
    const { hostsOf, lookups } = listing([hostPage]);

    const issues = await judge(
      swapping("shallow", "deep"),
      write(readStored, COMPONENTS, "x"),
      {
        limits,
        hostsOf,
        status: "published",
      }
    );

    expect(lookups).toHaveBeenCalled();
    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
  });

  it("judges the hosts of a component created under an id pages already place", async () => {
    // A store that accepts client ids: the page placed `x` before it existed,
    // and the create fills that placement with something too deep for it.
    const { readStored } = storeOf({
      pages: {
        home: {
          published: page([box("p1", [box("p2", [placing("i1", "x")])])]),
        },
      },
    });
    const { hostsOf } = finderOf({ x: [hostPage] });

    const issues = await judge(
      deepComponent,
      write(readStored, COMPONENTS, "x"),
      {
        limits,
        hostsOf,
        status: "published",
      }
    );

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
  });

  it("reads no usage index inside a transaction, and says the hosts went unjudged", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { x: { published: shallowComponent } },
    });
    const { hostsOf, lookups } = listing([hostPage]);
    const unjudged: UnjudgedHosts[] = [];

    await judge(deepComponent, write(readStored, COMPONENTS, "x", true), {
      limits,
      hostsOf,
      status: "published",
      onUnjudged: u => unjudged.push(u),
    });

    expect(lookups).not.toHaveBeenCalled();
    expect(unjudged[0]!.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("inside a transaction")])
    );
  });

  it("judges the hosts of a variant that is removed, which then get the default", async () => {
    // A page picks `v`, which was shallow; the default is deep. Removing `v`
    // leaves the default exactly as it was, and hands the page the deep tree.
    const { readStored } = storeOf({
      [COMPONENTS]: {
        x: { published: swapping("deep", "shallow") },
        deep: { published: deepComponent },
        shallow: { published: shallowComponent },
      },
      pages: {
        home: {
          published: page([
            box("p1", [
              {
                ...placing("i1", "x"),
                props: { componentId: "x", variant: "v" },
              },
            ]),
          ]),
        },
      },
    });
    const { hostsOf, lookups } = listing([hostPage]);
    const withoutVariant = component([box("x1", [placing("n", "deep")])], {
      exposed: [
        {
          id: "swap",
          label: "Which",
          nodeId: "n",
          propPath: "componentId",
          type: "select",
        },
      ],
    });

    const issues = await judge(
      withoutVariant,
      write(readStored, COMPONENTS, "x"),
      {
        limits,
        hostsOf,
        status: "published",
      }
    );

    expect(lookups).toHaveBeenCalled();
    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
  });

  it("refuses a change that lets a host's own override close a loop", async () => {
    // The page already overrides `swap` to point at `a`. Before the change `a`
    // exposes nothing, so the override reaches nowhere; once `a` exposes its
    // nested placement's id, the page composes `a` inside itself. Composed
    // alone, `a` closes nothing.
    const leaf = component([node("l1")]);
    const before = component([box("a1", [placing("n", "leaf")])]);
    const after = component([box("a1", [placing("n", "leaf")])], {
      exposed: [
        {
          id: "swap",
          label: "Which",
          nodeId: "n",
          propPath: "componentId",
          type: "select",
        },
      ],
    });
    const { readStored } = storeOf({
      [COMPONENTS]: { a: { published: before }, leaf: { published: leaf } },
      pages: {
        home: {
          published: page([
            {
              ...placing("i1", "a"),
              props: { componentId: "a", overrides: { swap: "a" } },
            },
          ]),
        },
      },
    });
    const { hostsOf } = listing([hostPage]);

    const issues = await judge(after, write(readStored, COMPONENTS, "a"), {
      hostsOf,
      status: "published",
    });

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
    expect(issues[0]!.message).toContain(
      "a component would end up containing itself"
    );
  });

  it("counts a page placing the component in two fields as one document", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { x: { published: shallowComponent } },
      pages: {
        home: {
          published: page([box("p1", [box("p2", [placing("i1", "x")])])]),
        },
      },
    });
    const { hostsOf } = listing([hostPage, { ...hostPage, field: "sidebar" }]);
    const logged: BrokenHosts[] = [];

    const issues = await judge(
      deepComponent,
      write(readStored, COMPONENTS, "x"),
      {
        limits,
        hostsOf,
        status: "published",
        onHostsBroken: b => logged.push(b),
      }
    );

    expect(issues[0]!.message).toContain("break 1 document that places it");
    expect(logged[0]!.hosts).toEqual([
      expect.objectContaining({
        slug: "pages",
        id: "home",
        fields: ["content", "sidebar"],
      }),
    ]);
  });

  it("composes no document where the renderer draws components from elsewhere, and still refuses a loop", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: {
        cols: { published: component([node("c", "acme/column")]) },
        b: { published: component([placing("n", "a")]) },
      },
    });

    expect(
      await judge(
        page([placing("i1", "cols")]),
        write(readStored, "pages", "p1"),
        {
          composesDocuments: false,
        }
      )
    ).toEqual([]);
    expect(
      codes(
        await judge(
          component([placing("n", "b")]),
          write(readStored, COMPONENTS, "a"),
          {
            composesDocuments: false,
          }
        )
      )
    ).toEqual(["COMPONENT_CYCLE"]);
  });
});

/** A finder over a fixed map of who places whom. */
function finderOf(map: Record<string, HostRef[]>) {
  const hostsOf: HostFinder = {
    whole: async () => true,
    placing: async ids => ({
      hosts: ids.flatMap(id => map[id] ?? []),
      complete: true,
    }),
  };
  return { hostsOf };
}

/** A finder that lists `hosts` for any lookup, and records each lookup. */
function listing(hosts: HostRef[]) {
  const lookups = vi.fn<HostFinder["placing"]>(async () => ({
    hosts,
    complete: true,
  }));
  const hostsOf: HostFinder = { whole: async () => true, placing: lookups };
  return { hostsOf, lookups };
}
