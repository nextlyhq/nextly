/**
 * The variables a template reads, found from the parsed template: nested
 * paths, loops, tags and filters included, the template's own names left
 * out. And which uses render blank: written out with no fallback and no
 * value. Pinned to the server's engine, so the editor lists what a send reads.
 */
import { Liquid } from "liquidjs";
import { describe, expect, it } from "vitest";

import { parseLiquid } from "../../../../../../../nextly/src/domains/email/services/liquid-engine";
import {
  missingValues,
  usedVariables,
  valueAt,
  variableUses,
} from "../liquid/liquid-variables";

const ORDER = [
  'Hi {{ customer.name | default: "there" }},',
  "{% for line in order.lines %}",
  "  {{ line.title }} x{{ line.qty }} ({{ forloop.index }})",
  "{% endfor %}",
  '{% if order["gift"] %}A gift note: {{ order.note }}{% endif %}',
  "{%- assign total = order.total | round: 2 -%}",
  "Total {{ total }} {{ currency }}",
].join("\n");

const paths = (sources: string[]) => usedVariables(sources).map(u => u.path);

describe("the variables a template reads", () => {
  it("lists full paths, with bracket access read as a path, and leaves out loop items, forloop and assigned names", () => {
    expect(paths([ORDER])).toEqual([
      "customer.name",
      "order.lines",
      "order.gift",
      "order.note",
      "order.total",
      "currency",
    ]);
  });

  it("finds a variable inside every tag, with filters and whitespace control", () => {
    const source = [
      "{%- case plan.tier -%}{%- when 'pro' -%}Pro{%- endcase -%}",
      "{{- user.name | upcase -}}",
      '{% unless account.active %}{{ "x" | append: suffix }}{% endunless %}',
    ].join("\n");
    expect(paths([source])).toEqual([
      "plan.tier",
      "user.name",
      "account.active",
      "suffix",
    ]);
  });

  it("reads every field once, in order", () => {
    expect(
      paths([
        "Order {{ order.number }}",
        "<p>{{ order.number }} {{ name }}</p>",
      ])
    ).toEqual(["order.number", "name"]);
  });

  it("finds nothing in raw text, a comment, or a template that does not parse", () => {
    expect(
      paths([
        "{% raw %}{{ a }}{% endraw %}{% comment %}{{ b }}{% endcomment %}",
      ])
    ).toEqual([]);
    expect(paths(["{{ unclosed"])).toEqual([]);
  });

  it("marks a use written out, with or without a fallback", () => {
    const uses = variableUses(ORDER);
    const first = (path: string) => uses.find(u => u.path === path);
    expect(first("customer.name")).toMatchObject({
      written: true,
      fallback: true,
    });
    expect(first("order.note")).toMatchObject({
      written: true,
      fallback: false,
    });
    // Tested in a tag, never written out.
    expect(first("order.gift")).toMatchObject({ written: false });
    // The mark covers the whole output tag.
    const note = first("order.note");
    expect(ORDER.slice(note?.from, note?.to)).toBe("{{ order.note }}");
  });
});

describe("what renders blank", () => {
  it("is a use written out with no fallback and no value", () => {
    const missing = missingValues(ORDER, {
      order: { lines: [], note: "" },
    }).map(u => u.path);
    // `customer.name` has a fallback; `order.note` has a value, even an empty
    // one; `order.gift` is only tested. `currency` renders blank.
    expect(missing).toEqual(["currency"]);
  });

  it("leaves out the names it is told to ignore", () => {
    expect(
      missingValues("{{ appName }} {{ x }}", {}, new Set(["appName"])).map(
        u => u.path
      )
    ).toEqual(["x"]);
  });

  it("reads list properties as Liquid does", () => {
    const data = { order: { lines: [{ title: "Tea" }, { title: "Cake" }] } };
    expect(valueAt(data, ["order", "lines", "size"])).toBe(2);
    expect(valueAt(data, ["order", "lines", "first", "title"])).toBe("Tea");
    expect(valueAt(data, ["order", "lines", 1, "title"])).toBe("Cake");
    expect(valueAt(data, ["order", "missing", "title"])).toBeUndefined();
  });
});

describe("the editor and the server read the same variables", () => {
  const engine = new Liquid();
  const serverPaths = (source: string) => {
    const parsed = parseLiquid(source);
    if ("problem" in parsed) return [];
    return engine.globalFullVariablesSync(parsed.template);
  };

  it.each([
    ["an order", ORDER],
    ["a welcome", "Welcome {{ user.name }} to {{ appName }} ({{ year }})"],
    [
      "nested loops",
      "{% for g in groups %}{% for i in g.items %}{{ i.name }}{{ page.title }}{% endfor %}{% endfor %}",
    ],
  ])("for %s", (_, source) => {
    expect(paths([source])).toEqual([...new Set(serverPaths(source))]);
  });
});
