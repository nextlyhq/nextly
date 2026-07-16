import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";
import { RenderNode } from "../RenderNode";

import "./index";

const html = (node: BlockNode) =>
  renderToStaticMarkup(
    <RenderNode node={node} registry={defaultBlockRegistry} />
  );

describe("batch 4b — conversion blocks", () => {
  it("registers all conversion blocks", () => {
    for (const t of [
      "progress-bar",
      "counter",
      "rating",
      "countdown",
      "pricing-table",
      "price-list",
      "form",
    ]) {
      expect(defaultBlockRegistry.has(`core/${t}`)).toBe(true);
    }
  });

  it("progress bar fills to the percent", () => {
    const out = html(
      makeNode("core/progress-bar", { label: "X", percent: 42 })
    );
    expect(out).toContain("42%");
    expect(out).toContain("width:42%");
  });

  it("counter shows prefix/value/suffix", () => {
    const out = html(
      makeNode("core/counter", { prefix: "$", value: "5", suffix: "k" })
    );
    expect(out).toContain("$");
    expect(out).toContain("5");
    expect(out).toContain("k");
  });

  it("rating renders max star icons with a label", () => {
    const out = html(makeNode("core/rating", { value: 3, max: 5 }));
    expect((out.match(/<svg/g) ?? []).length).toBe(5);
    expect(out).toContain("out of 5");
  });

  it("countdown shows day/hour/minute/second boxes", () => {
    const out = html(
      makeNode("core/countdown", { target: "2099-01-01T00:00:00Z" })
    );
    expect(out).toContain("Days");
    expect(out).toContain("Hours");
    expect(out).toContain("Minutes");
    expect(out).toContain("Seconds");
  });

  it("pricing table lists features + CTA", () => {
    const out = html(
      makeNode("core/pricing-table", {
        title: "Pro",
        price: "$29",
        features: [{ text: "Feature A" }],
        link: { href: "/buy" },
      })
    );
    expect(out).toContain("Pro");
    expect(out).toContain("Feature A");
    expect(out).toContain('href="/buy"');
  });

  it("form renders inputs, a textarea and a validated action", () => {
    const out = html(
      makeNode("core/form", {
        action: "https://example.com/submit",
        fields: [
          { label: "Email", name: "email", type: "email", required: true },
          { label: "Msg", name: "msg", type: "textarea" },
        ],
      })
    );
    expect(out).toContain('action="https://example.com/submit"');
    expect(out).toContain('type="email"');
    expect(out).toContain("<textarea");
    expect(out).toContain('name="msg"');
  });
});
