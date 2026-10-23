/**
 * What every written block renders to, pinned.
 *
 * Each block is rendered alone, and all of them together, through
 * `renderTemplate` (the one composition preview, test and send share), inside
 * core's default layout with the starting brand settings: with typical data,
 * hostile data and none at all. A change to any block's markup, its escaping
 * or its plain text changes `__golden__/written-blocks.json`, and the change
 * is reviewed there.
 */
import { describe, expect, it } from "vitest";

import { STARTING_BRAND } from "../brand-settings";
import {
  renderTemplate,
  type TemplateFields,
} from "../services/render-template";
import { defaultLayoutTemplate } from "../services/templates";
import type { WrittenBlock } from "../written/document";
import { WRITTEN_SAMPLES } from "../written/samples";

const DATASETS: Record<string, Record<string, unknown>> = {
  typical: {
    appName: "Shop",
    year: "2026",
    name: "Priya",
    order: { number: "1042" },
    trackUrl: "https://shop.example/t/1042",
    orderUrl: "https://shop.example/orders/1042",
    lines: [
      { name: "Tea", quantity: 2, total: "$8.00" },
      { name: "Cake", quantity: 1, total: "$6.00" },
    ],
    coupon: "SPRING",
  },
  hostile: {
    appName: "Shop <b>&</b>",
    year: "2026",
    name: `<script>alert("x")</script>`,
    order: { number: "<1042>" },
    trackUrl: "javascript:alert(1)",
    orderUrl: `https://x.example/"><img src=x>`,
    lines: [{ name: "{{ name }}", quantity: "<b>2</b>", total: "{% if %}" }],
    coupon: "",
  },
  empty: { appName: "Shop", year: "2026" },
};

const fields = (blocks: WrittenBlock[]): TemplateFields => ({
  subject: "Your order",
  htmlContent: "",
  plainTextContent: null,
  preheader: null,
  useLayout: true,
  kind: "template",
  format: "written",
  blocks: { version: 1, blocks },
});

describe("every written block renders as pinned", () => {
  it("matches the pinned output, alone and all together", async () => {
    const cases: Record<string, WrittenBlock[]> = {
      ...Object.fromEntries(
        Object.entries(WRITTEN_SAMPLES).map(([k, b]) => [k, [b]])
      ),
      everything: Object.values(WRITTEN_SAMPLES),
    };
    const out: Record<string, Record<string, unknown>> = {};
    for (const [name, blocks] of Object.entries(cases)) {
      out[name] = {};
      for (const [set, data] of Object.entries(DATASETS)) {
        out[name][set] = renderTemplate(
          fields(blocks),
          defaultLayoutTemplate,
          data,
          {
            appName: "Nextly",
            brand: { ...STARTING_BRAND, footerLinks: [] },
          }
        );
      }
    }
    await expect(`${JSON.stringify(out, null, 2)}\n`).toMatchFileSnapshot(
      "./__golden__/written-blocks.json"
    );
  });

  it("covers every kind of block", () => {
    // The control: a block kind added without a sample would be one whose
    // output nobody pinned.
    const kinds = new Set(
      Object.values(WRITTEN_SAMPLES).map(block => block.type)
    );
    expect([...kinds].sort()).toEqual(
      ["button", "divider", "heading", "image", "list", "spacer", "text"].sort()
    );
  });
});
