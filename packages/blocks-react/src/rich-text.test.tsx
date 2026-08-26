// @vitest-environment jsdom
import { TEXT_FORMAT, type RichTextValue } from "@nextlyhq/blocks-engine";
import { render, screen } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RichText } from "./rich-text";

afterEach(cleanup);

const doc = (children: RichTextValue["root"]["children"]): RichTextValue => ({
  root: { type: "root", children },
});

const para = (text: string, format?: number) =>
  doc([
    {
      type: "paragraph",
      children: [
        { type: "text", text, ...(format === undefined ? {} : { format }) },
      ],
    },
  ]);

describe("RichText", () => {
  it("renders text inside its block element", () => {
    const { container } = render(<RichText value={para("Hello")} />);
    expect(container.querySelector("p")?.textContent).toBe("Hello");
  });

  it("applies the format bits the CMS serializer reads", () => {
    // The SAME constants the HTML serializer uses, imported from the engine.
    // If the two ever disagreed this is where it would show, which is the whole
    // reason the bits are shared rather than re-declared.
    const { container } = render(
      <RichText value={para("loud", TEXT_FORMAT.BOLD | TEXT_FORMAT.ITALIC)} />
    );
    expect(container.querySelector("strong em")?.textContent).toBe("loud");
  });

  it("renders nothing for a value that is not rich text", () => {
    // A prop's stored type is whatever was saved: a plain string from before a
    // field became rich, a null, an empty object. None of those may throw on a
    // live page.
    for (const other of ["text", 0, null, undefined, {}, []]) {
      const { container } = render(<RichText value={other} />);
      expect(container.textContent, JSON.stringify(other)).toBe("");
      cleanup();
    }
  });

  it("keeps the words of a node type it does not know", () => {
    // Dropping an unknown node deletes an author's content silently; refusing
    // takes the page down for one unrecognised paragraph.
    render(
      <RichText
        value={doc([
          {
            type: "some-future-node",
            children: [{ type: "text", text: "still here" }],
          },
        ])}
      />
    );
    expect(screen.getByText("still here")).toBeDefined();
  });

  it("renders a link, and renders one without a url as plain text", () => {
    const { container } = render(
      <RichText
        value={doc([
          { type: "link", url: "/x", children: [{ type: "text", text: "go" }] },
          { type: "link", children: [{ type: "text", text: "nowhere" }] },
        ])}
      />
    );
    expect(container.querySelector('a[href="/x"]')?.textContent).toBe("go");
    // An anchor with no destination is announced as a link by a screen reader
    // and goes nowhere when followed.
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.textContent).toContain("nowhere");
  });

  it("falls back to h2 for a heading whose tag is not one", () => {
    const { container } = render(
      <RichText
        value={doc([
          {
            type: "heading",
            tag: "h9",
            children: [{ type: "text", text: "t" }],
          },
        ])}
      />
    );
    expect(container.querySelector("h2")?.textContent).toBe("t");
  });

  it("renders ordered and unordered lists by listType", () => {
    const list = (listType: string) =>
      doc([
        {
          type: "list",
          listType,
          children: [
            { type: "listitem", children: [{ type: "text", text: "i" }] },
          ],
        },
      ]);
    expect(
      render(<RichText value={list("number")} />).container.querySelector(
        "ol li"
      )
    ).toBeTruthy();
    cleanup();
    expect(
      render(<RichText value={list("bullet")} />).container.querySelector(
        "ul li"
      )
    ).toBeTruthy();
  });
});

describe("RichText link destinations", () => {
  // A stored URL reaching an `href` is the one place in this format where a
  // value executes rather than merely displays, so each of these is a scheme
  // that navigates to attacker-controlled code if it survives to the attribute.
  const dangerous = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "blob:https://example.test/9f8c",
    // Split by a tab so a naive scheme reader sees no scheme while a browser
    // strips the tab and resolves one.
    "java\tscript:alert(1)",
    "  javascript:alert(1)",
  ];

  it.each(dangerous)("refuses %j and keeps the words", url => {
    const { container } = render(
      <RichText
        value={doc([
          {
            type: "paragraph",
            children: [
              {
                type: "link",
                url,
                children: [{ type: "text", text: "click" }],
              },
            ],
          },
        ])}
      />
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("click");
  });

  it("keeps the destinations an author actually writes", () => {
    for (const url of [
      "https://example.test/a",
      "http://example.test",
      "mailto:a@example.test",
      "tel:+15551234",
      "/about",
      "#section",
    ]) {
      const { container } = render(
        <RichText
          value={doc([
            {
              type: "paragraph",
              children: [
                { type: "link", url, children: [{ type: "text", text: "go" }] },
              ],
            },
          ])}
        />
      );
      expect(container.querySelector("a")?.getAttribute("href"), url).toBe(url);
      cleanup();
    }
  });

  it("carries the target the author chose, with the rel that makes it safe", () => {
    // `_blank` hands the opened page a handle on this one unless `noopener`
    // says otherwise, so the two travel together.
    const { container } = render(
      <RichText
        value={doc([
          {
            type: "paragraph",
            children: [
              {
                type: "link",
                url: "https://example.test",
                target: "_blank",
                children: [{ type: "text", text: "go" }],
              },
            ],
          },
        ])}
      />
    );
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toContain("noopener");
    expect(anchor?.getAttribute("rel")).toContain("noreferrer");
  });

  it("ignores a stored target that names a frame on this page", () => {
    const { container } = render(
      <RichText
        value={doc([
          {
            type: "paragraph",
            children: [
              {
                type: "link",
                url: "https://example.test",
                target: "some-frame",
                children: [{ type: "text", text: "go" }],
              },
            ],
          },
        ])}
      />
    );
    expect(container.querySelector("a")?.getAttribute("target")).toBeNull();
  });
});

describe("RichText malformed storage", () => {
  it("renders the surviving content when a child is not a node", () => {
    // Storage holds parsed JSON, and JSON can put a null in an array the type
    // says holds nodes. Reading `.text` off it throws during the render of a
    // published page.
    const value = {
      root: {
        type: "root",
        children: [
          null,
          "not a node",
          42,
          { type: "paragraph", children: [{ type: "text", text: "kept" }] },
        ],
      },
    } as unknown as RichTextValue;
    const { container } = render(<RichText value={value} />);
    expect(container.textContent).toBe("kept");
  });

  it("renders nothing for a root whose children are not an array", () => {
    const value = { root: { type: "root" } } as unknown as RichTextValue;
    const { container } = render(<RichText value={value} />);
    expect(container.textContent).toBe("");
  });
});

describe("RichText structural nodes", () => {
  it("draws the case formats as a transform rather than a tag", () => {
    for (const [flag, expected] of [
      [TEXT_FORMAT.LOWERCASE, "lowercase"],
      [TEXT_FORMAT.UPPERCASE, "uppercase"],
      [TEXT_FORMAT.CAPITALIZE, "capitalize"],
    ] as const) {
      const { container } = render(<RichText value={para("word", flag)} />);
      expect(
        container.querySelector("span")?.style.textTransform,
        expected
      ).toBe(expected);
      cleanup();
    }
  });

  it("renders a horizontal rule, which has no children to fall back on", () => {
    const { container } = render(
      <RichText value={doc([{ type: "horizontalrule" }])} />
    );
    expect(container.querySelector("hr")).not.toBeNull();
  });

  it("renders a table with the tbody a browser would insert anyway", () => {
    const { container } = render(
      <RichText
        value={doc([
          {
            type: "table",
            children: [
              {
                type: "tablerow",
                children: [
                  {
                    type: "tablecell",
                    headerState: 1,
                    children: [{ type: "text", text: "Head" }],
                  },
                  {
                    type: "tablecell",
                    headerState: 0,
                    children: [{ type: "text", text: "Cell" }],
                  },
                ],
              },
            ],
          },
        ])}
      />
    );
    expect(container.querySelector("table > tbody > tr")).not.toBeNull();
    expect(container.querySelector("th")?.textContent).toBe("Head");
    expect(container.querySelector("td")?.textContent).toBe("Cell");
  });

  it("renders a collapsible as details and summary", () => {
    const { container } = render(
      <RichText
        value={doc([
          {
            type: "collapsible-container",
            children: [
              {
                type: "collapsible-title",
                children: [{ type: "text", text: "More" }],
              },
              {
                type: "collapsible-content",
                children: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", text: "Body" }],
                  },
                ],
              },
            ],
          },
        ])}
      />
    );
    expect(container.querySelector("details > summary")?.textContent).toBe(
      "More"
    );
    expect(container.querySelector("details > div p")?.textContent).toBe(
      "Body"
    );
  });

  it("renders a code block as pre and code", () => {
    const { container } = render(
      <RichText
        value={doc([
          { type: "code", children: [{ type: "text", text: "const a = 1;" }] },
        ])}
      />
    );
    expect(container.querySelector("pre > code")?.textContent).toBe(
      "const a = 1;"
    );
  });
});

describe("RichText hostile stored node types", () => {
  // `node.type` is a string from storage and the renderer's dispatch tables are
  // object literals, so an inherited member is reachable by name unless the
  // lookup asks for own keys only.
  it.each([
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "__proto__",
  ])("treats %j as an unknown node rather than an inherited member", type => {
    const { container } = render(
      <RichText
        value={doc([{ type, children: [{ type: "text", text: "kept" }] }])}
      />
    );
    expect(container.textContent).toBe("kept");
  });
});

describe("RichText malformed nested children", () => {
  it.each([
    ["an object", {}],
    ["a string", "oops"],
    ["a number", 7],
    ["null", null],
  ])("renders nothing for children that are %s", (_label, badChildren) => {
    const value = doc([
      { type: "paragraph", children: badChildren },
      { type: "paragraph", children: [{ type: "text", text: "kept" }] },
    ] as unknown as RichTextValue["root"]["children"]);
    const { container } = render(<RichText value={value} />);
    expect(container.textContent).toBe("kept");
  });
});

describe("RichText preserved node attributes", () => {
  it("keeps a heading at the level the author chose", () => {
    // Paired with the fallback case: without this, a HeadingView that ignored
    // `tag` entirely and always returned h2 would still pass.
    for (const tag of ["h1", "h3", "h6"]) {
      const { container } = render(
        <RichText
          value={doc([
            { type: "heading", tag, children: [{ type: "text", text: "T" }] },
          ])}
        />
      );
      expect(container.querySelector(tag), tag).not.toBeNull();
      cleanup();
    }
  });

  it("keeps an ordered list's starting number", () => {
    const { container } = render(
      <RichText
        value={doc([
          {
            type: "list",
            listType: "number",
            start: 5,
            children: [
              { type: "listitem", children: [{ type: "text", text: "five" }] },
            ],
          },
        ])}
      />
    );
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("5");
  });

  it("omits start for a value the attribute could not carry", () => {
    for (const start of [0, -3, 1.5, "5", null]) {
      const { container } = render(
        <RichText
          value={doc([
            {
              type: "list",
              listType: "number",
              start,
              children: [
                { type: "listitem", children: [{ type: "text", text: "x" }] },
              ],
            },
          ] as unknown as RichTextValue["root"]["children"])}
        />
      );
      expect(
        container.querySelector("ol")?.getAttribute("start"),
        `${JSON.stringify(start)}`
      ).toBeNull();
      cleanup();
    }
  });

  it("keeps a collapsible open when the author left it open", () => {
    const open = render(
      <RichText
        value={doc([
          {
            type: "collapsible-container",
            open: true,
            children: [
              {
                type: "collapsible-title",
                children: [{ type: "text", text: "T" }],
              },
            ],
          },
        ])}
      />
    );
    expect(open.container.querySelector("details")?.hasAttribute("open")).toBe(
      true
    );
    cleanup();

    const shut = render(
      <RichText
        value={doc([
          {
            type: "collapsible-container",
            open: false,
            children: [
              {
                type: "collapsible-title",
                children: [{ type: "text", text: "T" }],
              },
            ],
          },
        ])}
      />
    );
    expect(shut.container.querySelector("details")?.hasAttribute("open")).toBe(
      false
    );
  });

  it("gives a syntax token the class the CMS gives it", () => {
    const { container } = render(
      <RichText
        value={doc([
          {
            type: "code",
            children: [
              {
                type: "code-highlight",
                text: "const",
                highlightType: "keyword",
              },
              { type: "code-highlight", text: " x", highlightType: "!bad!" },
            ],
          },
        ])}
      />
    );
    const token = container.querySelector("span.nextly-code-token--keyword");
    expect(token?.textContent).toBe("const");
    // A type the engine refuses renders as text, not as an empty-class span.
    expect(container.querySelectorAll("span").length).toBe(1);
    expect(container.querySelector("pre > code")?.textContent).toBe("const x");
  });
});

/*
 * The MEDIA leaves.
 *
 * Each keeps its content in its own fields rather than in `children`, so the
 * unknown-node fallback drew them as nothing at all: an author placed an image
 * in their prose, saw it in the editor, and the published page had no trace of
 * it. Shapes below are the editor's `exportJSON` output, field for field.
 */
const IMAGE_SRC = "https://cdn.example.com/photo.jpg";

const image = (extra: Record<string, unknown> = {}) =>
  doc([
    {
      type: "image",
      version: 1,
      src: IMAGE_SRC,
      altText: "A photo",
      ...extra,
    },
  ] as unknown as RichTextValue["root"]["children"]);

describe("rich-text media leaves", () => {
  it("draws an image an author placed in their prose", () => {
    /*
     * The population before every property below: this document really does
     * reach an `<img>`, so a later assertion that some variant renders NOTHING
     * is a statement about that variant rather than about media never working.
     */
    const { container } = render(<RichText value={image()} />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(IMAGE_SRC);
    expect(img?.getAttribute("alt")).toBe("A photo");
  });

  it("writes an EMPTY alt when the author described nothing", () => {
    // Absent, a screen reader announces the file name, which is worse than
    // silence. An undescribed image inside prose is decorative far more often
    // than it is unlabelled.
    const { container } = render(
      <RichText value={image({ altText: undefined })} />
    );
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("refuses a scheme that could execute, with no policy configured", () => {
    // The scheme filter is NOT part of the operator's bargain: a `javascript:`
    // source is not a site setting. It applies whether or not a policy was
    // passed, which is what this asserts by passing none.
    const { container } = render(
      <RichText value={image({ src: "javascript:alert(1)" })} />
    );
    expect(container.querySelector("img")).toBeNull();
    // And nothing broken is left behind in its place.
    expect(container.querySelector("figure")).toBeNull();
  });

  it("draws an image when the site configured NO fetch list", () => {
    /*
     * `remotePatterns` absent means UNASKED, not allowed-nothing — the
     * semantics `BlockHostPolicy` states for the field. Defaulted closed, every
     * existing site would lose its rich-text images the day this shipped.
     */
    const { container } = render(<RichText value={image()} hostPolicy={{}} />);
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("refuses a host the site's fetch list does not name", () => {
    const { container } = render(
      <RichText
        value={image()}
        hostPolicy={{ remotePatterns: [{ hostname: "images.example.org" }] }}
      />
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("draws it when that same list DOES name the host", () => {
    // The control on the assertion above: without it, a refusal caused by the
    // list being read wrongly is indistinguishable from one caused by the host
    // genuinely not matching.
    const { container } = render(
      <RichText
        value={image()}
        hostPolicy={{ remotePatterns: [{ hostname: "cdn.example.com" }] }}
      />
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe(IMAGE_SRC);
  });

  it("writes both dimensions or neither", () => {
    /*
     * A lone `width` makes a browser compute the other from the intrinsic size,
     * so the space reserved is not the space the author saw and the layout
     * moves as the image loads — the shift this is supposed to prevent.
     */
    const both = render(
      <RichText value={image({ width: 800, height: 600 })} />
    );
    const sized = both.container.querySelector("img");
    expect(sized?.getAttribute("width")).toBe("800");
    expect(sized?.getAttribute("height")).toBe("600");
    cleanup();

    const lone = render(<RichText value={image({ width: 800 })} />);
    const half = lone.container.querySelector("img");
    expect(half).not.toBeNull();
    expect(half?.getAttribute("width")).toBeNull();
    expect(half?.getAttribute("height")).toBeNull();
  });

  it("writes neither dimension when one is not a usable number", () => {
    /*
     * The other half of "both or neither", and a separate case: the test above
     * omits `height` entirely and is answered by the type guard, so it never
     * reaches the bounds check. A value that IS a number and still yields no
     * usable size — the editor recording a division by zero, a caller passing an
     * in-memory object rather than parsed JSON — has to take its partner with
     * it, or the reserved space is computed from one dimension again.
     */
    const { container } = render(
      <RichText value={image({ width: 800, height: Number.NaN })} />
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("width")).toBeNull();
    expect(img?.getAttribute("height")).toBeNull();
  });

  it("drops only the gallery image the site will not fetch", () => {
    /*
     * One refused source must not take the gallery with it: the others are
     * fine, and an author loses a row of pictures over a single bad URL.
     *
     * Population first — three go in, so "two came out" is a statement about
     * the filter rather than about a gallery that never rendered.
     */
    const value = doc([
      {
        type: "gallery",
        version: 1,
        images: [
          { src: "https://cdn.example.com/a.jpg", alt: "A" },
          { src: "javascript:alert(1)", alt: "bad" },
          { src: "https://cdn.example.com/b.jpg", alt: "B" },
        ],
        columns: 3,
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const { container } = render(<RichText value={value} />);
    const found = container.querySelectorAll("img");
    expect(found.length).toBe(2);
    expect([...found].map(el => el.getAttribute("alt"))).toEqual(["A", "B"]);
  });

  it("draws a button as an ANCHOR, never a button element", () => {
    // It navigates, so it must be announced as a link and behave like one —
    // followed by a keyboard, opened in a new tab, its address copied. Looking
    // like a button is a class, not an element.
    const value = doc([
      {
        type: "button-link",
        version: 1,
        url: "https://example.com/buy",
        text: "Buy now",
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const { container } = render(<RichText value={value} />);
    expect(container.querySelector("button")).toBeNull();
    const link = screen.getByRole("link", { name: "Buy now" });
    expect(link.getAttribute("href")).toBe("https://example.com/buy");
  });

  it("leaves no orphaned label when a button's destination is refused", () => {
    // Unlike a link wrapping prose, a button's text IS the button. Left behind
    // as bare words it puts a stray "Buy now" in the middle of an article.
    const value = doc([
      {
        type: "button-link",
        version: 1,
        url: "javascript:alert(1)",
        text: "Buy now",
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const { container } = render(<RichText value={value} />);
    expect(container.textContent).not.toContain("Buy now");
  });

  it("keeps the other buttons when one of a group is refused", () => {
    const value = doc([
      {
        type: "button-group",
        version: 1,
        buttons: [
          { url: "https://example.com/a", text: "Alpha" },
          { url: "javascript:alert(1)", text: "Bad" },
          { url: "https://example.com/b", text: "Beta" },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const { container } = render(<RichText value={value} />);
    const links = container.querySelectorAll("a");
    expect([...links].map(el => el.textContent)).toEqual(["Alpha", "Beta"]);
  });

  it("adds rel protection to a button opening a new tab", () => {
    // The same bargain a link makes: `target="_blank"` without `rel` hands the
    // opened page a handle on this one.
    const value = doc([
      {
        type: "button-link",
        version: 1,
        url: "https://example.com/buy",
        text: "Buy",
        target: "_blank",
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const { container } = render(<RichText value={value} />);
    const rel = container.querySelector("a")?.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
  });
});
