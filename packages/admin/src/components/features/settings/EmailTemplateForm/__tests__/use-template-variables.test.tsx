/**
 * The workbench's variable check reads every Liquid field, leaves out what
 * the send supplies and what is declared, and names what would show blank
 * once the engine has loaded.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { useTemplateVariables } from "../useTemplateVariables";

// The analysis loads on demand; warm the import once.
beforeAll(() => import("../liquid/liquid-variables"), 60_000);

describe("the workbench's variable check", () => {
  it("reads every field, and lists each undeclared variable with the paths it's read by", async () => {
    const { result } = renderHook(() =>
      useTemplateVariables({
        sources: [
          "Order {{ order.number }} for {{ appName }}",
          "{{ order.total }} due",
          '{{ shop.name }} <{{ shop.email | default: "x@y.z" }}>',
          undefined,
          "{% for line in order.lines %}{{ line.title }}{% endfor %}",
          "Hi {{ customer.name }}, {{ nextly_brand.footer }} {{ year }}",
        ],
        declared: [{ name: "customer" }],
        // The sample data the form always carries: appName and year have
        // starting values, so the sender-dependent names are not blank.
        data: { order: { number: "A-1" }, appName: "Northwind", year: "2026" },
        isLayoutRow: false,
        liquid: true,
      })
    );

    // An ordinary body is handed only the brand settings for free (see
    // renderTemplate): `appName` and `year` arrive just where the sender
    // passes them, so both are the template's to declare — with a sample
    // value, so not blank.
    await waitFor(() =>
      expect(result.current.undeclared).toEqual([
        {
          name: "order",
          paths: ["order.number", "order.total", "order.lines"],
        },
        { name: "appName", paths: ["appName"] },
        { name: "shop", paths: ["shop.name", "shop.email"] },
        { name: "year", paths: ["year"] },
      ])
    );
    // Blank: written, no fallback, no value. `order.number` and the two
    // sender-dependent names have sample values, `shop.email` has a
    // fallback, and the brand needs nothing.
    expect(result.current.missing).toEqual([
      "order.total",
      "shop.name",
      "customer.name",
    ]);
  });

  it("asks a layout for no `content`, which the send puts there", async () => {
    const { result } = renderHook(() =>
      useTemplateVariables({
        sources: ["<main>{{ content }}</main>"],
        declared: [],
        data: {},
        isLayoutRow: true,
        liquid: true,
      })
    );
    await waitFor(() =>
      expect(result.current).toEqual({ undeclared: [], missing: [] })
    );
  });

  it("asks a layout for the chrome its composition supplies", async () => {
    // A layout row IS the wrapper, so the chrome the composition hands it —
    // `appName`, `year` beside `content` — reads for free, as does the brand
    // every body reads.
    const { result } = renderHook(() =>
      useTemplateVariables({
        sources: [
          "<header>{{ appName }} {{ year }}</header><main>{{ content }} {{ brand.accent }}</main>",
        ],
        declared: [],
        data: {},
        isLayoutRow: true,
        liquid: true,
      })
    );
    await waitFor(() =>
      expect(result.current).toEqual({ undeclared: [], missing: [] })
    );
  });

  it("asks an ordinary body to declare the brand's other spelling", async () => {
    // Only `brand` and `nextly_brand` are free to a body; anything else,
    // including a misspelled brand, is the sender's to pass.
    const { result } = renderHook(() =>
      useTemplateVariables({
        sources: ["Footer {{ Brand.footer }}"],
        declared: [],
        data: {},
        isLayoutRow: false,
        liquid: true,
      })
    );
    await waitFor(() =>
      expect(result.current.undeclared).toEqual([
        { name: "Brand", paths: ["Brand.footer"] },
      ])
    );
  });

  it("reads a kept template as the old editor did, and judges nothing blank", async () => {
    // A template kept on the previous engine is not the analysis's to parse:
    // its bare {{names}} are listed as the old editor read them — a filtered
    // use is invisible to that reading, by design — and nothing is judged
    // blank, because the old engine's fallbacks are not Liquid's.
    const { result } = renderHook(() =>
      useTemplateVariables({
        sources: ["Total {{ order.total | default: '0' }} and {{ who }}"],
        declared: [],
        data: {},
        isLayoutRow: false,
        liquid: false,
      })
    );
    await waitFor(() =>
      expect(result.current).toEqual({
        undeclared: [{ name: "who", paths: ["who"] }],
        missing: [],
      })
    );
  });

  it("always reads envelope fields (From, Reply-To) with Liquid, even for a kept template", async () => {
    // `fromOverride` and `replyTo` are always rendered by the Liquid engine:
    // the body engine flag must not send them through the legacy regex path.
    const { result } = renderHook(() =>
      useTemplateVariables({
        sources: ["{{ body_only }}"],
        liquidSources: ["{{ from_field }}", "{{ reply_field }}"],
        declared: [],
        data: {},
        isLayoutRow: false,
        liquid: false,
      })
    );
    // Liquid analysis lists the envelope names through usedVariables; the body
    // falls back to the legacy regex and lists `body_only` through {{…}} matching.
    await waitFor(() =>
      expect(result.current.undeclared.map(u => u.name).sort()).toEqual([
        "body_only",
        "from_field",
        "reply_field",
      ])
    );
  });
});
