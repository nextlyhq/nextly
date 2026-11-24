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
      order: { lines: [], note: "Leave it" },
    }).map(u => u.path);
    // `customer.name` has a fallback; `order.note` has a value; `order.gift`
    // is only tested. `currency` renders blank.
    expect(missing).toEqual(["currency"]);
    // A field cleared in the Data panel is an empty text: nothing is printed.
    expect(
      missingValues(ORDER, {
        order: { lines: [], note: "" },
        currency: "EUR",
      }).map(u => u.path)
    ).toEqual(["order.note"]);
  });

  it("leaves out the names it is told to ignore", () => {
    expect(
      missingValues("{{ appName }} {{ x }}", {}, new Set(["appName"])).map(
        u => u.path
      )
    ).toEqual(["x"]);
  });

  it("judges a variable fallback with the use: blank only when both have no value", () => {
    const source = "Notes: {{ order.notes | default: customer.support }}";
    // Neither the use nor its fallback has a value: the output renders
    // blank, and the use says so.
    expect(missingValues(source, {}).map(u => u.path)).toEqual(["order.notes"]);
    // The fallback answers, so the output is not blank.
    expect(
      missingValues(source, { customer: { support: "help@northwind.io" } }).map(
        u => u.path
      )
    ).toEqual([]);
    // The use's own value answers, whatever the fallback holds.
    expect(
      missingValues(source, { order: { notes: "Left at the door" } }).map(
        u => u.path
      )
    ).toEqual([]);
  });

  it.each([
    ["an explicit empty default", '{{ note | default: "" }}'],
    ["an explicit nil default", "{{ note | default: nil }}"],
    ["any text as a default", '{{ note | default: "none" }}'],
    [
      "an empty default after a variable",
      '{{ note | default: b | default: "" }}',
    ],
  ])("takes %s as the author's say, whatever the value", (_what, source) => {
    for (const data of [{}, { note: null }, { note: "" }, { note: false }]) {
      expect(missingValues(source, data)).toEqual([]);
    }
  });

  it("does not mark a variable only tested, or one the template never prints", () => {
    expect(missingValues("{% if note %}Yes{% endif %}", { note: "" })).toEqual(
      []
    );
    expect(missingValues("Hi", { note: "" })).toEqual([]);
  });

  const VALUES = [
    undefined,
    null,
    "",
    " ",
    "x",
    0,
    false,
    true,
    [],
    [""],
    ["x"],
  ];
  it.each([
    "{{ a }}",
    "{{ a | default: b }}",
    "{{ a | default: b, allow_false: true }}",
    "{{ a | default: b, allow_false: false }}",
    "{{ a | default: b | default: c }}",
  ])("marks %s exactly where the engine prints nothing", source => {
    const engine = new Liquid({ ownPropertyOnly: true });
    for (const a of VALUES) {
      for (const b of VALUES) {
        for (const c of ["", "y"]) {
          const data = { a, b, c };
          expect(
            missingValues(source, data).length > 0,
            JSON.stringify({ source, data })
          ).toBe(engine.parseAndRenderSync(source, data) === "");
        }
      }
    }
  });

  it.each([
    ["{{ a | upcase }}", true],
    ['{{ a | append: "!" }}', false],
    ["{{ a | append: suffix }}", false],
    ['{{ a | prepend: "Dear " | upcase }}', false],
  ])(
    "judges an empty text in %s by what its filters print",
    (source, blank) => {
      expect(missingValues(source, { a: "", suffix: "" }).length > 0).toBe(
        blank
      );
    }
  );

  it("never judges a default argument on its own", () => {
    // A fallback variable is written to serve another use, never to render
    // alone: with no value of its own it is not reported blank.
    const source = "Hi {{ customer.name | default: user.nickname }}";
    expect(missingValues(source, {}).map(u => u.path)).toEqual([
      "customer.name",
    ]);
    expect(
      missingValues(source, { customer: { name: "Priya" } }).map(u => u.path)
    ).toEqual([]);
  });

  it("does not mark a filter argument as a written output use", () => {
    // `suffix` is consumed by `append`, not rendered as the output's value:
    // it must not be reported blank when it has no sample value.
    const source =
      '{% unless closed %}{{ "Hello " | append: suffix }}{% endunless %}';
    expect(missingValues(source, {}).map(u => u.path)).toEqual([]);
    // `name` is the output's own value and renders blank when absent.
    expect(missingValues("{{ name | upcase }}", {}).map(u => u.path)).toEqual([
      "name",
    ]);
  });

  it("reads list properties as Liquid does", () => {
    const data = { order: { lines: [{ title: "Tea" }, { title: "Cake" }] } };
    expect(valueAt(data, ["order", "lines", "size"])).toBe(2);
    expect(valueAt(data, ["order", "lines", "first", "title"])).toBe("Tea");
    expect(valueAt(data, ["order", "lines", 1, "title"])).toBe("Cake");
    expect(valueAt(data, ["order", "missing", "title"])).toBeUndefined();
  });

  it.each([
    ["a text's size", "{{ a.size }}", { a: "Tea" }],
    ["an empty text's size", "{{ a.size }}", { a: "" }],
    ["a text's first", "{{ a.first }}", { a: "Tea" }],
    ["an object's size", "{{ a.size }}", { a: { x: 1 } }],
    ["an object's own size", "{{ a.size }}", { a: { size: "XL" } }],
    ["an object's own first", "{{ a.first }}", { a: { first: "Ada" } }],
    ["a list's size", "{{ a.size }}", { a: [] }],
    ["a list's last", "{{ a.last }}", { a: ["x"] }],
    ["a number's size", "{{ a.size }}", { a: 5 }],
  ])("reads %s as the engine does", (_what, source, data) => {
    // Marked exactly where the engine prints nothing.
    const printed = new Liquid({ ownPropertyOnly: true }).parseAndRenderSync(
      source,
      data
    );
    expect(missingValues(source, data)).toHaveLength(printed === "" ? 1 : 0);
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
