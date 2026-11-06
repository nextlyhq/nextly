/**
 * What a removal of breakpoints would drop, counted in one blocks value and
 * in the shared styles: style values per state, own hides per block, and
 * which of them a lock holds.
 */
import { DEFAULT_LIMITS, type NamedClass } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { breakpointUsesIn, sharedStyleUses } from "./usage";

type Node = Record<string, unknown>;

const block = (id: string, extra: Node = {}): Node => ({
  id,
  type: "core/text",
  version: 1,
  props: {},
  ...extra,
});

const section = (id: string, children: Node[], extra: Node = {}): Node => ({
  id,
  type: "core/section",
  version: 1,
  props: {},
  slots: { children },
  ...extra,
});

const page = (nodes: Node[], settings?: Node) => ({
  formatVersion: 1,
  kind: "page",
  nodes,
  ...(settings === undefined ? {} : { settings }),
});

const ASKED = new Set(["mobile", "watch"]);

describe("a blocks value's use of the breakpoints asked about", () => {
  it("counts each style value at each state the compiler writes", () => {
    const { uses } = breakpointUsesIn(
      page([
        block("a", {
          styles: {
            base: { mobile: { color: "#111111", backgroundColor: "#eeeeee" } },
            hover: { mobile: { color: "#222222" } },
            // Written at no breakpoint: not dropped by any removal.
            pressed: { mobile: { color: "#333333" } },
          },
        }),
      ]),
      ASKED
    );
    expect(uses.get("mobile")).toEqual({ styles: 3, hides: 0, locked: false });
    expect(uses.has("watch")).toBe(false);
  });

  it("counts every stored value the removal deletes, drawn or not", () => {
    // A removal deletes what is stored, so the count does too: an unknown
    // property, a value the stylesheet cannot read, and two blocks sharing an
    // id are deleted, and counted, however the page draws them.
    const at = { styles: { base: { mobile: { color: "#111111" } } } };
    const { uses } = breakpointUsesIn(
      page([
        block("a", {
          styles: { base: { mobile: { color: "#111111", bogus: 1 } } },
        }),
        block("twin", at),
        block("twin", at),
      ]),
      ASKED
    );
    expect(uses.get("mobile")?.styles).toBe(4);
  });

  it("counts a block's own visibility as one hide, shown or hidden", () => {
    const { uses } = breakpointUsesIn(
      page([
        block("a", { visibility: { devices: { mobile: false } } }),
        block("b", { visibility: { devices: { mobile: true, watch: false } } }),
        // Not a stored setting: nothing to drop.
        block("c", { visibility: { devices: { mobile: "no" } } }),
      ]),
      ASKED
    );
    expect(uses.get("mobile")).toEqual({ styles: 0, hides: 2, locked: false });
    expect(uses.get("watch")).toEqual({ styles: 0, hides: 1, locked: false });
  });

  it("reads slot content and the page's own styles", () => {
    const { uses } = breakpointUsesIn(
      page(
        [
          section("s", [
            block("inner", { styles: { base: { mobile: { color: "#111" } } } }),
          ]),
        ],
        { styles: { base: { mobile: { backgroundColor: "#ffffff" } } } }
      ),
      ASKED
    );
    expect(uses.get("mobile")?.styles).toBe(2);
  });

  it("says a lock holds what a locked block, or one inside it, keeps there", () => {
    const styled = { styles: { base: { mobile: { color: "#111" } } } };
    const inside = breakpointUsesIn(
      page([section("s", [block("inner", styled)], { locked: true })]),
      ASKED
    );
    expect(inside.uses.get("mobile")?.locked).toBe(true);

    const own = breakpointUsesIn(
      page([block("a", { ...styled, locked: true })]),
      ASKED
    );
    expect(own.uses.get("mobile")?.locked).toBe(true);

    // A lock on a sibling holds nothing here.
    const beside = breakpointUsesIn(
      page([block("a", styled), block("b", { locked: true })]),
      ASKED
    );
    expect(beside.uses.get("mobile")?.locked).toBe(false);
  });

  it("leaves out what is empty, and the breakpoints not asked about", () => {
    const { uses } = breakpointUsesIn(
      page([
        block("a", {
          styles: { base: { mobile: {}, tablet: { color: "#111" } } },
        }),
      ]),
      ASKED
    );
    expect(uses.size).toBe(0);
  });

  it("says when the value could not be read to the end", () => {
    const many = Array.from({ length: 3 }, (_, i) =>
      block(`b${i}`, { styles: { base: { mobile: { color: "#111" } } } })
    );
    const cut = breakpointUsesIn(page(many), ASKED, {
      ...DEFAULT_LIMITS,
      maxNodes: 2,
    });
    expect(cut.complete).toBe(false);
    expect(breakpointUsesIn(page(many), ASKED).complete).toBe(true);
  });

  it("finds nothing in a value that is not a page", () => {
    expect(breakpointUsesIn("not json", ASKED)).toEqual({
      uses: new Map(),
      complete: true,
    });
  });
});

describe("the shared styles' use of the breakpoints asked about", () => {
  const named = (
    id: string,
    styles: NamedClass["styles"],
    extra: Partial<NamedClass> = {}
  ): NamedClass => ({ id, slug: id, orderIndex: 0, styles, ...extra });

  it("counts the styles holding a value there, the values, and the locked ones by name", () => {
    const found = sharedStyleUses(
      [
        named("card", {
          base: { mobile: { color: "#111", backgroundColor: "#eeeeee" } },
        }),
        named(
          "hero",
          { hover: { mobile: { color: "#222" } } },
          { locked: true, label: "Hero" }
        ),
        named("plain", { base: { base: { color: "#333" } } }),
        named("bare", { base: { mobile: {} } }, { locked: true }),
      ],
      ASKED
    );
    expect(found.get("mobile")).toEqual({
      classes: 2,
      styles: 3,
      locked: ["Hero"],
    });
    expect(found.has("watch")).toBe(false);
  });

  it("counts every stored shared style, the ones the library drops too", () => {
    // A second entry claiming a slug an earlier one holds is drawn nowhere,
    // and deleted all the same.
    const found = sharedStyleUses(
      [
        named("card", { base: { mobile: { color: "#111" } } }),
        named(
          "card-again",
          { base: { mobile: { color: "#222" } } },
          { slug: "card", locked: true, label: "Copy" }
        ),
      ],
      ASKED
    );
    expect(found.get("mobile")).toEqual({
      classes: 2,
      styles: 2,
      locked: ["Copy"],
    });
  });

  it("names a locked style without a label by its slug", () => {
    const found = sharedStyleUses(
      [
        named(
          "quiet",
          { base: { watch: { color: "#111" } } },
          { locked: true }
        ),
      ],
      ASKED
    );
    expect(found.get("watch")?.locked).toEqual(["quiet"]);
  });
});
