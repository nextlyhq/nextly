/**
 * What a `select` content field may offer, checked against what the control can draw.
 *
 * The inspector renders a select field through Radix, which refuses an item whose value is the
 * empty string: it reserves that value for "nothing is chosen". A block that offers one compiles,
 * renders on the canvas, and throws the moment an author opens that one dropdown — so the fault is
 * invisible everywhere except the interaction it breaks.
 *
 * Swept across the whole catalog rather than asserted on the block that had it, because the next
 * block to reach for "" as "no opinion" is written by someone who never read that block.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { migrateDocument } from "../../core/migrate";
import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";
import { RenderNode } from "../RenderNode";

import "./index";

interface SelectOption {
  value?: unknown;
  label?: unknown;
}

interface ContentField {
  name?: unknown;
  type?: unknown;
  options?: unknown;
}

/** Every `{block, field, option}` triple the inspector would hand to a Radix item. */
function selectOptions(): {
  block: string;
  field: string;
  value: unknown;
}[] {
  const found: { block: string; field: string; value: unknown }[] = [];
  for (const def of defaultBlockRegistry.all()) {
    for (const raw of def.contentFields ?? []) {
      const field = raw as ContentField;
      if (field.type !== "select" || !Array.isArray(field.options)) continue;
      for (const option of field.options as SelectOption[]) {
        found.push({
          block: def.type,
          field: String(field.name),
          value: option?.value,
        });
      }
    }
  }
  return found;
}

const html = (node: BlockNode) =>
  renderToStaticMarkup(
    <RenderNode node={node} registry={defaultBlockRegistry} />
  );

describe("select fields across the catalog", () => {
  it("has select options to judge at all", () => {
    // Without this the sweep below passes on a catalog that failed to load, which is the one
    // result it must never give.
    expect(selectOptions().length).toBeGreaterThan(0);
  });

  it("offers no option Radix would refuse to render", () => {
    const empty = selectOptions().filter(o => o.value === "");
    expect(empty).toEqual([]);
  });

  it("names every option value, so a stored document says what it means", () => {
    const unnamed = selectOptions().filter(o => typeof o.value !== "string");
    expect(unnamed).toEqual([]);
  });
});

describe("an image stored before its original ratio had a name", () => {
  const stored = (aspectPreset: unknown) => ({
    version: 1 as const,
    root: {
      id: "r",
      type: "core/image",
      definitionVersion: 1,
      props: { aspectPreset },
    },
  });
  const ratioAfterMigration = (aspectPreset: unknown): unknown =>
    (
      migrateDocument(stored(aspectPreset), defaultBlockRegistry).root
        .props as {
        aspectPreset?: unknown;
      }
    ).aspectPreset;

  it("reads its unset ratio as the choice the author sees", () => {
    expect(ratioAfterMigration("")).toBe("original");
  });

  it("leaves a ratio the author actually picked alone", () => {
    expect(ratioAfterMigration("16/9")).toBe("16/9");
  });
});

describe("a column that follows its row", () => {
  it("writes no alignSelf for the inherit sentinel", () => {
    const out = html(
      makeNode("core/column", { verticalAlign: "inherit" }, undefined, {
        default: [makeNode("core/heading", { text: "c" })],
      })
    );
    expect(out).not.toContain("align-self");
  });

  it("writes alignSelf for an alignment the field offers", () => {
    const out = html(
      makeNode("core/column", { verticalAlign: "center" }, undefined, {
        default: [makeNode("core/heading", { text: "c" })],
      })
    );
    expect(out).toContain("align-self:center");
  });

  it("ignores an alignment no field offered", () => {
    const out = html(
      makeNode(
        "core/column",
        { verticalAlign: "javascript:alert(1)" },
        undefined,
        { default: [makeNode("core/heading", { text: "c" })] }
      )
    );
    expect(out).not.toContain("align-self");
  });
});
