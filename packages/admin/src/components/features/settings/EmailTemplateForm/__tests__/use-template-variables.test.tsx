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
        data: { order: { number: "A-1" } },
        isLayoutRow: false,
      })
    );

    await waitFor(() =>
      expect(result.current.undeclared).toEqual([
        {
          name: "order",
          paths: ["order.number", "order.total", "order.lines"],
        },
        { name: "shop", paths: ["shop.name", "shop.email"] },
      ])
    );
    // Blank: written, no fallback, no value. `order.number` has one,
    // `shop.email` has a fallback, and the send supplies `appName`, `year`
    // and the brand.
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
      })
    );
    await waitFor(() =>
      expect(result.current).toEqual({ undeclared: [], missing: [] })
    );
  });
});
