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
import { WRITTEN_BLOCK_TYPES, type WrittenBlock } from "../written/document";
import {
  WRITTEN_SAMPLE_DATASETS as DATASETS,
  WRITTEN_SAMPLES,
} from "../written/samples";

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
    expect([...kinds].sort()).toEqual([...WRITTEN_BLOCK_TYPES].sort());
  });
});

describe("a written email's links in dark mode", () => {
  const LINK_RULE = ".email-card .nextly-link { color: #fafafa !important; }";
  const linked: WrittenBlock = {
    type: "text",
    text: [
      {
        type: "text",
        text: "Track it",
        link: { url: "https://shop.example/t" },
      },
    ],
  };
  const render = (template: TemplateFields, accentColor: string) =>
    renderTemplate(template, defaultLayoutTemplate, DATASETS.typical, {
      appName: "Nextly",
      brand: { ...STARTING_BRAND, accentColor, footerLinks: [] },
    });

  it("stay readable on the dark card at the starting colours", () => {
    const { html } = render(fields([linked]), STARTING_BRAND.accentColor);
    expect(html).toContain('class="nextly-link"');
    expect(html).toContain(LINK_RULE);
  });

  it("keep an accent the site chose", () => {
    expect(render(fields([linked]), "#0055ff").html).not.toContain(LINK_RULE);
  });

  it("add nothing to a coded email", () => {
    const coded: TemplateFields = {
      ...fields([]),
      format: "code",
      blocks: null,
      htmlContent: '<p><a href="https://shop.example/t">Track it</a></p>',
    };
    expect(render(coded, STARTING_BRAND.accentColor).html).not.toContain(
      "nextly-link"
    );
  });
});
