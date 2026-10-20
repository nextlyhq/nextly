/**
 * Liquid's escaping is a security boundary: data must never become markup.
 *
 * Every output position is tried with hostile values (script, attribute
 * breaking, entities, a forged mark), every filter LiquidJS registers is run
 * over them, and the ways an author could reach unescaped output or a file
 * are shown to be refused.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import {
  LIQUID_LIMITS,
  liquidFilterNames,
  liquidTagNames,
  markHtml,
  parseLiquid,
  renderLiquid,
  TrustedHtml,
  writesOutput,
} from "../services/liquid-engine";
import { oldEngineReason } from "../services/liquid-compat";
import { renderTemplate } from "../services/render-template";

const SCRIPT = `<script>alert("x")</script>`;
const ATTRIBUTE = `" onmouseover="alert(1)" x='`;
const ENTITY = "&lt;b&gt; &amp; &#60;i&#62;";
const TAG_TEXT = "{% if true %}tag{% endif %}{{ secret }}";

const hostile = {
  name: SCRIPT,
  attr: ATTRIBUTE,
  entity: ENTITY,
  tagText: TAG_TEXT,
  list: [SCRIPT, ATTRIBUTE],
  object: { name: SCRIPT, nested: { attr: ATTRIBUTE } },
  secret: "the secret",
};

/** No markup character reached the output unescaped. */
function expectInert(out: string, allowedMarkup: string[] = []): void {
  let stripped = out;
  for (const markup of allowedMarkup)
    stripped = stripped.split(markup).join("");
  expect(stripped).not.toMatch(/[<>"']/);
}

const render = (source: string, data: Record<string, unknown> = hostile) =>
  renderLiquid(source, data, "html");

describe("output is escaped in every position", () => {
  it.each([
    ["output", "{{ name }}"],
    ["a nested path", "{{ object.nested.attr }}"],
    ["a list item", "{{ list[0] }}{{ list.first }}{{ list.last }}"],
    ["a whole list", "{{ list }}"],
    ["inside a loop", "{% for item in list %}{{ item }}{% endfor %}"],
    ["inside a condition", "{% if name %}{{ name }}{% endif %}"],
    ["after assign", "{% assign x = name %}{{ x }}"],
    ["after capture", "{% capture x %}{{ name }}{% endcapture %}{{ x }}"],
    [
      "a case value",
      "{% case name %}{% when 'a' %}a{% else %}{{ name }}{% endcase %}",
    ],
    ["a default", "{{ missing | default: name }}"],
    ["a tablerow", "{% tablerow item in list %}{{ item }}{% endtablerow %}"],
  ])("%s", (_label, source) => {
    const out = render(source);
    expectInert(out, [
      '<tr class="row1">',
      '<td class="col1">',
      '<td class="col2">',
      "</td>",
      "</tr>",
    ]);
    expect(out).not.toContain("<script");
  });

  it("escapes inside an attribute, so a value cannot close it", () => {
    const out = render(`<a href="{{ attr }}" title='{{ attr }}'>x</a>`);
    expect(out).toBe(
      `<a href="&quot; onmouseover=&quot;alert(1)&quot; x=&#39;" title='&quot; onmouseover=&quot;alert(1)&quot; x=&#39;'>x</a>`
    );
  });

  it("escapes an entity in data rather than letting it decode", () => {
    expect(render("{{ entity }}")).toBe(
      "&amp;lt;b&amp;gt; &amp;amp; &amp;#60;i&amp;#62;"
    );
  });

  it("never reads Liquid that arrives in data", () => {
    expect(render("{{ tagText }}")).toBe(
      "{% if true %}tag{% endif %}{{ secret }}"
    );
  });
});

describe("escaped once, never twice", () => {
  // The inert checks above pass for doubly escaped output too; these pin the
  // exact text a recipient sees.
  it("writes a captured value as captured", () => {
    expect(
      render("{% capture x %}<p>{{ name }}</p>{% endcapture %}{{ x }}", {
        name: "<b>A & B</b>",
      })
    ).toBe("<p>&lt;b&gt;A &amp; B&lt;/b&gt;</p>");
  });

  it("keeps a captured value a string to compare, measure and read", () => {
    expect(
      render(
        "{% capture state %}paid{% endcapture %}{% if state == 'paid' %}yes{% endif %}" +
          "{% case state %}{% when 'paid' %}case{% endcase %}" +
          "{% if state contains 'ai' %}has{% endif %}" +
          "{{ state.size }}{{ state | size }}{{ state | upcase }}"
      )
    ).toBe("yescasehas44PAID");
  });

  it("keeps the mark through a default that hands it back", () => {
    expect(
      render(
        "{% capture x %}<p>{{ name }}</p>{% endcapture %}{{ x | default: 'none' }}",
        { name: "A & B" }
      )
    ).toBe("<p>A &amp; B</p>");
  });

  it("writes escape's result once", () => {
    expect(render("{{ name | escape }}", { name: "<b>A & B</b>" })).toBe(
      "&lt;b&gt;A &amp; B&lt;/b&gt;"
    );
  });

  it("leaves an existing entity alone with escape_once", () => {
    expect(render("{{ name | escape_once }}", { name: "A &amp; B <i>" })).toBe(
      "A &amp; B &lt;i&gt;"
    );
  });
});

describe("every filter keeps the output escaped", () => {
  // Every filter this engine has, run over hostile input. A filter that
  // skipped escaping, or produced markup from data, would leave a raw
  // character behind.
  const filters = liquidFilterNames();

  it("has filters to test (the instrument control)", () => {
    expect(filters.length).toBeGreaterThan(40);
    expect(filters).toContain("escape");
  });

  it.each(filters)("%s", filter => {
    const args = FILTER_ARGS[filter] ?? "";
    // Each input on its own: a refusal of one must not hide what the filter
    // wrote for another.
    for (const input of ["name", "list", "attr"]) {
      let out: string;
      try {
        out = render(`{{ ${input} | ${filter}${args} }}`);
      } catch (error) {
        // A filter that refuses this input writes nothing at all.
        expect(error).toBeInstanceOf(NextlyError);
        continue;
      }
      expectInert(out);
    }
  });

  it("has no filter that turns escaping off", () => {
    expect(filters).not.toContain("raw");
    expect(parseLiquid("{{ name | raw }}")).toHaveProperty("problem");
  });
});

describe("pre-rendered HTML only from code", () => {
  it("writes a value code marked as it is", () => {
    expect(render("{{ body }}", { body: markHtml("<b>bold</b>") })).toBe(
      "<b>bold</b>"
    );
  });

  it("escapes anything shaped like a mark that code did not make", () => {
    const forged = [
      { html: "<b>x</b>" },
      { __html: "<b>x</b>" },
      Object.create(TrustedHtml.prototype) as object,
      JSON.parse(JSON.stringify(markHtml("<b>x</b>"))) as object,
    ];
    for (const value of forged) {
      expectInert(render("{{ body }}", { body: value }));
    }
  });

  it("compares a marked value as its markup", () => {
    expect(
      render("{% if body == '<b>x</b>' %}same{% endif %}{{ body.size }}", {
        body: markHtml("<b>x</b>"),
      })
    ).toBe("same8");
  });

  it("loses the mark once a filter has changed the value", () => {
    expectInert(
      render("{{ body | append: '' }}", { body: markHtml("<b>x</b>") })
    );
  });

  it("writes a marked value as text outside HTML", () => {
    expect(
      renderLiquid(
        "{{ body }}",
        { body: markHtml("<p>Hi <b>there</b></p>") },
        "text"
      )
    ).toBe("Hi there");
  });
});

describe("no files, no unescaped writers", () => {
  it.each([
    ["include", "{% include 'secrets' %}"],
    ["render", "{% render 'secrets' %}"],
    ["layout", "{% layout 'base' %}"],
    ["block", "{% block x %}{% endblock %}"],
    ["echo", "{% echo name %}"],
    ["liquid", "{% liquid\necho name %}"],
    ["cycle", "{% cycle name, attr %}"],
  ])("refuses %s", (label, source) => {
    expect(liquidTagNames()).not.toContain(label);
    expect(parseLiquid(source)).toHaveProperty("problem");
    expect(() => render(source)).toThrow(NextlyError);
  });
});

describe("limits", () => {
  it("stops a runaway loop and names the limit", () => {
    const source = "{% for i in (1..100000000) %}{{ name }}{% endfor %}";
    let caught: unknown;
    try {
      render(source);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NextlyError);
    const error = caught as NextlyError;
    expect(error.logContext).toMatchObject({ retryable: false });
    expect(String(error.logContext?.limit)).toMatch(/render (time|memory)/);
    expect(error.publicMessage).toMatch(/limit/);
  });

  it("refuses a template larger than the size limit", () => {
    const parsed = parseLiquid("x".repeat(LIQUID_LIMITS.parseLimit + 1));
    expect(parsed).toHaveProperty("problem");
    expect(
      (parsed as { problem: { message: string } }).problem.message
    ).toMatch(/template size/);
  });
});

describe("lines and contexts", () => {
  it("removes line breaks from a subject, whatever the data holds", () => {
    expect(
      renderLiquid("Re: {{ v }}", { v: "a\r\nBcc: x@example.com\nb" }, "line")
    ).toBe("Re: a Bcc: x@example.com b");
  });

  it("leaves plain text unescaped", () => {
    expect(renderLiquid("{{ v }}", { v: "Tom & Jerry <3" }, "text")).toBe(
      "Tom & Jerry <3"
    );
  });

  it("reports the line of a problem", () => {
    const parsed = parseLiquid("<p>one</p>\n<p>{% if x %}</p>");
    expect(parsed).toMatchObject({ problem: { line: 2 } });
  });
});

describe("a layout's body", () => {
  it("is placed whatever the layout assigns or the data holds", () => {
    const template = {
      subject: "Hi",
      htmlContent: "<p>BODY</p>",
      plainTextContent: null,
      preheader: null,
      useLayout: true,
      kind: "template" as const,
    };
    const layout = {
      subject: "",
      htmlContent:
        "{% assign nextly_layout_body = 'lost' %}{% capture x %}y{% endcapture %}<div>{{content}}</div>",
      plainTextContent: null,
      preheader: null,
      useLayout: false,
      kind: "layout" as const,
    };
    const out = renderTemplate(
      template,
      layout,
      { nextly_layout_body: "<b>data</b>" },
      { appName: "Shop" }
    );
    expect(out.html).toBe("<div><p>BODY</p></div>");
  });
});

describe("where a layout's body marker is written", () => {
  const MARKER = "{{content}}";

  it("finds the marker at the top level and in a block that renders in place", () => {
    expect(writesOutput("<div>{{content}}</div>", MARKER)).toBe(true);
    expect(
      writesOutput("{% if a %}x{% else %}{{content}}{% endif %}", MARKER)
    ).toBe(true);
    expect(
      writesOutput("{% case a %}{% when 1 %}{{content}}{% endcase %}", MARKER)
    ).toBe(true);
  });

  it("refuses the marker where nothing writes it", () => {
    expect(
      writesOutput("{% assign x = '{{content}}' %}<p>layout</p>", MARKER)
    ).toBe(false);
    expect(writesOutput("{% raw %}{{content}}{% endraw %}", MARKER)).toBe(
      false
    );
    expect(
      writesOutput("{% comment %}{{content}}{% endcomment %}", MARKER)
    ).toBe(false);
    expect(
      writesOutput("{% capture c %}{{content}}{% endcapture %}", MARKER)
    ).toBe(false);
    // An output that filters the marker isn't the marker the splice replaces.
    expect(writesOutput("{{content | upcase}}", MARKER)).toBe(false);
  });
});

describe("what the old engine read differently", () => {
  it("flags a path through a property only the prototype has", () => {
    // The old engine read inherited properties; Liquid reads own ones only.
    expect(oldEngineReason("<p>{{user.constructor}}</p>")).not.toBeNull();
    expect(oldEngineReason("<p>{{order.toString}}</p>")).not.toBeNull();
    // The control: an ordinary path reads the same.
    expect(oldEngineReason("<p>{{user.name}}</p>")).toBeNull();
  });

  it("flags a root the data object only inherits, and nothing else at the root", () => {
    expect(oldEngineReason("<p>{{constructor}}</p>")).not.toBeNull();
    expect(oldEngineReason("<p>{{toString}}</p>")).not.toBeNull();
    // The data is a plain object: a string's or a list's own names are
    // ordinary variables there.
    expect(oldEngineReason("<p>{{link}}</p>")).toBeNull();
    expect(oldEngineReason("<p>{{length}}</p>")).toBeNull();
  });
});

describe("lists, objects and branches", () => {
  it("renders a commerce-shaped template: order lines and a paid or due branch", () => {
    const template = {
      subject: "Order #{{ order.number }}: {{ order.lines | size }} items",
      htmlContent: [
        "<ul>{% for line in order.lines %}<li>{{ line.quantity }} × {{ line.title }}: {{ line.total }}</li>{% endfor %}</ul>",
        "{% if order.balance_due > 0 %}<p>Still to pay: {{ order.balance_due }}</p>{% else %}<p>Paid in full.</p>{% endif %}",
      ].join("\n"),
      plainTextContent: null,
      preheader: null,
      useLayout: false,
      kind: "template" as const,
    };
    const order = (balance: number) => ({
      order: {
        number: 1042,
        balance_due: balance,
        lines: [
          { quantity: 1, title: "Tent <2 person>", total: "189.00" },
          { quantity: 2, title: "Socks", total: "36.00" },
        ],
      },
    });

    const due = renderTemplate(template, null, order(125), { appName: "Shop" });
    expect(due.subject).toBe("Order #1042: 2 items");
    expect(due.html).toContain(
      "<li>1 × Tent &lt;2 person&gt;: 189.00</li><li>2 × Socks: 36.00</li>"
    );
    expect(due.html).toContain("<p>Still to pay: 125</p>");

    const paid = renderTemplate(template, null, order(0), { appName: "Shop" });
    expect(paid.html).toContain("<p>Paid in full.</p>");
    expect(paid.html).not.toContain("Still to pay");
  });
});

/** Arguments for filters that need them. */
const FILTER_ARGS: Record<string, string> = {
  append: ": '<b>'",
  prepend: ": '<b>'",
  concat: ": list",
  date: ": '%Y'",
  default: ": '<b>'",
  divided_by: ": 2",
  find: ": 'x', 'y'",
  find_exp: ": 'i', 'i'",
  find_index: ": 'x', 'y'",
  find_index_exp: ": 'i', 'i'",
  group_by: ": 'x'",
  group_by_exp: ": 'i', 'i'",
  has: ": 'x', 'y'",
  has_exp: ": 'i', 'i'",
  join: ": '<b>'",
  map: ": 'name'",
  minus: ": 1",
  modulo: ": 2",
  plus: ": 1",
  push: ": '<b>'",
  reject: ": 'x'",
  reject_exp: ": 'i', 'i'",
  remove: ": 'x'",
  remove_first: ": 'x'",
  remove_last: ": 'x'",
  replace: ": 'a', '<b>'",
  replace_first: ": 'a', '<b>'",
  replace_last: ": 'a', '<b>'",
  slice: ": 0, 3",
  sort: "",
  split: ": ','",
  times: ": 2",
  truncate: ": 5",
  truncatewords: ": 2",
  unshift: ": '<b>'",
  where: ": 'x'",
  where_exp: ": 'i', 'i'",
  at_least: ": 1",
  at_most: ": 1",
};
