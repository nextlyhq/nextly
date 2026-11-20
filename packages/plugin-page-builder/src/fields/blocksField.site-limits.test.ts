/**
 * A blocks value is judged under the limits the site configured, the same
 * bounds its pages are drawn under, not the engine's defaults: a site that
 * set tighter limits refuses a page past them, and one that set looser limits
 * keeps a page the defaults would refuse. The custom CSS a value holds is read
 * under the same bounds, so a block the site's limits draw never holds CSS
 * nobody judged.
 */
import {
  createBlockRegistry,
  DEFAULT_LIMITS,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";
import type { PluginFieldValidationResult } from "@nextlyhq/plugin-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CompositionSetup } from "./blocks-composition";
import { blocksFieldType } from "./blocksField";
import { CUSTOM_CSS_REFUSED } from "./custom-css-judgement";

/** The site's block registry these tests seed and judge against. */
const blocks = createBlockRegistry();

beforeEach(() => {
  blocks.register(
    [
      {
        version: 1,
        description: "A box.",
        example: { props: {} },
        render: () => null,
        name: "acme/box",
        slots: { children: {} },
      },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  blocks.clear();
});

type Node = Record<string, unknown>;

/** Boxes nested `depth` deep. */
function nested(depth: number): Node[] {
  let nodes: Node[] = [];
  for (let level = depth; level >= 1; level--) {
    nodes = [
      {
        id: `b${level}`,
        type: "acme/box",
        version: 1,
        props: {},
        slots: { children: nodes },
      },
    ];
  }
  return nodes;
}

const page = (nodes: Node[]) => ({ formatVersion: 1, kind: "page", nodes });

/** The field as the plugin builds it, on a site that configured `limits`. */
function judge(
  value: unknown,
  limits: DocumentLimits
): PluginFieldValidationResult | Promise<PluginFieldValidationResult> {
  const setup = { limits } as unknown as CompositionSetup;
  const field = blocksFieldType(undefined, () => setup, blocks);
  return field.validate!(value, {
    path: "content",
    field: { name: "content", type: "blocks" },
    data: {},
  } as never);
}

async function codesOf(
  value: unknown,
  limits: DocumentLimits
): Promise<string[] | true> {
  const result = await judge(value, limits);
  return result === true
    ? true
    : (result as readonly { code?: string }[]).map(issue => String(issue.code));
}

describe("a blocks value, judged under the limits the site configured", () => {
  it("refuses a page deeper than a tighter depth the site set", async () => {
    expect(
      await codesOf(page(nested(5)), { ...DEFAULT_LIMITS, maxDepth: 4 })
    ).toEqual(["depth-exceeded"]);
  });

  it("refuses a page with more blocks than a tighter count the site set", async () => {
    const nodes: Node[] = Array.from({ length: 4 }, (_, i) => ({
      id: `n${i}`,
      type: "acme/box",
      version: 1,
      props: {},
    }));
    expect(
      await codesOf(page(nodes), { ...DEFAULT_LIMITS, maxNodes: 3 })
    ).toEqual(["node-count-exceeded"]);
  });

  it("keeps a page past the default depth that a looser site depth allows", async () => {
    const deep = DEFAULT_LIMITS.maxDepth + 2;
    expect(
      await codesOf(page(nested(deep)), {
        ...DEFAULT_LIMITS,
        maxDepth: deep + 4,
      })
    ).toBe(true);
  });

  it("keeps the engine's defaults, answered at once, where the site is not set up", () => {
    const field = blocksFieldType(undefined, () => undefined, blocks);
    const args = {
      path: "content",
      field: { name: "content", type: "blocks" },
      data: {},
    } as never;
    const tooDeep = field.validate!(
      page(nested(DEFAULT_LIMITS.maxDepth + 1)),
      args
    );
    expect(Array.isArray(tooDeep)).toBe(true);
    expect((tooDeep as { code?: string }[]).map(issue => issue.code)).toEqual([
      "depth-exceeded",
    ]);
    expect(field.validate!(page(nested(3)), args)).toBe(true);
  });

  it("judges the CSS of a block past the default count that a looser site count draws", async () => {
    const count = DEFAULT_LIMITS.maxNodes + 1;
    const nodes: Node[] = Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      type: "acme/box",
      version: 1,
      props: {},
      ...(i === count - 1 ? { customCss: "selector { color: red; }" } : {}),
    }));
    const result = await judge(page(nodes), {
      ...DEFAULT_LIMITS,
      maxNodes: count + 10,
    });
    // A value with no write behind it says nobody changed the CSS, which is
    // refused; read under the defaults the block is never reached, and the
    // CSS it holds would be stored unjudged.
    expect(
      result === true
        ? []
        : (result as readonly { code?: string }[]).map(issue => issue.code)
    ).toEqual([CUSTOM_CSS_REFUSED]);
  });
});
