/**
 * Per-device visibility: what each device shows, a hide that stays on one
 * device, and the stored values carried across a change of breakpoints.
 *
 * The property every test here checks is the one the author sees: after the
 * operation, each device shows what it should, as the COMPILER would draw it.
 * So the expected states are read back through `deviceVisibility`, which reads
 * the cascade the compiler reads, and one test holds the two to agreement on
 * the compiled CSS itself.
 */
import { describe, expect, it } from "vitest";

import {
  carryDeviceVisibility,
  carryDocumentDeviceVisibility,
  deviceVisibility,
  hiddenOnDevice,
  revealConditioned,
  revealDeviceHidden,
  setDeviceVisibility,
} from "./device-visibility";
import type {
  BlockDocument,
  BlockNode,
  BreakpointSet,
  NodeVisibility,
} from "./document";
import { compilePageCss } from "./style/compile-page";

/** Desktop (the base), tablet up to 1024px, mobile up to 640px. */
const SITE: BreakpointSet = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};

/** The same site with a small tablet between tablet and mobile. */
const WITH_SMALL_TABLET: BreakpointSet = {
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 1024 },
    { id: "small", label: "Small tablet", maxWidth: 800 },
    { id: "mobile", label: "Mobile", maxWidth: 640 },
  ],
  container: [],
};

/** The same site without its tablet. */
const WITHOUT_TABLET: BreakpointSet = {
  viewport: [{ id: "mobile", label: "Mobile", maxWidth: 640 }],
  container: [],
};

/** What each device shows, as `{ base: true, tablet: false, … }`. */
function shown(
  visibility: unknown,
  breakpoints: BreakpointSet = SITE
): Record<string, boolean> {
  return Object.fromEntries(
    deviceVisibility(visibility, breakpoints).map(device => [
      device.id,
      device.visible,
    ])
  );
}

describe("deviceVisibility", () => {
  it("shows every device when nothing is stored", () => {
    expect(shown(undefined)).toEqual({
      base: true,
      tablet: true,
      mobile: true,
    });
  });

  it("carries a hide down until a narrower device shows the block again", () => {
    expect(shown({ devices: { base: false } })).toEqual({
      base: false,
      tablet: false,
      mobile: false,
    });
    expect(shown({ devices: { base: false, mobile: true } })).toEqual({
      base: false,
      tablet: false,
      mobile: true,
    });
  });

  it("says which devices store a value of their own", () => {
    const own = deviceVisibility({ devices: { tablet: false } }, SITE).map(
      device => [device.id, device.own]
    );
    expect(own).toEqual([
      ["base", false],
      ["tablet", true],
      ["mobile", false],
    ]);
  });

  it("reads a value that is not a boolean as no value", () => {
    expect(shown({ devices: { tablet: "false", mobile: false } })).toEqual({
      base: true,
      tablet: true,
      mobile: false,
    });
  });

  it("agrees with the compiled stylesheet on every device", () => {
    // The page as the compiler draws it, for every combination a stored
    // record can hold over the three devices.
    const values = [undefined, true, false] as const;
    for (const base of values) {
      for (const tablet of values) {
        for (const mobile of values) {
          const devices: Record<string, boolean> = {};
          for (const [id, value] of Object.entries({ base, tablet, mobile })) {
            if (value !== undefined) devices[id] = value;
          }
          const css = compilePageCss(
            {
              formatVersion: 1,
              kind: "page",
              nodes: [
                {
                  id: "n",
                  type: "core/text",
                  version: 1,
                  props: {},
                  visibility: { devices },
                },
              ],
            },
            { breakpoints: SITE }
          ).css;
          // One hiding rule per run of hidden devices, read off the states
          // this module reports: a run starts where a device hides after one
          // that shows, the base counting as shown from above.
          const order = deviceVisibility({ devices }, SITE);
          const runs = order.filter(
            (device, index) =>
              !device.visible && (order[index - 1]?.visible ?? true)
          ).length;
          expect(
            css.split("display: none").length - 1,
            JSON.stringify(devices)
          ).toBe(runs);
        }
      }
    }
  });
});

describe("setDeviceVisibility", () => {
  it("hides on the device alone, and the narrower device keeps showing", () => {
    const next = setDeviceVisibility(undefined, SITE, "tablet", false);
    expect(shown(next)).toEqual({ base: true, tablet: false, mobile: true });
    expect(next).toEqual({ devices: { tablet: false, mobile: true } });
  });

  it("keeps a narrower device's own value", () => {
    const next = setDeviceVisibility(
      { devices: { mobile: false } },
      SITE,
      "base",
      false
    );
    expect(shown(next)).toEqual({ base: false, tablet: true, mobile: false });
  });

  it("shows again on one device, leaving the rest hidden", () => {
    const next = setDeviceVisibility(
      { devices: { base: false } },
      SITE,
      "tablet",
      true
    );
    expect(shown(next)).toEqual({ base: false, tablet: true, mobile: false });
  });

  it("stores nothing once the block shows everywhere", () => {
    const hidden = setDeviceVisibility(undefined, SITE, "tablet", false);
    expect(setDeviceVisibility(hidden, SITE, "tablet", true)).toBeUndefined();
  });

  it("keeps the block's conditions", () => {
    const conditions = [[{ field: "status", op: "eq", value: "vip" }]];
    const next = setDeviceVisibility(
      { conditions, devices: { tablet: false, mobile: true } },
      SITE,
      "tablet",
      true
    );
    expect(next).toEqual({ conditions });
  });

  it("keeps a value under a breakpoint the site does not define", () => {
    const next = setDeviceVisibility(
      { devices: { wide: false } },
      SITE,
      "mobile",
      false
    );
    expect(next).toEqual({ devices: { wide: false, mobile: false } });
  });

  it("changes nothing for a breakpoint the site does not define", () => {
    const before = { devices: { tablet: false } };
    expect(setDeviceVisibility(before, SITE, "wide", false)).toBe(before);
  });
});

describe("hiddenOnDevice", () => {
  it("answers for one device, and for an unknown one with false", () => {
    const visibility = { devices: { tablet: false, mobile: true } };
    expect(hiddenOnDevice(visibility, SITE, "tablet")).toBe(true);
    expect(hiddenOnDevice(visibility, SITE, "mobile")).toBe(false);
    expect(hiddenOnDevice(visibility, SITE, "wide")).toBe(false);
  });
});

describe("carryDeviceVisibility: removing a breakpoint", () => {
  it("drops the removed breakpoint's hide, and its narrower device keeps what it showed", () => {
    // Hidden from tablet down, shown again on nothing: mobile inherits the
    // hide from tablet.
    const next = carryDeviceVisibility(
      { devices: { tablet: false } },
      SITE,
      WITHOUT_TABLET
    );
    expect(next).toEqual({ devices: { mobile: false } });
    expect(shown(next, WITHOUT_TABLET)).toEqual({ base: true, mobile: false });
  });

  it("leaves nothing for a breakpoint added later under the same name", () => {
    // Hidden on the tablet alone. Removing the tablet leaves the block
    // visible everywhere, so a tablet added back starts visible.
    const removed = carryDeviceVisibility(
      { devices: { tablet: false, mobile: true } },
      SITE,
      WITHOUT_TABLET
    );
    expect(removed).toBeUndefined();
    const readded = carryDeviceVisibility(removed, WITHOUT_TABLET, SITE);
    expect(shown(readded)).toEqual({ base: true, tablet: true, mobile: true });
  });

  it("drops a stale value an older removal left behind", () => {
    // A tablet value stored while the site had no tablet: an earlier removal
    // that left it. Adding a tablet takes what its width shows, not that.
    const readded = carryDeviceVisibility(
      { devices: { tablet: false, mobile: true } },
      WITHOUT_TABLET,
      SITE
    );
    expect(shown(readded)).toEqual({ base: true, tablet: true, mobile: true });
  });
});

describe("carryDeviceVisibility: adding a breakpoint", () => {
  it("keeps every device looking as it did when added between a hide and a narrower show", () => {
    const next = carryDeviceVisibility(
      { devices: { tablet: false, mobile: true } },
      SITE,
      WITH_SMALL_TABLET
    );
    // The small tablet's widths were the tablet's, so it hides too; mobile
    // still shows.
    expect(shown(next, WITH_SMALL_TABLET)).toEqual({
      base: true,
      tablet: false,
      small: false,
      mobile: true,
    });
  });

  it("stores nothing when the block shows everywhere", () => {
    expect(
      carryDeviceVisibility(undefined, SITE, WITH_SMALL_TABLET)
    ).toBeUndefined();
  });
});

describe("carryDocumentDeviceVisibility", () => {
  const hiddenOnTablet: BlockNode = {
    id: "hidden",
    type: "core/text",
    version: 1,
    props: {},
    visibility: { devices: { tablet: false } },
  };
  const plain: BlockNode = {
    id: "plain",
    type: "core/text",
    version: 1,
    props: {},
  };
  const page: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "section",
        type: "core/section",
        version: 1,
        props: {},
        slots: { children: [hiddenOnTablet] },
      },
      plain,
    ],
  };

  it("rewrites slot content and counts the blocks it changed", () => {
    const carried = carryDocumentDeviceVisibility(page, SITE, WITHOUT_TABLET);
    expect(carried.changed).toBe(1);
    const inner = carried.document.nodes[0]?.slots?.children?.[0];
    expect(inner?.visibility).toEqual({ devices: { mobile: false } });
    expect(carried.document.nodes[1]).toBe(plain);
  });

  it("answers the same document when nothing changes", () => {
    const carried = carryDocumentDeviceVisibility(page, SITE, SITE);
    expect(carried).toEqual({ document: page, changed: 0 });
    expect(carried.document).toBe(page);
  });
});

describe("revealDeviceHidden", () => {
  const page: BlockDocument = {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "hidden",
        type: "core/text",
        version: 1,
        props: {},
        visibility: {
          conditions: [[{ field: "status", op: "eq", value: "vip" }]],
          devices: { base: false },
        },
      },
      {
        id: "other",
        type: "core/text",
        version: 1,
        props: {},
        visibility: { devices: { base: false } },
      },
    ],
  };

  it("lifts the named block's device hiding only, keeping its conditions", () => {
    const shownPage = revealDeviceHidden(page, ["hidden"]);
    expect(shownPage.nodes[0]?.visibility).toEqual({
      conditions: [[{ field: "status", op: "eq", value: "vip" }]],
    });
    expect(shownPage.nodes[1]).toBe(page.nodes[1]);
    // The document handed in is not touched.
    expect(page.nodes[0]?.visibility?.devices).toEqual({ base: false });
  });

  it("answers the same document when there is nothing to reveal", () => {
    expect(revealDeviceHidden(page, [])).toBe(page);
    expect(revealDeviceHidden(page, ["absent"])).toBe(page);
  });
});

describe("a breakpoint named __proto__", () => {
  // A breakpoint id is stored data, and an assignment to `"__proto__"` runs
  // the prototype setter instead of storing an entry.
  const site: BreakpointSet = {
    viewport: [{ id: "__proto__", label: "Odd", maxWidth: 800 }],
    container: [],
  };

  it("stores a hide under it as an entry of its own", () => {
    const next = setDeviceVisibility(undefined, site, "__proto__", false);
    const devices = next?.devices ?? {};
    expect(Object.keys(devices)).toEqual(["__proto__"]);
    // Spelled as JSON: `__proto__` in an object literal sets the prototype.
    expect(shown(next, site)).toEqual(
      JSON.parse('{"base":true,"__proto__":false}')
    );
  });

  it("keeps a stored value under it when the site does not define it", () => {
    const stored = JSON.parse(
      '{"devices":{"__proto__":false}}'
    ) as NodeVisibility;
    const next = setDeviceVisibility(stored, SITE, "mobile", false);
    expect(Object.keys(next?.devices ?? {}).sort()).toEqual([
      "__proto__",
      "mobile",
    ]);
  });
});

describe("carryDeviceVisibility on the container axis", () => {
  it("gives a container breakpoint wider than every earlier one the axis's visible start", () => {
    // The container axis has no base context: nothing held the widths above
    // the widest container breakpoint, so a wider one added starts visible.
    const before: BreakpointSet = {
      viewport: [],
      container: [{ id: "card", label: "Card", maxWidth: 400 }],
    };
    const after: BreakpointSet = {
      viewport: [],
      container: [
        { id: "wide", label: "Wide", maxWidth: 900 },
        { id: "card", label: "Card", maxWidth: 400 },
      ],
    };
    const next = carryDeviceVisibility(
      { devices: { card: false } },
      before,
      after
    );
    expect(shown(next, after)).toEqual({ base: true, wide: true, card: false });
  });
});

describe("revealConditioned", () => {
  const vip = [[{ field: "tier", op: "equals", value: "vip" }]];
  const node = (id: string, visibility?: unknown, slots?: unknown) =>
    ({
      id,
      type: "core/text",
      version: 1,
      props: {},
      ...(visibility === undefined ? {} : { visibility }),
      ...(slots === undefined ? {} : { slots }),
    }) as BlockNode;
  const docOf = (...nodes: BlockNode[]): BlockDocument =>
    ({ formatVersion: 1, kind: "page", nodes }) as BlockDocument;

  it("lifts every block's conditions, nested ones included, and keeps its devices", () => {
    const page = docOf(
      node("a", { conditions: vip, devices: { mobile: false } }),
      node("box", undefined, { children: [node("b", { conditions: vip })] })
    );
    const drawn = revealConditioned(page);
    expect(drawn.nodes[0]?.visibility).toEqual({ devices: { mobile: false } });
    expect(drawn.nodes[1]?.slots?.children?.[0]?.visibility).toBeUndefined();
    // The stored document is untouched.
    expect(page.nodes[0]?.visibility).toEqual({
      conditions: vip,
      devices: { mobile: false },
    });
  });

  it("drops a visibility nothing can read, so the block draws", () => {
    const drawn = revealConditioned(docOf(node("a", "hidden")));
    expect(drawn.nodes[0]?.visibility).toBeUndefined();
  });

  it("answers the same document when no block holds conditions", () => {
    const page = docOf(node("a", { devices: { mobile: false } }), node("b"));
    expect(revealConditioned(page)).toBe(page);
  });
});
