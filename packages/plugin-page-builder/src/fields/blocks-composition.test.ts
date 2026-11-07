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
import {
  NextlyError,
  type PluginFieldWrite,
  type PluginStoredValueTarget,
} from "@nextlyhq/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compositionIssues,
  type BrokenHosts,
  type HostFinder,
  type HostRef,
  type LockedExposures,
  type PlacementUnjudged,
  type StillBrokenHosts,
  type UnjudgedHosts,
} from "./blocks-composition";
import type { ListFieldsReader, TemplateTargets } from "./list-query-judgement";

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
      // Declared slots: a child in a slot its container never declares is
      // refused on its own account, which these cases do not test.
      { ...base, name: "acme/box", slots: { children: {} } },
      { ...base, name: "acme/columns", slots: { children: {} } },
      {
        ...base,
        name: "acme/linkcard",
        slots: { children: {} },
        contentModel: (props: { link?: string }) =>
          props.link
            ? {
                is: ["flow", "interactive"],
                accepts: { without: ["interactive"] },
              }
            : { is: ["flow"] },
      },
      {
        ...base,
        name: "acme/cta",
        contentModel: () => ({ is: ["flow", "phrasing", "interactive"] }),
      },
      { ...base, name: "acme/column", parent: ["acme/columns"] },
      {
        ...base,
        name: "acme/button",
        slots: { label: { allow: ["acme/text"] } },
      },
      { ...base, name: "acme/text" },
      {
        ...base,
        name: "acme/sealed",
        slots: {
          body: { defaultBlock: [{ type: "acme/text" }], lock: "contentOnly" },
        },
      },
      {
        ...base,
        name: "acme/fixed",
        slots: {
          items: { defaultBlock: [{ type: "acme/text" }], lock: "all" },
        },
      },
      {
        ...base,
        name: "acme/plain-box",
        slots: { inner: { defaultBlock: [{ type: "acme/text" }] } },
      },
      {
        ...base,
        name: "acme/fixed-shelf",
        slots: {
          items: { defaultBlock: [{ type: "acme/plain-box" }], lock: "all" },
        },
      },
      {
        ...base,
        name: "acme/quote",
        props: { words: { type: "text", role: "content" } },
      },
      {
        ...base,
        name: "acme/sealed-quote",
        slots: {
          body: { defaultBlock: [{ type: "acme/quote" }], lock: "contentOnly" },
        },
      },
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
    // A language whose store is not ready yet answers "unavailable".
    if (value === "not-ready") throw NextlyError.serviceUnavailable();
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
    onLockedExposures?: (found: LockedExposures) => void;
    onHostsStillBroken?: (found: StillBrokenHosts) => void;
    onPlacementUnjudged?: (found: PlacementUnjudged) => void;
    composesDocuments?: boolean;
    localized?: boolean;
    listFields?: ListFieldsReader;
    templates?: TemplateTargets;
  } = {}
) {
  const { status, limits, composesDocuments, localized, ...callbacks } =
    options;
  return compositionIssues(
    value,
    {
      path: FIELD,
      data: {
        [FIELD]: value,
        ...(status === undefined ? {} : { status }),
      },
      ...(w === undefined ? {} : { write: w }),
      ...(localized === undefined
        ? {}
        : { field: { name: FIELD, type: "blocks", localized } }),
    },
    {
      store: STORE,
      limits: limits ?? DEFAULT_LIMITS,
      // Only the callbacks a case names: an absent one is never handed in.
      ...callbacks,
      composesDocuments: composesDocuments ?? true,
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

describe("a component save judged against the locks inside its hosts", () => {
  const hostPage: HostRef = {
    slug: "pages",
    id: "home",
    field: FIELD,
    localized: false,
  };

  it("refuses re-aiming an exposed slot into a lock that the host's content then breaks", async () => {
    // The page supplies two texts to the "extra" slot, which held them in an
    // open box. Re-aimed at a slot locked "all" that starts with one text, the
    // same content breaks that lock on the page.
    const aimedAt = (nodeId: string, slot: string) =>
      component(
        [
          node("open", "acme/box", { children: [] }),
          node("fixed", "acme/fixed", { items: [node("t1")] }),
        ],
        { slots: { extra: { label: "Extra", nodeId, slot } } }
      );
    const { readStored } = storeOf({
      [COMPONENTS]: { promo: { published: aimedAt("open", "children") } },
      pages: {
        home: {
          published: page([
            placing("i1", "promo", {
              slots: { extra: [node("x1"), node("x2")] },
            }),
          ]),
        },
      },
    });
    const { hostsOf } = listing([hostPage]);

    const issues = await judge(
      aimedAt("fixed", "items"),
      write(readStored, COMPONENTS, "promo"),
      { hostsOf, status: "published" }
    );

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
    // Named as the lock it is, not as a block in the wrong place.
    expect(issues[0]!.message).toContain("locked slot");
  });

  it("refuses a second lock break at a placement that already broke one", async () => {
    // The page's placement already leaves the shelf's locked slot empty. The
    // save re-aims the other exposed slot into a second locked slot, which the
    // same placement's content then breaks: a new break, though its rule and
    // placement match the old one.
    const aimedAt = (nodeId: string, slot: string) =>
      component(
        [
          node("open", "acme/box", { children: [] }),
          node("fixed", "acme/fixed", { items: [node("t1")] }),
          node("shelf", "acme/fixed-shelf", {
            items: [node("pb", "acme/plain-box", { inner: [node("pt")] })],
          }),
        ],
        {
          slots: {
            extra: { label: "Extra", nodeId, slot },
            stock: { label: "Stock", nodeId: "shelf", slot: "items" },
          },
        }
      );
    const { readStored } = storeOf({
      [COMPONENTS]: { promo: { published: aimedAt("open", "children") } },
      pages: {
        home: {
          published: page([
            placing("i1", "promo", {
              slots: { extra: [node("x1"), node("x2")], stock: [] },
            }),
          ]),
        },
      },
    });
    const { hostsOf } = listing([hostPage]);

    const issues = await judge(
      aimedAt("fixed", "items"),
      write(readStored, COMPONENTS, "promo"),
      { hostsOf, status: "published" }
    );

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
  });

  it("judges the hosts of an exposed-slot holder moved under a lock, everything else kept", async () => {
    // Two branches, each two deep: an open box and a shelf locked "all". The
    // exposed slot's holder trades places with its twin, keeping its id, type,
    // slot and depth, and every root and exposure stays as it was. Only the
    // lock it now sits under differs, and the page's two texts in that slot
    // break it.
    const twin = (id: string) =>
      node(id, "acme/plain-box", { inner: [node(`${id}-t`)] });
    const swapped = (inOpen: string, inShelf: string) =>
      component(
        [
          node("open", "acme/box", { children: [twin(inOpen)] }),
          node("shelf", "acme/fixed-shelf", { items: [twin(inShelf)] }),
        ],
        { slots: { extra: { label: "Extra", nodeId: "pb", slot: "inner" } } }
      );
    const { readStored } = storeOf({
      [COMPONENTS]: { promo: { published: swapped("pb", "other") } },
      pages: {
        home: {
          published: page([
            placing("i1", "promo", {
              slots: { extra: [node("x1"), node("x2")] },
            }),
          ]),
        },
      },
    });
    const { hostsOf } = listing([hostPage]);

    const issues = await judge(
      swapped("other", "pb"),
      write(readStored, COMPONENTS, "promo"),
      { hostsOf, status: "published" }
    );

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
  });

  it("logs every locked slot a save newly breaks at one placement", async () => {
    // Both exposed slots move from open boxes into slots locked "all", and the
    // page's content breaks each: two faults of one rule at one placement, and
    // the operator has two slots to repair.
    const aimedAt = (extra: string, stock: string) =>
      component(
        [
          node("open", "acme/box", { children: [] }),
          node("open2", "acme/box", { children: [] }),
          node("fixed", "acme/fixed", { items: [node("t1")] }),
          node("shelf", "acme/fixed-shelf", {
            items: [node("pb", "acme/plain-box", { inner: [node("pt")] })],
          }),
        ],
        {
          slots: {
            extra: {
              label: "Extra",
              nodeId: extra,
              slot: extra.startsWith("open") ? "children" : "items",
            },
            stock: {
              label: "Stock",
              nodeId: stock,
              slot: stock.startsWith("open") ? "children" : "items",
            },
          },
        }
      );
    const { readStored } = storeOf({
      [COMPONENTS]: { promo: { published: aimedAt("open", "open2") } },
      pages: {
        home: {
          published: page([
            placing("i1", "promo", {
              slots: { extra: [node("x1"), node("x2")], stock: [] },
            }),
          ]),
        },
      },
    });
    const { hostsOf } = listing([hostPage]);
    const logged: BrokenHosts[] = [];

    const issues = await judge(
      aimedAt("fixed", "shelf"),
      write(readStored, COMPONENTS, "promo"),
      { hostsOf, status: "published", onHostsBroken: b => logged.push(b) }
    );

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
    const messages = logged.flatMap(b => b.hosts.flatMap(h => h.messages));
    expect(messages).toHaveLength(2);
    expect(messages.join(" ")).toContain('"acme/fixed"');
    expect(messages.join(" ")).toContain('"acme/fixed-shelf"');
  });

  it("judges the hosts of a variant whose value for a stored locked exposure changes", async () => {
    // The component already stores an exposure of the text's "tone" inside
    // its sealed slot. Its variant "loud" sets nothing for it; the save gives
    // the variant a value, so every page picking the variant draws the sealed
    // text changed, with no root, depth, exposure or slot moved.
    const sealed = (tone?: string) =>
      component([node("s1", "acme/sealed", { body: [node("t1")] })], {
        exposed: [
          {
            id: "tone",
            label: "Tone",
            nodeId: "t1",
            propPath: "tone",
            type: "select",
            options: [{ value: "loud", label: "Loud" }],
          },
        ],
        variants: {
          loud: {
            label: "Loud",
            overrides: tone === undefined ? {} : { tone },
          },
        },
      });
    const { readStored } = storeOf({
      [COMPONENTS]: { promo: { published: sealed() } },
      pages: {
        home: {
          published: page([
            {
              ...placing("i1", "promo"),
              props: { componentId: "promo", variant: "loud" },
            },
          ]),
        },
      },
    });
    const { hostsOf } = listing([hostPage]);

    const issues = await judge(
      sealed("loud"),
      write(readStored, COMPONENTS, "promo"),
      { hostsOf, status: "published" }
    );

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
  });

  it("refuses a variant that breaks a second lock reading exactly like the first", async () => {
    // Two sealed blocks of one type, each with a stored exposure of its
    // text's tone. The variant already breaks the first; the save has it break
    // the second too. The two faults name the same block type, slot and
    // change, so only their number tells them apart.
    const twoSealed = (overrides: Record<string, string>) =>
      component(
        [
          node("s1", "acme/sealed", { body: [node("t1")] }),
          node("s2", "acme/sealed", { body: [node("t2")] }),
        ],
        {
          exposed: ["t1", "t2"].map(nodeId => ({
            id: `tone-${nodeId}`,
            label: "Tone",
            nodeId,
            propPath: "tone",
            type: "select",
            options: [{ value: "loud", label: "Loud" }],
          })),
          variants: { loud: { label: "Loud", overrides } },
        }
      );
    const { readStored } = storeOf({
      [COMPONENTS]: {
        promo: { published: twoSealed({ "tone-t1": "loud" }) },
      },
      pages: {
        home: {
          published: page([
            {
              ...placing("i1", "promo"),
              props: { componentId: "promo", variant: "loud" },
            },
          ]),
        },
      },
    });
    const { hostsOf } = listing([hostPage]);

    const issues = await judge(
      twoSealed({ "tone-t1": "loud", "tone-t2": "loud" }),
      write(readStored, COMPONENTS, "promo"),
      { hostsOf, status: "published" }
    );

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
  });

  it("warns about a host whose lock was already broken and is made no worse, naming the host and the rule", async () => {
    // The page's stored value for "tone" already changes design inside the
    // sealed slot. The save adds an unrelated exposure, which is reason enough
    // to judge the hosts, and leaves that break as it was.
    const sealed = (extra: Record<string, unknown>[] = []) =>
      component(
        [
          node("s1", "acme/sealed", { body: [node("t1")] }),
          node("q1", "acme/quote"),
        ],
        {
          exposed: [
            {
              id: "tone",
              label: "Tone",
              nodeId: "t1",
              propPath: "tone",
              type: "select",
              options: [{ value: "loud", label: "Loud" }],
            },
            ...extra,
          ] as never,
        }
      );
    const { readStored } = storeOf({
      [COMPONENTS]: { promo: { published: sealed() } },
      pages: {
        home: {
          published: page([
            {
              ...placing("i1", "promo"),
              props: { componentId: "promo", overrides: { tone: "loud" } },
            },
          ]),
        },
      },
    });
    const { hostsOf } = listing([hostPage]);
    const warned: StillBrokenHosts[] = [];

    const issues = await judge(
      sealed([
        {
          id: "words",
          label: "Words",
          nodeId: "q1",
          propPath: "words",
          type: "text",
        },
      ]),
      write(readStored, COMPONENTS, "promo"),
      {
        hostsOf,
        status: "published",
        onHostsStillBroken: found => warned.push(found),
      }
    );

    expect(issues).toEqual([]);
    expect(warned).toEqual([
      {
        componentId: "promo",
        hosts: [
          expect.objectContaining({
            slug: "pages",
            id: "home",
            messages: [expect.stringContaining("contentOnly")],
          }),
        ],
      },
    ]);
  });
});

describe("a component exposing a field a contentOnly lock holds", () => {
  /** A sealed block whose text's `tone` (not content) is exposed. */
  const exposingTone = (label = "Tone") =>
    component([node("s1", "acme/sealed", { body: [node("t1")] })], {
      exposed: [
        {
          id: "tone",
          label,
          nodeId: "t1",
          propPath: "tone",
          type: "select",
          options: [{ value: "loud", label: "Loud" }],
        },
      ],
    });

  it("is refused when the exposure is added, naming the component, the field, the slot and the rule", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: {
        promo: {
          published: component([
            node("s1", "acme/sealed", { body: [node("t1")] }),
          ]),
        },
      },
    });

    const issues = await judge(
      exposingTone(),
      write(readStored, COMPONENTS, "promo")
    );

    expect(codes(issues)).toEqual(["COMPONENT_EXPOSURE_LOCKED"]);
    const message = issues[0]!.message;
    for (const named of ['"promo"', '"Tone"', '"body"', "contentOnly"]) {
      expect(message).toContain(named);
    }
    expect(message).toMatch(/remove|loosen|content field/i);
  });

  it("is refused on a new component, which has no stored version", async () => {
    const { readStored } = storeOf({});
    const issues = await judge(exposingTone(), write(readStored, COMPONENTS));
    expect(codes(issues)).toEqual(["COMPONENT_EXPOSURE_LOCKED"]);
  });

  it("is kept with a warning when the component already stores it, so an unrelated edit still saves", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { promo: { published: exposingTone() } },
    });
    const warned: unknown[] = [];

    // An unrelated edit: the label changes, the exposure stays.
    const issues = await judge(
      exposingTone("Voice"),
      write(readStored, COMPONENTS, "promo"),
      { onLockedExposures: found => warned.push(found) }
    );

    expect(issues).toEqual([]);
    expect(warned).toEqual([
      {
        componentId: "promo",
        exposures: [
          expect.objectContaining({ exposureId: "tone", slot: "body" }),
        ],
      },
    ]);
  });

  it("accepts exposing the same node's content", async () => {
    const { readStored } = storeOf({});
    const content = component(
      [node("s1", "acme/sealed-quote", { body: [node("t1", "acme/quote")] })],
      {
        exposed: [
          {
            id: "words",
            label: "Words",
            nodeId: "t1",
            propPath: "words",
            type: "text",
          },
        ],
      }
    );
    expect(
      await judge(content, write(readStored, COMPONENTS, "promo"))
    ).toEqual([]);
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

  it("refuses a placement whose exposed value changes design inside a contentOnly slot", async () => {
    // The component is as its sealed block started; only the placement's
    // value, written into the definition's text, changes what the lock holds.
    const sealed = component(
      [node("s1", "acme/sealed", { body: [node("t1")] })],
      {
        exposed: [
          {
            id: "tone",
            label: "Tone",
            nodeId: "t1",
            propPath: "tone",
            type: "select",
            options: [{ value: "loud", label: "Loud" }],
          },
        ],
      }
    );
    const { readStored } = storeOf({
      [COMPONENTS]: { sealed: { published: sealed } },
    });
    const placed = (overrides: Record<string, unknown>) =>
      page([
        {
          ...placing("i1", "sealed"),
          props: { componentId: "sealed", overrides },
        },
      ]);

    // CONTROL: placed with no values of its own, it composes as it started.
    expect(await judge(placed({}), write(readStored, "pages", "p1"))).toEqual(
      []
    );
    const issues = await judge(
      placed({ tone: "loud" }),
      write(readStored, "pages", "p1")
    );
    expect(codes(issues)).toEqual(["locked-slot-content-only"]);
    expect(issues[0]!.message).toContain('"sealed"');
  });

  describe("with what the page and its components already hold", () => {
    // A block's defaults can change after pages store it, so a value nobody
    // changed can differ from today's starting block. What the page's stored
    // version, or the component itself, already holds is kept; a third value
    // is refused, and a page never stored is held to the rest as before.
    const toned = (t1: Node = node("t1")) =>
      component([node("s1", "acme/sealed", { body: [t1] })], {
        exposed: [
          {
            id: "tone",
            label: "Tone",
            nodeId: "t1",
            propPath: "tone",
            type: "select",
            options: [
              { value: "loud", label: "Loud" },
              { value: "quiet", label: "Quiet" },
            ],
          },
        ],
      });
    const placed = (overrides: Record<string, unknown>) =>
      page([
        {
          ...placing("i1", "sealed"),
          props: { componentId: "sealed", overrides },
        },
      ]);

    it("keeps a placement value the page already stores", async () => {
      const { readStored } = storeOf({
        [COMPONENTS]: { sealed: { published: toned() } },
        pages: { p1: { published: placed({ tone: "loud" }) } },
      });
      expect(
        await judge(placed({ tone: "loud" }), write(readStored, "pages", "p1"))
      ).toEqual([]);
      // The control: a page never stored is refused for the same value.
      expect(
        codes(
          await judge(
            placed({ tone: "loud" }),
            write(readStored, "pages", "p2")
          )
        )
      ).toEqual(["locked-slot-content-only"]);
    });

    it("refuses a value neither the starting block nor the stored page holds", async () => {
      const { readStored } = storeOf({
        [COMPONENTS]: { sealed: { published: toned() } },
        pages: { p1: { published: placed({ tone: "loud" }) } },
      });
      expect(
        codes(
          await judge(
            placed({ tone: "quiet" }),
            write(readStored, "pages", "p1")
          )
        )
      ).toEqual(["locked-slot-content-only"]);
    });

    it("refuses as for a page never stored when the stored page cannot be read, as a localized field's cannot", async () => {
      // A localized field whose language store is not ready yet has no
      // stored value to keep: the page is measured against the starting
      // blocks alone, so the lock refuses rather than lets the value through.
      const { readStored } = storeOf({
        [COMPONENTS]: { sealed: { published: toned() } },
        pages: { p1: { published: "not-ready" } },
      });
      expect(
        codes(
          await judge(
            placed({ tone: "loud" }),
            write(readStored, "pages", "p1"),
            { localized: true }
          )
        )
      ).toEqual(["locked-slot-content-only"]);
    });

    it("lets an unexpected failure to read the stored page propagate, rather than pass the write", async () => {
      const { readStored } = storeOf({
        [COMPONENTS]: { sealed: { published: toned() } },
        pages: { p1: { published: "unreadable" } },
      });
      await expect(
        judge(placed({ tone: "loud" }), write(readStored, "pages", "p1"))
      ).rejects.toThrow();
    });

    it("keeps what the component itself holds, on a page placing it for the first time", async () => {
      const held = { ...node("t1"), props: { tone: "loud" } };
      const { readStored } = storeOf({
        [COMPONENTS]: { sealed: { published: toned(held) } },
      });
      expect(
        await judge(placed({}), write(readStored, "pages", "new"))
      ).toEqual([]);
      // Changing it from there is still a change the lock refuses.
      expect(
        codes(
          await judge(
            placed({ tone: "quiet" }),
            write(readStored, "pages", "new")
          )
        )
      ).toEqual(["locked-slot-content-only"]);
    });
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

describe("a page's placed lists, judged as the page composes them", () => {
  // A component holding a list of posts whose sort a placement may choose.
  const sorted = component(
    [
      {
        id: "l1",
        type: "core/collection-loop",
        version: 1,
        props: { collection: "posts", sort: "title" },
        slots: { children: [] },
      },
    ],
    {
      exposed: [
        {
          id: "order",
          label: "Order",
          nodeId: "l1",
          propPath: "sort",
          type: "text",
        },
      ],
    }
  );
  const placed = (overrides: Record<string, unknown>) =>
    page([
      { ...placing("i1", "cards"), props: { componentId: "cards", overrides } },
    ]);
  const listFields: ListFieldsReader = async collection =>
    collection === "posts"
      ? {
          declared: new Set(["id", "title", "secret"]),
          readable: [
            { name: "id", type: "text" },
            { name: "title", type: "text" },
          ],
        }
      : undefined;

  it("refuses a placement value sorting a component's list by a field visitors can't see", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { cards: { published: sorted } },
    });
    // CONTROL: placed with a public field, the list reads as visitors may.
    expect(
      await judge(
        placed({ order: "-title" }),
        write(readStored, "pages", "p1"),
        {
          listFields,
        }
      )
    ).toEqual([]);
    const issues = await judge(
      placed({ order: "secret" }),
      write(readStored, "pages", "p1"),
      { listFields }
    );
    expect(codes(issues)).toEqual(["list-field-protected"]);
    expect(issues[0]!.message).toContain('"cards"');
    expect(issues[0]!.message).toContain('"secret"');
  });

  it("keeps a problem the stored page already composed to", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { cards: { published: sorted } },
      pages: { p1: { published: placed({ order: "secret" }) } },
    });
    expect(
      await judge(
        placed({ order: "secret" }),
        write(readStored, "pages", "p1"),
        {
          listFields,
        }
      )
    ).toEqual([]);
  });

  it("refuses a placement value giving a component's list a sort no list reads, as the canvas does", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { cards: { published: sorted } },
    });
    // Text a text exposure takes, and a sort no list may store: only the
    // composed list holds it, so only the composition can refuse it.
    for (const options of [{ listFields }, {}]) {
      const issues = await judge(
        placed({ order: "-a.b" }),
        write(readStored, "pages", "p1"),
        options
      );
      expect(codes(issues)).toEqual(["list-sort-invalid"]);
      expect(issues[0]!.message).toContain('"cards"');
    }
  });

  it("keeps a placed list's problem, and says so, where the stored page cannot be read", async () => {
    // A localized field whose language store is not ready: the stored page
    // may already compose to the problem, so nothing tells it from a new one.
    const { readStored } = storeOf({
      [COMPONENTS]: { cards: { published: sorted } },
      pages: { p1: { published: "not-ready" } },
    });
    const onPlacementUnjudged = vi.fn();
    expect(
      await judge(
        placed({ order: "secret" }),
        write(readStored, "pages", "p1"),
        {
          listFields,
          localized: true,
          onPlacementUnjudged,
        }
      )
    ).toEqual([]);
    expect(onPlacementUnjudged).toHaveBeenCalledWith(
      expect.objectContaining({ field: FIELD, slug: "pages", breaks: 1 })
    );
  });

  it("keeps a placed list's problem, and says so, where the stored page composes only in part", async () => {
    // The stored page held the placement in a frame component's slot, and
    // the frame can no longer be read: composed in part, the stored page
    // cannot say whether it already held the list's problem.
    const framed = page([
      {
        ...placing("f1", "frame"),
        slots: {
          body: [
            {
              ...placing("i1", "cards"),
              props: { componentId: "cards", overrides: { order: "secret" } },
            },
          ],
        },
      },
    ]);
    const { readStored } = storeOf({
      [COMPONENTS]: {
        cards: { published: sorted },
        frame: { published: "unreadable" },
      },
      pages: { p1: { published: framed } },
    });
    const onPlacementUnjudged = vi.fn();
    expect(
      await judge(
        placed({ order: "secret" }),
        write(readStored, "pages", "p1"),
        {
          listFields,
          onPlacementUnjudged,
        }
      )
    ).toEqual([]);
    expect(onPlacementUnjudged).toHaveBeenCalledWith(
      expect.objectContaining({ field: FIELD, slug: "pages", breaks: 1 })
    );
    // CONTROL: a page never stored has no problem to keep, and is refused.
    expect(
      codes(
        await judge(placed({ order: "secret" }), write(readStored, "pages"), {
          listFields,
        })
      )
    ).toEqual(["list-field-protected"]);
  });

  it("judges a component's newly placed list of the entry's related entries by its shape, as the pages placing it are judged", async () => {
    // A component holding a list of each entry's categories, placed for the
    // first time by another component: the entries are the pages' own.
    const related = component([
      {
        id: "r1",
        type: "core/collection-loop",
        version: 1,
        props: {
          collection: "categories",
          relation: { of: "entry", field: "categories" },
        },
        slots: { children: [] },
      },
    ]);
    const { readStored } = storeOf({
      [COMPONENTS]: { related: { published: related } },
    });
    // The component store as the server reads it: a collection with no
    // such relation.
    const storeFields: ListFieldsReader = async collection =>
      collection === COMPONENTS || collection === "pages"
        ? {
            declared: new Set(["id", "title", FIELD]),
            readable: [{ name: "id", type: "text" }],
          }
        : collection === "categories"
          ? {
              declared: new Set(["id", "name"]),
              readable: [{ name: "id", type: "text" }],
            }
          : undefined;
    expect(
      await judge(
        component([placing("i1", "related")]),
        write(readStored, COMPONENTS, "outer"),
        { listFields: storeFields }
      )
    ).toEqual([]);
    // CONTROL: placed on a page of a collection without that relation, the
    // list is that page's to fix, and refused.
    expect(
      codes(
        await judge(
          page([placing("i1", "related")]),
          write(readStored, "pages", "p9"),
          { listFields: storeFields }
        )
      )
    ).toEqual(["list-field-unknown"]);
  });

  it("keeps a sort the stored page already composed to, however it reads", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { cards: { published: sorted } },
      pages: { p1: { published: placed({ order: "-a.b" }) } },
    });
    expect(
      await judge(placed({ order: "-a.b" }), write(readStored, "pages", "p1"), {
        listFields,
      })
    ).toEqual([]);
  });
});

describe("a component save judged inside the lists of the documents that use it", () => {
  const hostPage: HostRef = {
    slug: "pages",
    id: "home",
    field: FIELD,
    localized: false,
  };
  const finder = (): HostFinder => ({
    whole: async () => true,
    placing: async ids => ({
      hosts: ids.includes("cards") ? [hostPage] : [],
      complete: true,
    }),
  });
  const listFields: ListFieldsReader = async collection => {
    if (collection === "posts") {
      return {
        declared: new Set(["id", "title", "secret"]),
        readable: [
          { name: "id", type: "text" },
          { name: "title", type: "text" },
        ],
      };
    }
    if (collection === "articles") {
      return {
        declared: new Set(["id", "name"]),
        readable: [
          { name: "id", type: "text" },
          { name: "name", type: "text" },
        ],
      };
    }
    return undefined;
  };
  /** A list of `collection` beside a heading, with "Order" aimed at one. */
  const cards = (orderAt: "heading" | "list", collection = "posts") =>
    component(
      [
        node("h1", "acme/quote"),
        {
          id: "l1",
          type: "core/collection-loop",
          version: 1,
          props: { collection },
          slots: { children: [] },
        },
      ],
      {
        exposed: [
          orderAt === "heading"
            ? {
                id: "order",
                label: "Order",
                nodeId: "h1",
                propPath: "words",
                type: "text",
              }
            : {
                id: "order",
                label: "Order",
                nodeId: "l1",
                propPath: "sort",
                type: "text",
              },
        ],
      }
    );
  const home = (order: string) =>
    page([
      {
        ...placing("i1", "cards"),
        props: { componentId: "cards", overrides: { order } },
      },
    ]);

  it("refuses retargeting a page's override onto a list it makes sort by a field visitors can't see", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { cards: { published: cards("heading") } },
      pages: { home: { published: home("secret") } },
    });
    const logged: BrokenHosts[] = [];
    const issues = await judge(
      cards("list"),
      write(readStored, COMPONENTS, "cards"),
      {
        hostsOf: finder(),
        listFields,
        status: "published",
        onHostsBroken: b => logged.push(b),
      }
    );

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
    expect(issues[0]!.message).toBe(
      "Saving this component would break 1 document that places it: a collection list would be given a source, filter or sort it can't use. Make the change in a new component, or ask someone who can open those documents to adjust them first."
    );
    expect(issues[0]!.message).not.toContain("home");
    // The operator is told which page, and the placement whose list it is.
    expect(logged).toEqual([
      {
        componentId: "cards",
        hosts: [
          {
            slug: "pages",
            id: "home",
            fields: ["content"],
            messages: [
              expect.stringMatching(
                /^Placement "i1": Component "cards".*"secret"/
              ),
            ],
          },
        ],
      },
    ]);
  });

  it("takes the same retarget where the page's override is a field visitors may read", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { cards: { published: cards("heading") } },
      pages: { home: { published: home("-title") } },
    });
    expect(
      await judge(cards("list"), write(readStored, COMPONENTS, "cards"), {
        hostsOf: finder(),
        listFields,
        status: "published",
      })
    ).toEqual([]);
  });

  it("refuses moving a list to a collection a page's sort does not fit", async () => {
    // Nothing a placement rule reads moves: only the list's own props.
    const { readStored } = storeOf({
      [COMPONENTS]: { cards: { published: cards("list") } },
      pages: { home: { published: home("title") } },
    });
    const issues = await judge(
      cards("list", "articles"),
      write(readStored, COMPONENTS, "cards"),
      { hostsOf: finder(), listFields, status: "published" }
    );
    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
  });

  it("does not blame a save for a list problem a page already had", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { cards: { published: cards("list") } },
      pages: { home: { published: home("secret") } },
    });
    const logged: BrokenHosts[] = [];
    // The list moves (so its hosts are judged), and the page's problem with
    // it is the same before and after.
    const moved = cards("list");
    (moved.nodes[1] as Node).props = { collection: "posts", limit: 5 };
    expect(
      await judge(moved, write(readStored, COMPONENTS, "cards"), {
        hostsOf: finder(),
        listFields,
        status: "published",
        onHostsBroken: b => logged.push(b),
      })
    ).toEqual([]);
    expect(logged).toEqual([]);
  });
});

describe("a component save judged inside the templates that use it", () => {
  /** Three templates placing the component, each of a collection it draws. */
  const templateHost = (id: string): HostRef => ({
    slug: "templates",
    id,
    field: FIELD,
    localized: false,
  });
  const hosts = ["t1", "t2", "t3"].map(templateHost);
  const finder = (): HostFinder => ({
    whole: async () => true,
    placing: async ids => ({
      hosts: ids.includes("cards") ? hosts : [],
      complete: true,
    }),
  });
  const listFields: ListFieldsReader = async collection =>
    collection === "posts"
      ? {
          declared: new Set(["id", "title", "secret"]),
          readable: [
            { name: "id", type: "text" },
            { name: "title", type: "text" },
          ],
        }
      : undefined;
  const cards = (orderAt: "heading" | "list") =>
    component(
      [
        node("h1", "acme/quote"),
        {
          id: "l1",
          type: "core/collection-loop",
          version: 1,
          props: { collection: "posts" },
          slots: { children: [] },
        },
      ],
      {
        exposed: [
          {
            id: "order",
            label: "Order",
            nodeId: orderAt === "heading" ? "h1" : "l1",
            propPath: orderAt === "heading" ? "words" : "sort",
            type: "text",
          },
        ],
      }
    );
  /** A template placing the component with "Order" set to `order`. */
  const template = (order: string) => ({
    ...page([
      {
        ...placing("i1", "cards"),
        props: { componentId: "cards", overrides: { order } },
      },
    ]),
    kind: "template",
  });
  const stored = storeOf({
    [COMPONENTS]: { cards: { published: cards("heading") } },
    templates: {
      t1: { published: template("secret") },
      t2: { published: template("secret") },
      t3: { published: template("secret") },
    },
  });
  /** The templates collection, its stored targets read in one read. */
  const targets = (known: Readonly<Record<string, string>>) => {
    const storedTargetsOf = vi.fn(
      async (ids: readonly string[]) =>
        new Map(
          ids.flatMap(id => (known[id] === undefined ? [] : [[id, known[id]]]))
        )
    );
    return {
      collection: "templates",
      fields: ["collection", "entryCollection"],
      storedTargetsOf,
    } satisfies TemplateTargets;
  };

  it("reads the collections every template host draws in one read, and judges each against its own", async () => {
    const templates = targets({ t1: "posts", t2: "posts", t3: "posts" });
    const issues = await judge(
      cards("list"),
      write(stored.readStored, COMPONENTS, "cards"),
      { hostsOf: finder(), listFields, status: "published", templates }
    );
    // One read for the three templates, never one per template.
    expect(templates.storedTargetsOf).toHaveBeenCalledTimes(1);
    expect(templates.storedTargetsOf).toHaveBeenCalledWith(["t1", "t2", "t3"]);
    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
  });

  it("leaves a template whose collection cannot be read unjudged, and says so, rather than judging it by shape", async () => {
    const templates = targets({ t1: "posts" });
    const unjudged: UnjudgedHosts[] = [];
    await judge(cards("list"), write(stored.readStored, COMPONENTS, "cards"), {
      hostsOf: finder(),
      listFields,
      status: "published",
      templates,
      onUnjudged: found => unjudged.push(found),
    });
    expect(unjudged).toHaveLength(1);
    expect(unjudged[0]?.count).toBe(2);
    expect(unjudged[0]?.reasons.join(" ")).toMatch(
      /template whose collection could not be read/
    );
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

  it("judges its hosts when a setting changes what it is, with its shape unmoved", async () => {
    // The page puts a call to action in the card's exposed slot; switching
    // the card's link on moves nothing a shape footprint records.
    const tile = (props: Node) =>
      component(
        [
          {
            id: "card",
            type: "acme/linkcard",
            version: 1,
            props,
            slots: { children: [] },
          },
        ],
        { slots: { body: { label: "Body", nodeId: "card", slot: "children" } } }
      );
    const { readStored } = storeOf({
      [COMPONENTS]: { tile: { published: tile({}) } },
      pages: {
        home: {
          published: page([
            placing("i1", "tile", {
              slots: {
                body: [{ id: "x", type: "acme/cta", version: 1, props: {} }],
              },
            }),
          ]),
        },
      },
    });
    const { hostsOf } = finder({ tile: [hostPage] });

    const issues = await judge(
      tile({ link: "/go" }),
      write(readStored, COMPONENTS, "tile"),
      {
        hostsOf,
        status: "published",
      }
    );

    expect(codes(issues)).toContain("COMPONENT_HOST_BROKEN");
  });

  it("judges its hosts when two cards swap which one is linked", async () => {
    // The same type/model pairs before and after, so only a footprint that
    // knows WHICH card is linked sees the host's call to action move under a
    // link.
    const pair = (aLinked: boolean) =>
      component(
        [
          {
            id: "a",
            type: "acme/linkcard",
            version: 1,
            props: aLinked ? { link: "/go" } : {},
            slots: { children: [] },
          },
          {
            id: "b",
            type: "acme/linkcard",
            version: 1,
            props: aLinked ? {} : { link: "/go" },
            slots: { children: [] },
          },
        ],
        { slots: { first: { label: "First", nodeId: "a", slot: "children" } } }
      );
    const { readStored } = storeOf({
      [COMPONENTS]: { pair: { published: pair(false) } },
      pages: {
        home: {
          published: page([
            placing("i1", "pair", {
              slots: {
                first: [{ id: "x", type: "acme/cta", version: 1, props: {} }],
              },
            }),
          ]),
        },
      },
    });
    const { hostsOf } = finder({ pair: [hostPage] });

    const issues = await judge(
      pair(true),
      write(readStored, COMPONENTS, "pair"),
      {
        hostsOf,
        status: "published",
      }
    );

    expect(codes(issues)).toContain("COMPONENT_HOST_BROKEN");
  });

  it("judges its hosts when an exposed slot's holder moves under a link", async () => {
    // Every id, model, depth and root unchanged: only where the holder sits
    // moves, under the linked card, and the host's call to action with it.
    const cards = (holderUnderLink: boolean) => {
      const holder = {
        id: "h",
        type: "acme/box",
        version: 1,
        props: {},
        slots: { children: [] },
      };
      return component(
        [
          {
            id: "p",
            type: "acme/linkcard",
            version: 1,
            props: {},
            slots: { children: holderUnderLink ? [] : [holder] },
          },
          {
            id: "l",
            type: "acme/linkcard",
            version: 1,
            props: { link: "/go" },
            slots: { children: holderUnderLink ? [holder] : [] },
          },
        ],
        { slots: { body: { label: "Body", nodeId: "h", slot: "children" } } }
      );
    };
    const { readStored } = storeOf({
      [COMPONENTS]: { cards: { published: cards(false) } },
      pages: {
        home: {
          published: page([
            placing("i1", "cards", {
              slots: {
                body: [{ id: "x", type: "acme/cta", version: 1, props: {} }],
              },
            }),
          ]),
        },
      },
    });
    const { hostsOf } = finder({ cards: [hostPage] });

    const issues = await judge(
      cards(true),
      write(readStored, COMPONENTS, "cards"),
      {
        hostsOf,
        status: "published",
      }
    );

    expect(codes(issues)).toContain("COMPONENT_HOST_BROKEN");
  });

  it("does not let a new placement break pass as the old one of the same kind", async () => {
    // The host already has a call to action under the linked first card; the
    // save unlinks the first and links the second, where the host has
    // another. One break of that kind before and after, under one placement.
    const two = (firstLinked: boolean) =>
      component(
        [
          {
            id: "a",
            type: "acme/linkcard",
            version: 1,
            props: firstLinked ? { link: "/go" } : {},
            slots: { children: [] },
          },
          {
            id: "b",
            type: "acme/linkcard",
            version: 1,
            props: firstLinked ? {} : { link: "/go" },
            slots: { children: [] },
          },
        ],
        {
          slots: {
            first: { label: "First", nodeId: "a", slot: "children" },
            second: { label: "Second", nodeId: "b", slot: "children" },
          },
        }
      );
    const { readStored } = storeOf({
      [COMPONENTS]: { two: { published: two(true) } },
      pages: {
        home: {
          published: page([
            placing("i1", "two", {
              slots: {
                first: [{ id: "x", type: "acme/cta", version: 1, props: {} }],
                second: [{ id: "y", type: "acme/cta", version: 1, props: {} }],
              },
            }),
          ]),
        },
      },
    });
    const { hostsOf } = finder({ two: [hostPage] });

    const issues = await judge(
      two(false),
      write(readStored, COMPONENTS, "two"),
      {
        hostsOf,
        status: "published",
      }
    );

    expect(codes(issues)).toContain("COMPONENT_HOST_BROKEN");
  });

  it("judges its hosts when an exposed slot's allow-list narrows", async () => {
    // The host puts a call to action in the exposed slot; the save narrows the
    // exposure to headlines only. The inner slot takes anything, so only the
    // exposure's own list refuses it, and the composed tree no longer has it.
    const tile = (allow?: readonly string[]) =>
      component(
        [
          {
            id: "inner",
            type: "acme/box",
            version: 1,
            props: {},
            slots: { children: [] },
          },
        ],
        {
          slots: {
            body: {
              label: "Body",
              nodeId: "inner",
              slot: "children",
              ...(allow ? { allow } : {}),
            },
          },
        }
      );
    const { readStored } = storeOf({
      [COMPONENTS]: { tile: { published: tile() } },
      pages: {
        home: {
          published: page([
            placing("i1", "tile", {
              slots: {
                body: [{ id: "x", type: "acme/cta", version: 1, props: {} }],
              },
            }),
          ]),
        },
      },
    });
    const { hostsOf } = finder({ tile: [hostPage] });

    const issues = await judge(
      tile(["acme/text"]),
      write(readStored, COMPONENTS, "tile"),
      {
        hostsOf,
        status: "published",
      }
    );

    expect(codes(issues)).toContain("COMPONENT_HOST_BROKEN");
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
        ]),
      },
    ]);
    // Not said of every lookup any more: the index records a document that
    // reaches a component through a placement's override as using it.
    expect(unjudged[0]!.reasons.join(" ")).not.toContain("override");
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

  it("refuses a new loop in a host that already holds an unrelated one", async () => {
    // The page already composes `p` → `q` → `p`, a loop a reader sees drawn as
    // a placeholder. The change adds a second one, `a` inside itself through
    // the page's override; one "a loop closed" answer for the whole host would
    // be the same before and after, and hide it.
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
      [COMPONENTS]: {
        a: { published: before },
        leaf: { published: leaf },
        p: { published: component([placing("pq", "q")]) },
        q: { published: component([placing("qp", "p")]) },
      },
      pages: {
        home: {
          published: page([
            {
              ...placing("i1", "a"),
              props: { componentId: "a", overrides: { swap: "a" } },
            },
            placing("i2", "p"),
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

  it("refuses removing an exposure whose override kept a host within the limit", async () => {
    // The page swaps the nested placement for a shallow component. Removing
    // the exposure returns it to the default, the deep one, which takes the
    // page past the limit. The component composed alone is the same shape
    // before and after, so only the removal says the page has to be judged.
    const swapping = (exposed: Node[]) =>
      component([box("a1", [placing("n", "deep")])], { exposed });
    const swap = {
      id: "swap",
      label: "Which",
      nodeId: "n",
      propPath: "componentId",
      type: "select",
    };
    const { readStored } = storeOf({
      [COMPONENTS]: {
        a: { published: swapping([swap]) },
        deep: {
          published: component([box("d1", [box("d2", [node("d3")])])]),
        },
        shallow: { published: component([node("s1")]) },
      },
      pages: {
        home: {
          published: page([
            box("p1", [
              {
                ...placing("i1", "a"),
                props: { componentId: "a", overrides: { swap: "shallow" } },
              },
            ]),
          ]),
        },
      },
    });
    const { hostsOf } = listing([hostPage]);

    const issues = await judge(
      swapping([]),
      write(readStored, COMPONENTS, "a"),
      {
        limits,
        hostsOf,
        status: "published",
      }
    );

    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
    expect(issues[0]!.message).toContain("deeper than the maximum of 4");
  });

  it("judges the hosts of a slot re-aimed at another node of the same type, slot and depth", async () => {
    // Two boxes side by side: the same holder type, slot name and depth. Only
    // the node says which one a placement's content lands in.
    const aimedAt = (nodeId: string) =>
      component([box("g1", []), box("g2", [])], {
        slots: { cells: { label: "Cells", nodeId, slot: "children" } },
      });
    const { readStored } = storeOf({
      [COMPONENTS]: { a: { published: aimedAt("g1") } },
      pages: {
        home: {
          published: page([
            placing("i1", "a", { slots: { cells: [node("t")] } }),
          ]),
        },
      },
    });
    const { hostsOf, lookups } = listing([hostPage]);

    await judge(aimedAt("g2"), write(readStored, COMPONENTS, "a"), {
      limits,
      hostsOf,
      status: "published",
    });

    expect(lookups).toHaveBeenCalled();
  });

  it("refuses a new loop that closes at the same component as one the host already holds", async () => {
    // The page's second placement already overrides `swap2` back to `a`, a loop
    // closing at `a`. The change also exposes `swap`, which the first
    // placement overrides to `a`: a second loop, closing at `a` too. Told apart
    // only by where they close, the two would read as one.
    const exposure = (id: string, nodeId: string) => ({
      id,
      label: id,
      nodeId,
      propPath: "componentId",
      type: "select",
    });
    const leaf = component([node("l1")]);
    const shape = [box("a1", [placing("n", "leaf"), placing("n2", "leaf")])];
    const before = component(shape, { exposed: [exposure("swap2", "n2")] });
    const after = component(shape, {
      exposed: [exposure("swap2", "n2"), exposure("swap", "n")],
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
            {
              ...placing("i2", "a"),
              props: { componentId: "a", overrides: { swap2: "a" } },
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

describe("a placement's own values", () => {
  const header = component([node("t", "acme/quote")], {
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "t",
        propPath: "words",
        type: "text",
      },
    ],
  });
  const valued = (overrides: Node) =>
    placing("p", "header", { props: { componentId: "header", overrides } });

  it("refuses a value of the wrong type, naming the field", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { header: { published: header } },
    });
    const issues = await judge(
      page([valued({ title: 7 })]),
      write(readStored, "pages", "home")
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: "PLACEMENT_VALUE_WRONG_TYPE",
        message: "Title needs text.",
      }),
    ]);
  });

  it("refuses an id the component does not expose when the write sets it", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { header: { published: header } },
    });
    expect(
      codes(
        await judge(
          page([valued({ subtitle: "Hi" })]),
          write(readStored, "pages", "home")
        )
      )
    ).toEqual(["PLACEMENT_VALUE_UNKNOWN_FIELD"]);
  });

  it("keeps an unknown id the stored page already held", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { header: { published: header } },
      pages: { home: { published: page([valued({ subtitle: "Hi" })]) } },
    });
    expect(
      await judge(
        page([valued({ subtitle: "Hi", title: "New" })]),
        write(readStored, "pages", "home")
      )
    ).toEqual([]);
  });

  it("where the stored value cannot be read, keeps every value it may already hold", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { header: { published: header } },
      pages: { home: { published: "not-ready" } },
    });
    expect(
      codes(
        await judge(
          page([valued({ subtitle: "Hi", title: 7 })]),
          write(readStored, "pages", "home"),
          { localized: true }
        )
      )
    ).toEqual([]);
  });

  it("on a single, keeps what its stored value holds and judges what the write sets", async () => {
    const components = storeOf({
      [COMPONENTS]: { header: { published: header } },
    });
    const readStored: PluginFieldWrite["readStored"] = async target =>
      "single" in target
        ? { kind: "value", value: page([valued({ subtitle: "Hi" })]) }
        : components.readStored(target);
    const single: PluginFieldWrite = {
      kind: "single",
      slug: "homepage",
      inTransaction: false,
      readStored,
    };
    expect(
      codes(await judge(page([valued({ subtitle: "Hi", title: 7 })]), single))
    ).toEqual(["PLACEMENT_VALUE_WRONG_TYPE"]);
  });

  it("judges a placement a condition gates, which the composition never expands", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { header: { published: header } },
    });
    const gated = placing("p", "header", {
      props: { componentId: "header", overrides: { title: 7 } },
      visibility: { conditions: [[{ field: "tier", op: "eq" }]] },
    });
    expect(
      codes(await judge(page([gated]), write(readStored, "pages", "home")))
    ).toEqual(["PLACEMENT_VALUE_WRONG_TYPE"]);
  });

  it("refuses as unchecked when gated placements need more components than one save reads", async () => {
    const rows: Record<string, Stored> = {};
    const gated = Array.from({ length: 101 }, (_, i) => {
      rows[`c${String(i)}`] = { published: header };
      return placing(`p${String(i)}`, `c${String(i)}`, {
        props: { componentId: `c${String(i)}`, overrides: { title: "Hi" } },
        visibility: { conditions: [[{ field: "tier", op: "eq" }]] },
      });
    });
    const { readStored } = storeOf({ [COMPONENTS]: rows });
    expect(
      codes(await judge(page(gated), write(readStored, "pages", "home")))
    ).toContain("COMPOSITION_UNCHECKED");
  });

  it("accepts a cleared field and a value of the field's type", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { header: { published: header } },
    });
    expect(
      await judge(
        page([
          valued({ title: "Hello" }),
          placing("q", "header", {
            props: {
              componentId: "header",
              overrides: { title: { $unset: true } },
            },
          }),
        ]),
        write(readStored, "pages", "home")
      )
    ).toEqual([]);
  });
});

describe("a placement's variant on a page write", () => {
  const card = component([node("t")], {
    variants: { featured: { label: "Featured", overrides: {} } },
  });
  const choosing = (variant: string) =>
    page([
      {
        ...placing("i1", "card"),
        props: { componentId: "card", variant },
      },
    ]);

  it("accepts a variant the component defines", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { card: { published: card } },
    });

    expect(
      await judge(choosing("featured"), write(readStored, "pages", "home"))
    ).toEqual([]);
  });

  it("refuses one the write newly sets that the component lacks", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { card: { published: card } },
      pages: { home: { published: choosing("featured") } },
    });

    const issues = await judge(
      choosing("gone"),
      write(readStored, "pages", "home")
    );

    expect(codes(issues)).toEqual(["PLACEMENT_VARIANT_UNKNOWN"]);
    expect(issues[0]!.message).toContain('"gone"');
  });

  it("keeps a deleted variant's key the stored page already held", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { card: { published: card } },
      pages: { home: { published: choosing("gone") } },
    });

    expect(
      await judge(choosing("gone"), write(readStored, "pages", "home"))
    ).toEqual([]);
  });
});

describe("a placed block's visibility conditions, judged as the page composes them", () => {
  /** A component holding a box shown only when `field` is set. */
  const gatedOn = (field: string) =>
    component([
      {
        ...node("b1", "acme/box", { children: [] }),
        visibility: { conditions: [[{ field, op: "exists" }]] },
      },
    ]);
  const listFields: ListFieldsReader = async collection =>
    collection === "pages"
      ? {
          declared: new Set(["id", "title", "secret"]),
          readable: [
            { name: "id", type: "text" },
            { name: "title", type: "text" },
          ],
        }
      : undefined;

  it("refuses a page placing a component whose condition checks a field visitors can't see there", async () => {
    // CONTROL: the same component checking a public field of the page.
    const { readStored } = storeOf({
      [COMPONENTS]: {
        open: { published: gatedOn("title") },
        hidden: { published: gatedOn("secret") },
      },
    });
    expect(
      await judge(
        page([placing("i1", "open")]),
        write(readStored, "pages", "p1"),
        { listFields }
      )
    ).toEqual([]);
    const issues = await judge(
      page([placing("i1", "hidden")]),
      write(readStored, "pages", "p1"),
      { listFields }
    );
    expect(codes(issues)).toEqual(["condition-field-protected"]);
    expect(issues[0]!.message).toContain('"hidden"');
    expect(issues[0]!.message).toContain('"secret"');
  });

  it("refuses a page newly placing a component stored with an operator conditions don't have", async () => {
    const legacy = component([
      {
        ...node("b1", "acme/box", { children: [] }),
        visibility: { conditions: [[{ field: "title", op: "matches" }]] },
      },
    ]);
    const { readStored } = storeOf({
      [COMPONENTS]: { old: { published: legacy } },
    });
    const issues = await judge(
      page([placing("i1", "old")]),
      write(readStored, "pages", "p1"),
      { listFields }
    );
    expect(codes(issues)).toEqual(["condition-op-unknown"]);
    expect(issues[0]!.message).toContain('"old"');
  });

  it("keeps a placed condition the stored page already composed to", async () => {
    const { readStored } = storeOf({
      [COMPONENTS]: { hidden: { published: gatedOn("secret") } },
      pages: { p1: { published: page([placing("i1", "hidden")]) } },
    });
    expect(
      await judge(
        page([placing("i1", "hidden"), node("t1")]),
        write(readStored, "pages", "p1"),
        { listFields }
      )
    ).toEqual([]);
  });

  it("refuses a component save changing a condition to a field a placing page's visitors can't see", async () => {
    const hostPage: HostRef = {
      slug: "pages",
      id: "home",
      field: FIELD,
      localized: false,
    };
    const finder: HostFinder = {
      whole: async () => true,
      placing: async ids => ({
        hosts: ids.includes("gated") ? [hostPage] : [],
        complete: true,
      }),
    };
    const { readStored } = storeOf({
      [COMPONENTS]: { gated: { published: gatedOn("title") } },
      pages: { home: { published: page([placing("i1", "gated")]) } },
    });
    // CONTROL: another public field breaks nothing.
    expect(
      await judge(gatedOn("id"), write(readStored, COMPONENTS, "gated"), {
        hostsOf: finder,
        listFields,
        status: "published",
      })
    ).toEqual([]);
    const issues = await judge(
      gatedOn("secret"),
      write(readStored, COMPONENTS, "gated"),
      { hostsOf: finder, listFields, status: "published" }
    );
    expect(codes(issues)).toEqual(["COMPONENT_HOST_BROKEN"]);
    expect(issues[0]!.message).toContain(
      "a block's visibility condition would check a field it can't use there"
    );
  });
});
