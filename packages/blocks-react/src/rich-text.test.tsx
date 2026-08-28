// @vitest-environment jsdom
import {
  INLINE_STYLE_PROPERTIES,
  TEXT_FORMAT,
  type RichTextValue,
} from "@nextlyhq/blocks-engine";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
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
    expect(Array.from(found, el => el.getAttribute("alt"))).toEqual(["A", "B"]);
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
    expect(Array.from(links, el => el.textContent)).toEqual(["Alpha", "Beta"]);
  });

  it("keeps the variant the editor actually serialises", () => {
    /*
     * The editor's vocabulary is `"filled" | "outline"` and a default button
     * serialises `"filled"`. A renderer allowlist that omits it rewrites every
     * default button to something else, and the value has PASSED a check on the
     * way — so the page draws an appearance the author did not choose and
     * nothing reports it.
     */
    const value = doc([
      {
        type: "button-link",
        version: 1,
        url: "https://example.com/buy",
        text: "Buy",
        variant: "filled",
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const { container } = render(<RichText value={value} />);
    expect(container.querySelector("a")?.getAttribute("data-variant")).toBe(
      "filled"
    );
  });

  it("falls back to the editor's OWN defaults, not to invented ones", () => {
    // A node stored before a field existed carries nothing there. Answering
    // `left` where the editor answers `center` moves a button an author never
    // touched, which is a change of appearance dressed as a default.
    const value = doc([
      {
        type: "button-link",
        version: 1,
        url: "https://example.com/buy",
        text: "Buy",
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const { container } = render(<RichText value={value} />);
    expect(container.querySelector("a")?.getAttribute("data-variant")).toBe(
      "filled"
    );
    expect(container.querySelector("a")?.getAttribute("data-size")).toBe("md");
    expect(container.querySelector("p")?.getAttribute("data-align")).toBe(
      "center"
    );
  });

  it("lays the gallery out in the columns the author chose", () => {
    /*
     * The count reached the page as a data attribute and nothing else, and this
     * package ships no stylesheet — so a host that had written no rule for it
     * drew every gallery as one bulleted column whatever the author picked. The
     * count is structural rather than theming: it is the author's choice, not
     * the site's taste, so the renderer owes it.
     *
     * Population first: two columns and four must produce DIFFERENT layouts, or
     * an assertion on one of them passes against a renderer that ignores the
     * value entirely.
     */
    const gallery = (columns: number) =>
      doc([
        {
          type: "gallery",
          version: 1,
          images: [{ src: "https://cdn.example.com/a.jpg", alt: "A" }],
          columns,
        },
      ] as unknown as RichTextValue["root"]["children"]);

    const two = render(<RichText value={gallery(2)} />);
    const twoStyle =
      two.container.querySelector("ul")?.getAttribute("style") ?? "";
    cleanup();
    const four = render(<RichText value={gallery(4)} />);
    const fourStyle =
      four.container.querySelector("ul")?.getAttribute("style") ?? "";

    expect(twoStyle).toContain("grid");
    expect(twoStyle).not.toBe(fourStyle);
    // The count now reaches the page as the FALLBACK of a custom property, so
    // the narrow-screen rule set can lower it without `!important`. It is still
    // the author's number and it still applies when no stylesheet arrives,
    // which is what this test has always been about.
    expect(twoStyle).toContain("repeat(var(--nx-rich-text-gallery-columns, 2)");
    expect(fourStyle).toContain(
      "repeat(var(--nx-rich-text-gallery-columns, 4)"
    );
  });

  it("drops a nonpositive dimension instead of drawing a 1x1 image", () => {
    /*
     * A stored `0` is a FINITE number, so a bound that clamps before it rejects
     * turns it into the minimum and the rejection can never fire — the page then
     * draws a one-pixel image, which makes the picture disappear. Dropping the
     * dimension lets the intrinsic size render normally, so the failure the
     * clamp produces is worse than the one the bound exists to prevent.
     *
     * The NaN case beside this one cannot reach it: it is answered by the
     * finiteness check, never by the range.
     */
    const { container } = render(
      <RichText value={image({ width: 0, height: 600 })} />
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("width")).toBeNull();
    expect(img?.getAttribute("height")).toBeNull();
  });

  it("carries a gallery image's title and reserved box, as a lone image does", () => {
    /*
     * The gallery went through a `{ src, alt }` projection beside the standalone
     * path, so it lost the author's title and reserved no space — its rows
     * shifted as the images loaded while a single image above them did not. One
     * shared element renders both now, and this asserts the gallery gets what
     * the lone path already had.
     */
    const value = doc([
      {
        type: "gallery",
        version: 1,
        images: [
          {
            src: "https://cdn.example.com/a.jpg",
            alt: "A",
            title: "Sunrise",
            width: 800,
            height: 600,
          },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const { container } = render(<RichText value={value} />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("title")).toBe("Sunrise");
    expect(img?.getAttribute("width")).toBe("800");
    expect(img?.getAttribute("height")).toBe("600");
  });

  it("emits NO wrapper when every button in a group is refused", () => {
    /*
     * A wrapper around nothing is not nothing: an empty `<p>` keeps its
     * paragraph margins and leaves a visible gap in the prose. Asserting only
     * that the label is gone stays green with that gap present, which is what
     * the earlier test did.
     *
     * Population first — a group whose buttons ARE usable must produce the
     * wrapper, or "no paragraph" passes against a renderer that never makes one.
     */
    const group = (urls: readonly string[]) =>
      doc([
        {
          type: "button-group",
          version: 1,
          buttons: urls.map((u, i) => ({ url: u, text: `B${i}` })),
        },
      ] as unknown as RichTextValue["root"]["children"]);

    const good = render(<RichText value={group(["https://example.com/a"])} />);
    expect(
      good.container.querySelector("p.nextly-rich-text-buttons")
    ).not.toBeNull();
    cleanup();

    const bad = render(<RichText value={group(["javascript:alert(1)"])} />);
    expect(
      bad.container.querySelector("p.nextly-rich-text-buttons")
    ).toBeNull();
    expect(bad.container.textContent).toBe("");
  });

  it("draws the appearance the author chose, not attributes alone", () => {
    /*
     * Size and alignment are choices the editor always records. Left to a
     * stylesheet this package does not ship, an author picks a large centred
     * button and the page draws a default-sized link against the margin — the
     * same failure the gallery column count had, one element over.
     *
     * Two sizes compared rather than one asserted: a single assertion passes
     * against a renderer that emits identical styling whatever was chosen.
     */
    const button = (extra: Record<string, unknown>) =>
      doc([
        {
          type: "button-link",
          version: 1,
          url: "https://example.com/buy",
          text: "Buy",
          ...extra,
        },
      ] as unknown as RichTextValue["root"]["children"]);

    const small = render(<RichText value={button({ size: "sm" })} />);
    const smallStyle =
      small.container.querySelector("a")?.getAttribute("style") ?? "";
    cleanup();
    const large = render(<RichText value={button({ size: "lg" })} />);
    const largeStyle =
      large.container.querySelector("a")?.getAttribute("style") ?? "";

    expect(smallStyle).not.toBe("");
    expect(smallStyle).not.toBe(largeStyle);
    cleanup();

    // The author's colours, when they set them. Unset, nothing is written: the
    // editor falls back to its own tokens, which a published site has no reason
    // to define, so emitting those would put a broken `var()` on the page.
    const coloured = render(
      <RichText value={button({ bgColor: "#123456", textColor: "#ffffff" })} />
    );
    const style =
      coloured.container.querySelector("a")?.getAttribute("style") ?? "";
    // Compared as the value the DOM actually holds: a colour written as a hex
    // literal is normalised to `rgb(...)` on the way in, so asserting the
    // source spelling fails against a renderer that applied it correctly.
    expect(style).toContain("rgb(18, 52, 86)");
    cleanup();

    const plain = render(<RichText value={button({})} />);
    expect(
      plain.container.querySelector("a")?.getAttribute("style") ?? ""
    ).not.toContain("var(--nx-");
  });

  it("drops an edge that ROUNDS to zero, not only one stored as zero", () => {
    /*
     * A positive fraction below a half clears the range check and then rounds to
     * zero, so returning the rounded value reinstates the collapsed image one
     * step after the check that refuses it. The stored-zero test beside this one
     * is answered by the range and never reaches the rounding.
     */
    const { container } = render(
      <RichText value={image({ width: 0.4, height: 600 })} />
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("width")).toBeNull();
    expect(img?.getAttribute("height")).toBeNull();
  });

  it("resets the gallery list's own presentation", () => {
    // A `<ul>` in a grid still carries markers, padding and margins from the
    // browser, so a host with no rule for this class publishes the gallery as a
    // bulleted, indented list — the grid arriving on top of a bulleted list
    // rather than instead of one.
    const value = doc([
      {
        type: "gallery",
        version: 1,
        images: [{ src: "https://cdn.example.com/a.jpg", alt: "A" }],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    /*
     * Asserted against the MARKUP this package emits, not against a jsdom
     * element. jsdom's CSS implementation drops every list-style property, so
     * reading the style attribute back from a rendered node cannot see this one
     * whether or not it was applied — the probe would confirm nothing and read
     * as coverage. `renderToStaticMarkup` is also what a published page is: this
     * entry renders on the server.
     */
    const html = renderToStaticMarkup(<RichText value={value} />);
    expect(html).toContain("list-style-type:none");
    expect(html).toContain("padding:0");
    // The SEMANTICS stay: a screen reader still announces the count.
    const { container } = render(<RichText value={value} />);
    expect(container.querySelectorAll("li").length).toBe(1);
  });

  it("lets a button row wrap, as the editor's own export does", () => {
    // Without it a group wider than its column overflows rather than moving to
    // a second line, so a long pair of labels publishes differently from what
    // the author was shown.
    const value = doc([
      {
        type: "button-group",
        version: 1,
        buttons: [
          { url: "https://example.com/a", text: "Alpha" },
          { url: "https://example.com/b", text: "Beta" },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const { container } = render(<RichText value={value} />);
    const style =
      container
        .querySelector("p.nextly-rich-text-buttons")
        ?.getAttribute("style") ?? "";
    expect(style).toContain("flex-wrap: wrap");
  });

  it("keeps an image inside its column, and the gallery cell too", () => {
    /*
     * An upload wider than the content column renders at its intrinsic width
     * without a constraint, breaking out of the prose — the normal case for
     * anything from a modern camera. The editor draws these with `w-full
     * h-auto`, so a published page without it shows the author something they
     * never saw.
     *
     * BOTH paths, because they are one element now and a fix applied to the
     * standalone one only would leave the gallery cells overflowing — which is
     * how the title and the reserved box went missing before.
     *
     * Asserted against the emitted markup: the style is what a published page
     * carries, and this entry renders on the server.
     */
    const html = renderToStaticMarkup(
      <RichText value={image({ width: 4000, height: 3000 })} />
    );
    expect(html).toContain("max-width:100%");
    expect(html).toContain("height:auto");

    const gallery = doc([
      {
        type: "gallery",
        version: 1,
        images: [{ src: "https://cdn.example.com/a.jpg", alt: "A" }],
      },
    ] as unknown as RichTextValue["root"]["children"]);
    const galleryHtml = renderToStaticMarkup(<RichText value={gallery} />);
    expect(galleryHtml).toContain("max-width:100%");
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

describe("rich-text block leaves inside a paragraph", () => {
  /**
   * What a BROWSER makes of the markup, which is the thing that goes wrong.
   *
   * Every one of this editor's decorator nodes is inline — `DecoratorNode`
   * returns `true` from `isInline()` and none of them overrides it — so a
   * caret-position insert makes an image or a button a CHILD of the paragraph
   * it was typed into. A `<p>` is closed by the parser at any block start tag,
   * so drawing one there produces a DOM that is not the tree React rendered.
   *
   * Reparsing is the oracle rather than a string match on the emitted tags,
   * because the string is what React believes and the DOM is what the visitor
   * gets. Asserting the tag name would still pass on markup a browser takes
   * apart.
   */
  const reparse = (html: string): HTMLElement => {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host;
  };

  const nested = (child: Record<string, unknown>): RichTextValue =>
    doc([
      { type: "paragraph", children: [child] },
    ] as unknown as RichTextValue["root"]["children"]);

  /**
   * Each leaf with the element it draws.
   *
   * The leaf is found by its OWN selector rather than by taking the first child
   * of the host: a gallery's rule set is hoisted ahead of the content, so the
   * first element is a `<style>` and an assertion on it would report the fix
   * missing when it is present.
   */
  const LEAVES: readonly (readonly [
    string,
    Record<string, unknown>,
    string,
  ])[] = [
    [
      "image",
      {
        type: "image",
        version: 1,
        src: "https://cdn.example.com/a.jpg",
        altText: "A",
      },
      "figure",
    ],
    [
      "gallery",
      {
        type: "gallery",
        version: 1,
        columns: 3,
        images: [{ src: "https://cdn.example.com/a.jpg", alt: "A" }],
      },
      "figure.nextly-rich-text-gallery",
    ],
    [
      "button-link",
      {
        type: "button-link",
        version: 1,
        url: "https://example.com",
        text: "Buy",
      },
      "p.nextly-rich-text-buttons",
    ],
    [
      "button-group",
      {
        type: "button-group",
        version: 1,
        buttons: [{ url: "https://example.com", text: "Buy" }],
      },
      "p.nextly-rich-text-buttons",
    ],
  ];

  it("keeps a plain paragraph a paragraph", () => {
    // The POPULATION before the property. Without this, a change that made
    // every paragraph a `div` would satisfy every assertion below.
    const host = reparse(renderToStaticMarkup(<RichText value={para("Hi")} />));
    expect(host.firstElementChild?.tagName).toBe("P");
    expect(host.firstElementChild?.textContent).toBe("Hi");
  });

  it.each(LEAVES)(
    "survives a browser reparse around %s",
    (name, child, selector) => {
      const html = renderToStaticMarkup(<RichText value={nested(child)} />);
      const host = reparse(html);
      const leaf = host.querySelector(selector);

      // The leaf drew at all — the population, before any claim about where it
      // sits. A selector that matched nothing would satisfy every assertion
      // below by vacuum.
      expect(leaf, name).not.toBeNull();
      // Its wrapper is not a `p`, which is the whole fix, and the wrapper is
      // still its PARENT after the parser has had its say. When the wrapper was
      // a `<p>` the parser closed it early and left the leaf as a SIBLING, so
      // containment is what actually distinguishes the two outcomes.
      expect(leaf?.parentElement?.tagName, name).toBe("DIV");
      expect(leaf?.parentElement?.parentElement, name).toBe(host);
      // The empty `<p></p>` a browser leaves behind when it closes one early is
      // the visible artefact: it keeps its margins and opens a gap in the prose.
      expect(host.querySelectorAll("p:empty").length, name).toBe(0);
    }
  );
});

describe("rich-text gallery columns follow the editor", () => {
  const gallery = (columns: number): RichTextValue =>
    doc([
      {
        type: "gallery",
        version: 1,
        columns,
        images: [
          { src: "https://cdn.example.com/a.jpg", alt: "A" },
          { src: "https://cdn.example.com/b.jpg", alt: "B" },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

  // The BYTES, not a substring of them. This rule set is emitted as a text
  // child, which React escapes — it is safe only while the text contains no
  // character that escaping would touch, and asserting the whole literal is
  // what makes adding one a failing test rather than a broken stylesheet.
  const RULE =
    "@media not all and (min-width: 40rem)" +
    "{.nextly-rich-text-gallery-items{--nx-rich-text-gallery-columns:2}}";

  it("publishes the narrow-screen rule unescaped", () => {
    expect(renderToStaticMarkup(<RichText value={gallery(4)} />)).toContain(
      RULE
    );
  });

  it("reads the author's count as the fallback, so the rule can lower it", () => {
    // The author's choice stays in the INLINE style as the fallback: if the
    // rule set never arrives the gallery still draws four columns, which is the
    // behaviour this replaced rather than a regression from it.
    expect(renderToStaticMarkup(<RichText value={gallery(4)} />)).toContain(
      "repeat(var(--nx-rich-text-gallery-columns, 4), minmax(0, 1fr))"
    );
  });

  it("emits one rule set however many galleries a document holds", () => {
    const two = doc([...gallery(3).root.children, ...gallery(4).root.children]);
    const html = renderToStaticMarkup(<RichText value={two} />);
    // Both galleries drew, and there is still exactly one stylesheet. Counted
    // on `data-columns` rather than the class, because the RULE SET names the
    // class too and a count of three would read as a third gallery.
    expect(html.split("data-columns=").length - 1).toBe(2);
    expect(html.split("<style").length - 1).toBe(1);
  });
});

describe("rich-text filled buttons stay visible", () => {
  const button = (extra: Record<string, unknown> = {}): RichTextValue =>
    doc([
      {
        type: "button-link",
        version: 1,
        url: "https://example.com/buy",
        text: "Buy",
        ...extra,
      },
    ] as unknown as RichTextValue["root"]["children"]);

  it("gives a filled button with no colours the CMS's own default", () => {
    // `bgColor` and `textColor` are optional on the node and its HTML-import
    // path leaves both unset, so this is the shape a legacy or imported button
    // actually has. The values are the ones `rich-text-html` already publishes
    // for the same document.
    const html = renderToStaticMarkup(<RichText value={button()} />);
    expect(html).toContain("background-color:#000");
    expect(html).toContain("color:#fff");
  });

  it("does not overwrite colours the author chose", () => {
    const html = renderToStaticMarkup(
      <RichText value={button({ bgColor: "#0a7", textColor: "#fee" })} />
    );
    expect(html).toContain("background-color:#0a7");
    expect(html).toContain("color:#fee");
    expect(html).not.toContain("#000");
  });

  it("leaves an outline button transparent", () => {
    // The default belongs to `filled` alone: an outline button with no colours
    // is meant to take the surrounding text's, which is what `currentColor` on
    // its border already does.
    const html = renderToStaticMarkup(
      <RichText value={button({ variant: "outline" })} />
    );
    expect(html).not.toContain("background-color");
  });
});

describe("rich-text stored colours reach a style attribute", () => {
  const button = (extra: Record<string, unknown>): RichTextValue =>
    doc([
      {
        type: "button-link",
        version: 1,
        url: "https://example.com/buy",
        text: "Buy",
        ...extra,
      },
    ] as unknown as RichTextValue["root"]["children"]);

  it("refuses a colour that closes the declaration and opens its own", () => {
    /*
     * React does not escape a style value, so a stored `;` is not styling — it
     * ends the declaration and starts another. The payload here is a full-page
     * overlay and an outbound request, from a field an author types into.
     *
     * Asserted on the RENDERED markup rather than on the validator, because the
     * validator being right is not the claim: the claim is that this value
     * cannot reach the page.
     */
    const hostile =
      "red;position:fixed;inset:0;background-image:url(https://attacker.test/x)";
    const html = renderToStaticMarkup(
      <RichText value={button({ bgColor: hostile })} />
    );

    expect(html).not.toContain("position:fixed");
    expect(html).not.toContain("attacker.test");
    // And the button is still DRAWN — a refused colour falls back to the
    // visible default rather than taking the button off the page with it.
    expect(html).toContain("background-color:#000");
    expect(html).toContain(">Buy</a>");
  });

  it("refuses a hostile foreground the same way", () => {
    // The sibling. `textColor` reaches the same attribute by the same route, so
    // a guard on one field leaves the other open with nothing to report it.
    const html = renderToStaticMarkup(
      <RichText value={button({ textColor: "red;position:fixed" })} />
    );
    expect(html).not.toContain("position:fixed");
    expect(html).toContain("color:#fff");
  });

  it("refuses a hostile foreground on an OUTLINE button too", () => {
    // The outline branch writes `color` from the same stored field down a
    // different path, so it needs its own assertion rather than inheriting one.
    const html = renderToStaticMarkup(
      <RichText
        value={button({ variant: "outline", textColor: "red;position:fixed" })}
      />
    );
    expect(html).not.toContain("position:fixed");
  });
});

describe("rich-text block leaves nested inside an inline wrapper", () => {
  const reparse = (html: string): HTMLElement => {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host;
  };

  it("survives a link applied across an image", () => {
    /*
     * Applying a link to a selection containing an inline decorator serialises
     * as `paragraph -> link -> image`. A check reading only the immediate
     * children sees the phrasing `link` and keeps the `<p>`, while `LinkView`
     * goes on to draw `<a><figure>` inside it — and the parser closes the
     * paragraph at the figure exactly as it would at the top level.
     */
    const value = doc([
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            url: "https://example.com",
            children: [
              {
                type: "image",
                version: 1,
                src: "https://cdn.example.com/a.jpg",
                altText: "A",
              },
            ],
          },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const host = reparse(renderToStaticMarkup(<RichText value={value} />));
    const figure = host.querySelector("figure");

    // Population first: the image drew, and the link survived around it.
    expect(figure).not.toBeNull();
    expect(host.querySelector("a")).not.toBeNull();
    // The wrapper the parser LEFT is a div, and the anchor is still inside it.
    expect(host.querySelector("a")?.parentElement?.tagName).toBe("DIV");
    expect(figure?.closest("a")).not.toBeNull();
    expect(host.querySelectorAll("p:empty").length).toBe(0);
  });

  it("still keeps a link around ordinary prose in a paragraph", () => {
    // The negative half, and the reason the walk stops at block nodes rather
    // than descending everywhere: a link full of TEXT is phrasing, and turning
    // its paragraph into a div would drop the paragraph semantics from most of
    // the prose on a page.
    const value = doc([
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            url: "https://example.com",
            children: [{ type: "text", text: "read this" }],
          },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const host = reparse(renderToStaticMarkup(<RichText value={value} />));
    expect(host.firstElementChild?.tagName).toBe("P");
    expect(host.querySelector("p > a")?.textContent).toBe("read this");
  });
});

describe("rich-text interactive nesting", () => {
  const reparse = (html: string): HTMLElement => {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host;
  };

  it("does not wrap a button in a second anchor", () => {
    /*
     * An `<a>` may not contain another `<a>`, and the parser does not simply
     * object: it closes the outer anchor at the inner one, lifts the row out,
     * and inserts a DUPLICATE empty anchor inside it. That anchor is focusable
     * and has no accessible name, so it is reachable by keyboard and announced
     * as nothing.
     */
    const value = doc([
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            url: "https://example.com",
            children: [
              {
                type: "button-link",
                version: 1,
                url: "https://example.com/buy",
                text: "Buy",
              },
            ],
          },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const host = reparse(renderToStaticMarkup(<RichText value={value} />));
    const anchors = Array.from(host.querySelectorAll("a"));

    // Exactly one anchor, and it is the button — the population before the
    // property, since zero anchors would also satisfy "no duplicate".
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.textContent).toBe("Buy");
    expect(anchors.filter(a => a.textContent === "")).toHaveLength(0);
  });

  it("keeps the anchor around ordinary linked prose", () => {
    // The control. A rule that dropped every wrapper would pass the assertions
    // above and take real links off the page.
    const value = doc([
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            url: "https://example.com",
            children: [{ type: "text", text: "go" }],
          },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const host = reparse(renderToStaticMarkup(<RichText value={value} />));
    expect(host.querySelector("p > a")?.textContent).toBe("go");
  });
});

describe("rich-text phrasing-only containers", () => {
  const IMAGE = {
    type: "image",
    version: 1,
    src: "https://cdn.example.com/a.jpg",
    altText: "A",
  };

  it("keeps a heading's words and puts the media after it", () => {
    // `h1`-`h6` take phrasing content. The tag cannot be swapped for a `div` the
    // way a paragraph's can: it is what puts the text in the document outline
    // and what a search engine reads, so the heading keeps its tag and the
    // media follows it in the flow where the author placed it.
    const value = doc([
      {
        type: "heading",
        tag: "h2",
        children: [{ type: "text", text: "Title" }, IMAGE],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const html = renderToStaticMarkup(<RichText value={value} />);
    expect(html).toContain("<h2>Title</h2>");
    expect(html).not.toContain("<h2>Title<figure");
    expect(html).toContain("<figure");
  });

  it("keeps the author's order when words follow the media", () => {
    /*
     * The fixture above ends in media, so it cannot tell "kept the words" from
     * "gathered every word first". This one can: the passage reads
     * Before-media-After, and collecting all phrasing into the heading renders
     * `<h2>BeforeAfter</h2>` with the media behind text that came after it.
     *
     * The heading is not split around the media either — a second `h2` is a
     * second entry in the document outline. Everything after the media follows
     * it out instead, in the order it was written.
     */
    const value = doc([
      {
        type: "heading",
        tag: "h2",
        children: [
          { type: "text", text: "Before" },
          IMAGE,
          { type: "text", text: "After" },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const html = renderToStaticMarkup(<RichText value={value} />);

    expect(html).toContain("<h2>Before</h2>");
    // The reordering this exists to prevent, named exactly.
    expect(html).not.toContain("BeforeAfter");
    // One heading, not one per run of words.
    expect(html.match(/<h2>/g)).toHaveLength(1);
    expect(html.indexOf("<figure")).toBeLessThan(html.indexOf("After"));
  });

  it("keeps the author's order in a disclosure label too", () => {
    // The same rule through the other container that takes only phrasing, so
    // the two cannot come to disagree about what order means.
    const value = doc([
      {
        type: "collapsible-container",
        children: [
          {
            type: "collapsible-title",
            children: [
              { type: "text", text: "Before" },
              IMAGE,
              { type: "text", text: "After" },
            ],
          },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const html = renderToStaticMarkup(<RichText value={value} />);

    expect(html).toContain("<summary>Before</summary>");
    expect(html).not.toContain("BeforeAfter");
    expect(html.indexOf("<figure")).toBeLessThan(html.indexOf("After"));
  });

  it("moves media out of a disclosure label into its body", () => {
    // `summary` takes phrasing content or a single heading, and it must be the
    // FIRST child of its `details` — so it cannot be replaced without removing
    // the disclosure. After it is the only place inside a `details` the media
    // can legally go.
    const value = doc([
      {
        type: "collapsible-container",
        children: [
          {
            type: "collapsible-title",
            children: [{ type: "text", text: "More" }, IMAGE],
          },
          {
            type: "collapsible-content",
            children: [
              { type: "paragraph", children: [{ type: "text", text: "body" }] },
            ],
          },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const html = renderToStaticMarkup(<RichText value={value} />);
    expect(html).toContain("<summary>More</summary>");
    expect(html).not.toContain("<summary>More<figure");
    // Still a working disclosure: the summary is the first child of `details`.
    expect(html).toContain("<details><summary>");
    expect(html).toContain("<figure");
  });

  it("leaves a heading of plain words exactly as it was", () => {
    // The control on the other side: a rule that split every heading would pass
    // both assertions above while restructuring documents that were fine.
    const value = doc([
      {
        type: "heading",
        tag: "h2",
        children: [{ type: "text", text: "Plain" }],
      },
    ] as unknown as RichTextValue["root"]["children"]);
    expect(renderToStaticMarkup(<RichText value={value} />)).toBe(
      "<h2>Plain</h2>"
    );
  });
});

describe("rich-text phrasing-only containers keep their label", () => {
  const IMAGE = {
    type: "image",
    version: 1,
    src: "https://cdn.example.com/a.jpg",
    altText: "A",
  };
  const linked = (kids: unknown[]) => ({
    type: "link",
    url: "https://example.com",
    children: kids,
  });
  const disclosure = (title: unknown[]): RichTextValue =>
    doc([
      {
        type: "collapsible-container",
        children: [{ type: "collapsible-title", children: title }],
      },
    ] as unknown as RichTextValue["root"]["children"]);

  it("keeps a heading a summary is allowed to hold", () => {
    // `summary` takes phrasing content optionally intermixed with HEADING
    // content, so a stored or imported title that is a heading is legal. Moving
    // it out leaves `<summary></summary>` — a disclosure with no label at all,
    // which is worse than the invalid nesting the move exists to prevent.
    const html = renderToStaticMarkup(
      <RichText
        value={disclosure([
          {
            type: "heading",
            tag: "h2",
            children: [{ type: "text", text: "Title" }],
          },
        ])}
      />
    );
    expect(html).toContain("<summary><h2>Title</h2></summary>");
  });

  it("keeps that heading while its own media still leaves the summary", () => {
    // The allowance is for the heading, not for what the heading contains.
    const html = renderToStaticMarkup(
      <RichText
        value={disclosure([
          {
            type: "heading",
            tag: "h2",
            children: [{ type: "text", text: "Title" }, IMAGE],
          },
        ])}
      />
    );
    expect(html).toContain("<summary><h2>Title</h2></summary>");
    expect(html).not.toContain("<h2>Title<figure");
    expect(html).toContain("<figure");
  });

  it("splits a link that carries both the label and the media", () => {
    /*
     * The case a direct-sibling fixture cannot reach. Moving the wrapper WHOLE
     * drags the label out with the image and leaves `<h2></h2>` — an empty
     * heading, which is precisely the outcome the split exists to avoid. A
     * heading whose words happen to sit inside a link is still a heading with
     * words.
     *
     * The wrapper is kept on BOTH sides: the words stay linked where the author
     * put them, and the media stays linked too. Duplicating an INLINE wrapper is
     * safe in a way duplicating the heading would not be — it adds nothing to
     * the document outline.
     */
    const value = doc([
      {
        type: "heading",
        tag: "h2",
        children: [linked([{ type: "text", text: "Label" }, IMAGE])],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const html = renderToStaticMarkup(<RichText value={value} />);
    expect(html).toContain('<h2><a href="https://example.com">Label</a></h2>');
    expect(html).toContain("<figure");
    expect(html).not.toContain("<h2></h2>");
  });

  it("splits the same wrapper inside a disclosure label", () => {
    // The sibling container. A rule applied to headings alone leaves the
    // disclosure with an empty label by the identical route.
    const html = renderToStaticMarkup(
      <RichText
        value={disclosure([linked([{ type: "text", text: "Label" }, IMAGE])])}
      />
    );
    expect(html).toContain(
      '<summary><a href="https://example.com">Label</a></summary>'
    );
    expect(html).not.toContain("<summary></summary>");
    expect(html).toContain("<figure");
  });
});

describe("rich-text media wrappers carry what no stylesheet will", () => {
  const image = (extra: Record<string, unknown> = {}): RichTextValue =>
    doc([
      {
        type: "image",
        version: 1,
        src: "https://cdn.example.com/a.jpg",
        altText: "A",
        ...extra,
      },
    ] as unknown as RichTextValue["root"]["children"]);

  const gallery = (): RichTextValue =>
    doc([
      {
        type: "gallery",
        version: 1,
        columns: 3,
        images: [{ src: "https://cdn.example.com/a.jpg", alt: "A" }],
      },
    ] as unknown as RichTextValue["root"]["children"]);

  it("resets the indent a figure arrives with", () => {
    // The UA stylesheet gives `figure` a `margin: 1em 40px`. Nothing in this
    // package neutralises it, so an image published into a narrow column loses
    // 80px and sits visibly inset from the prose around it. The vertical space
    // is kept at the editor's own `my-4`; only the horizontal inset goes.
    for (const value of [image(), gallery()]) {
      expect(renderToStaticMarkup(<RichText value={value} />)).toContain(
        "margin:1rem 0"
      );
    }
  });

  it("fills the track for a gallery cell", () => {
    // `GalleryNode.exportDOM` writes `img.style.width = "100%"` on every cell,
    // because a cell is a slot in a grid the author sized by choosing a column
    // count. A cell at its intrinsic width leaves the slot part-empty.
    // The WHOLE declaration list. `toContain("width:100%")` is satisfied by the
    // `max-width:100%` every image already carries, so it passes with the fill
    // absent — the assertion would have been green on the defect it names.
    expect(renderToStaticMarkup(<RichText value={gallery()} />)).toContain(
      'style="width:100%;max-width:100%;height:auto"'
    );
  });

  it("leaves a standalone image at the size it was placed", () => {
    /*
     * The other half of the same question, and the editor answers it
     * differently: `ImageNode.exportDOM` writes the recorded `width`/`height`
     * as ATTRIBUTES and no width style at all. Forcing `width:100%` here would
     * upscale a small image past its own pixels — and it would override the
     * very dimensions the renderer just wrote from what the author recorded.
     *
     * `max-width` still contains an upload wider than the column, which is the
     * case that motivated containment in the first place.
     */
    const html = renderToStaticMarkup(
      <RichText value={image({ width: 320, height: 200 })} />
    );
    expect(html).toContain('width="320"');
    // The WHOLE declaration list, because `max-width:100%` CONTAINS the string
    // `width:100%` — a substring refusal passes on the very output it is meant
    // to reject, and passed on the correct output here too.
    expect(html).toContain('style="max-width:100%;height:auto"');
  });
});

describe("rich-text inline styles reach the page", () => {
  const styled = (style: string, format?: number): RichTextValue =>
    doc([
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "Hi",
            style,
            ...(format === undefined ? {} : { format }),
          },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

  it("draws the font, size, colour and highlight an author chose", () => {
    /*
     * The defect: Lexical keeps these on the text node's `style` string, the
     * renderer read the text and the format bitfield and never opened it, so
     * every one of these choices published as plain prose. Silent in both
     * directions — the author saw it in the editor, the visitor saw nothing
     * missing.
     */
    const html = renderToStaticMarkup(
      <RichText
        value={styled(
          "font-family: Georgia; font-size: 24px; color: #ff0000; background-color: #00ff00"
        )}
      />
    );
    expect(html).toContain(
      '<span style="font-family:Georgia;font-size:24px;color:#ff0000;background-color:#00ff00">Hi</span>'
    );
  });

  it("wraps nothing when there is nothing to put on it", () => {
    // The control, and a real cost rather than tidiness: a `<span>` around every
    // text node in a document is bytes on every page and a hook a stylesheet can
    // catch on. Plain text must stay plain text.
    expect(renderToStaticMarkup(<RichText value={para("Hi")} />)).toBe(
      "<p>Hi</p>"
    );
  });

  it.each([...INLINE_STYLE_PROPERTIES])(
    "carries %s through to the page",
    property => {
      /*
       * Behavioural rather than a read of the renderer's name map: what matters
       * is that the property ARRIVES, and a test that compared two lists would
       * pass while a wrong camel-case name dropped it silently — React ignores a
       * key it does not know and says nothing.
       *
       * `inherit` because it is legal for every one of these, so one fixture
       * serves the whole list without inventing a value per property.
       */
      /*
       * `text-decoration` is a SHORTHAND and the engine resolves it into the
       * three longhands it assigns, so it never reaches the page under its own
       * name. `inherit` is not a line keyword either, so the value asserted for
       * it is the one the expansion produces.
       */
      if (property === "text-decoration") {
        const decorated = renderToStaticMarkup(
          <RichText value={styled(`${property}: underline`)} />
        );
        expect(decorated).toContain("text-decoration-line:underline");
        return;
      }
      const html = renderToStaticMarkup(
        <RichText value={styled(`${property}: inherit`)} />
      );
      expect(html).toContain(`${property}:inherit`);
    }
  );

  it("refuses a declaration that would break out of the style attribute", () => {
    // Same boundary the button colours cross. React does not escape a style
    // value, so a stored `;` ends the declaration and starts another.
    const html = renderToStaticMarkup(
      <RichText
        value={styled(
          "color: red;position:fixed;background-image:url(https://attacker.test/x)"
        )}
      />
    );
    expect(html).toContain("color:red");
    expect(html).not.toContain("position:fixed");
    expect(html).not.toContain("attacker.test");
  });

  it("lets the format bit win a disagreement about case", () => {
    // The bit is a button pressed on this selection; a `text-transform` in the
    // style string is whatever the document arrived carrying.
    const html = renderToStaticMarkup(
      <RichText
        value={styled("text-transform: lowercase", TEXT_FORMAT.UPPERCASE)}
      />
    );
    expect(html).toContain("text-transform:uppercase");
    expect(html).not.toContain("text-transform:lowercase");
  });
});

describe("rich-text authored colours beat the format element's own", () => {
  const styled = (style: string, format: number): RichTextValue =>
    doc([
      {
        type: "paragraph",
        children: [{ type: "text", text: "Hi", style, format }],
      },
    ] as unknown as RichTextValue["root"]["children"]);

  it("puts the author's colours inside the highlight, not around it", () => {
    /*
     * A format element carries colours of its own: `<mark>` is painted by the
     * UA with `Mark` and `MarkText`, and the CMS gives it a class setting both
     * explicitly. A colour on an OUTER span only inherits, so the mark's own
     * paint wins — an author who highlighted a phrase and then picked a text
     * colour published the mark's colours instead of theirs.
     *
     * Asserted as containment rather than as a string of the whole element, so
     * it still holds when another format bit adds a wrapper between them.
     */
    const { container } = render(
      <RichText
        value={styled(
          "color: #ff0000; background-color: #00ff00",
          TEXT_FORMAT.HIGHLIGHT
        )}
      />
    );
    const span = container.querySelector("span");
    expect(span, "the style span drew at all").not.toBeNull();
    expect(span?.closest("mark"), "it sits inside the mark").not.toBeNull();
  });

  it("puts them inside a bold wrapper too", () => {
    // The sibling. `<strong>` carries no colour of its own, so this one is not
    // about winning a cascade — it is that ONE rule decides the nesting, rather
    // than a special case for the element that happened to be reported.
    const { container } = render(
      <RichText value={styled("color: #ff0000", TEXT_FORMAT.BOLD)} />
    );
    expect(container.querySelector("strong > span")).not.toBeNull();
  });

  it("adds no span to a formatted run that declares nothing", () => {
    // The control. A rule that always emitted the span would satisfy both
    // assertions above and put an empty element around every formatted word.
    expect(
      renderToStaticMarkup(
        <RichText
          value={doc([
            {
              type: "paragraph",
              children: [
                { type: "text", text: "Hi", format: TEXT_FORMAT.BOLD },
              ],
            },
          ] as unknown as RichTextValue["root"]["children"])}
        />
      )
    ).toBe("<p><strong>Hi</strong></p>");
  });
});

describe("rich-text carries the editor's own font values to the page", () => {
  /*
   * The end of the chain, asserted where it ends. The engine's tests prove its
   * reader keeps every family and size the toolbar offers, and the admin's
   * conformance test proves that list IS the toolbar's — but neither renders
   * anything. A renderer that dropped values containing a space, or lost a
   * property's React name, would leave both of those green while the page
   * published the font as plain prose.
   *
   * `inherit` is what the per-property test above uses, and it is legal for all
   * of them, which is exactly why it cannot catch this: a real family carries a
   * space and a real size carries a unit.
   */
  const styled = (style: string): RichTextValue =>
    doc([
      {
        type: "paragraph",
        children: [{ type: "text", text: "Hi", style }],
      },
    ] as unknown as RichTextValue["root"]["children"]);

  it.each(["Courier New", "Times New Roman", "Georgia"])(
    "publishes the family %s",
    family => {
      expect(
        renderToStaticMarkup(
          <RichText value={styled(`font-family: ${family}`)} />
        )
      ).toContain(`font-family:${family}`);
    }
  );

  it.each(["10px", "24px", "72px"])("publishes the size %s", size => {
    expect(
      renderToStaticMarkup(<RichText value={styled(`font-size: ${size}`)} />)
    ).toContain(`font-size:${size}`);
  });
});

describe("rich-text a format bit beats a style that would cancel it", () => {
  const node = (style: string, format: number): RichTextValue =>
    doc([
      {
        type: "paragraph",
        children: [{ type: "text", text: "Hi", style, format }],
      },
    ] as unknown as RichTextValue["root"]["children"]);

  it("keeps a bold run bold when the style says otherwise", () => {
    // The style span sits INSIDE `<strong>` so an author's colour can beat
    // `<mark>`, which means a `font-weight: normal` in there would cancel the
    // bold by being nested deeper. The engine drops it instead, so the nesting
    // no longer decides — and the CMS, which nests the other way round, reaches
    // the same answer from the same reader.
    const html = renderToStaticMarkup(
      <RichText value={node("font-weight: normal", TEXT_FORMAT.BOLD)} />
    );
    expect(html).not.toContain("font-weight");
    expect(html).toContain("<strong>");
  });

  it("still lets the author colour that same bold run", () => {
    // The control: only the contradicted property goes.
    const html = renderToStaticMarkup(
      <RichText
        value={node("font-weight: normal; color: #ff0000", TEXT_FORMAT.BOLD)}
      />
    );
    expect(html).toContain("color:#ff0000");
    expect(html).not.toContain("font-weight");
  });

  it("reapplies a style whose declarations only changed order", () => {
    /*
     * React diffs a style object property by property. Two objects with the
     * same keys and values in a different order produce no writes at all, so an
     * already-mounted node would keep whichever shorthand won before — the
     * cascade fix would hold on a fresh render and silently not on an update.
     *
     * The span is keyed on the declaration order for that reason, which forces
     * a replacement rather than a diff.
     */
    const first = doc([
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "Hi",
            style: "text-decoration-color: green; text-decoration: underline",
          },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);
    const second = doc([
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "Hi",
            style: "text-decoration: underline; text-decoration-color: green",
          },
        ],
      },
    ] as unknown as RichTextValue["root"]["children"]);

    const { container, rerender } = render(<RichText value={first} />);
    const before = container.querySelector("span")?.getAttribute("style") ?? "";
    rerender(<RichText value={second} />);
    const after = container.querySelector("span")?.getAttribute("style") ?? "";

    // The population: both renders produced a styled span at all.
    expect(before).not.toBe("");
    expect(after).not.toBe("");
    // And the DOM followed the stored order rather than keeping the first.
    expect(before).not.toBe(after);
    expect(after.indexOf("text-decoration:")).toBeLessThan(
      after.indexOf("text-decoration-color:")
    );
  });
});

describe("rich-text a decoration the style already draws", () => {
  const mk = (style: string, format: number): RichTextValue =>
    doc([
      {
        type: "paragraph",
        children: [{ type: "text", text: "Hi", style, format }],
      },
    ] as unknown as RichTextValue["root"]["children"]);

  it("drops the wrapper rather than drawing a second line", () => {
    /*
     * A text decoration PROPAGATES to descendants instead of being replaced by
     * theirs, and a descendant cannot remove it. So `<u>` around a span
     * declaring `underline wavy red` draws two underlines — the wrapper's plain
     * one and the span's on top.
     *
     * The declaration is the richer of the two, carrying a style and a colour
     * the wrapper cannot express, so the WRAPPER is what goes.
     */
    const html = renderToStaticMarkup(
      <RichText
        value={mk("text-decoration: underline wavy red", TEXT_FORMAT.UNDERLINE)}
      />
    );
    expect(html).toContain("text-decoration-line:underline");
    expect(html).toContain("text-decoration-style:wavy");
    expect(html).not.toContain("<u>");
  });

  it("keeps a wrapper the style does not draw", () => {
    // The control that matters most: only the bit whose line is already drawn
    // loses its wrapper. Bold is not a decoration and accumulates with nothing.
    const html = renderToStaticMarkup(
      <RichText
        value={mk(
          "text-decoration: underline wavy red",
          TEXT_FORMAT.UNDERLINE | TEXT_FORMAT.BOLD
        )}
      />
    );
    expect(html).toContain("<strong>");
    expect(html).not.toContain("<u>");
  });

  it("keeps a wrapper for a format that does NOT accumulate", () => {
    /*
     * Only a decoration accumulates. A `font-weight: 900` inside a `<strong>`
     * simply wins — there is one weight — so dropping the `<strong>` would
     * discard its semantics for no benefit, and a screen reader would stop
     * announcing the emphasis.
     *
     * This case exists because break-verifying the decoration-only filter
     * changed NOTHING: with every format treated as accumulating, no test
     * failed, because none of them paired a bit with a reinforcing value of its
     * own property.
     */
    const html = renderToStaticMarkup(
      <RichText value={mk("font-weight: 900", TEXT_FORMAT.BOLD)} />
    );
    expect(html).toContain("<strong>");
    expect(html).toContain("font-weight:900");
  });

  it("keeps the wrapper when the style contradicts it instead", () => {
    // `none` beside the bit is a contradiction, not a richer decoration: the
    // declaration goes and the wrapper stays, which is the other branch.
    const html = renderToStaticMarkup(
      <RichText value={mk("text-decoration: none", TEXT_FORMAT.UNDERLINE)} />
    );
    expect(html).toContain("<u>");
    expect(html).not.toContain("text-decoration");
  });

  it("keeps a wrapper whose own line the style does not assert", () => {
    // An underline declaration beside STRIKETHROUGH asserts the wrong line, so
    // it is dropped as a contradiction and the `<s>` survives.
    const html = renderToStaticMarkup(
      <RichText
        value={mk("text-decoration: underline", TEXT_FORMAT.STRIKETHROUGH)}
      />
    );
    expect(html).toContain("<s>");
  });
});

describe("rich-text an updated node matches a fresh one", () => {
  const styled = (style: string): RichTextValue =>
    doc([
      { type: "paragraph", children: [{ type: "text", text: "Hi", style }] },
    ] as unknown as RichTextValue["root"]["children"]);

  const attributeOf = (container: HTMLElement): string =>
    container.querySelector("span")?.getAttribute("style") ?? "";

  it.each([
    [
      "only the declaration order changes",
      "text-decoration-color: green; text-decoration: underline",
      "text-decoration: underline; text-decoration-color: green",
    ],
    [
      "only a shorthand beside its own longhand changes",
      "text-decoration: underline blue; text-decoration-color: green",
      "text-decoration: underline red; text-decoration-color: green",
    ],
    ["only a value changes", "color: #ff0000", "color: #00ff00"],
  ])("after %s", (_label, before, after) => {
    /*
     * The property, stated as the thing that actually matters: a node the
     * client UPDATED must look like one the client rendered fresh — which is
     * also what the CMS serializer produces for the same stored value.
     *
     * Asserted this way rather than against a specific declaration, because
     * React's diff fails here in more than one way and each has its own
     * symptom. Identical keys and values in a new order produce no writes at
     * all. A changed SHORTHAND beside an unchanged longhand writes only the
     * shorthand, and assigning `text-decoration` resets
     * `text-decoration-color` — so the longhand the diff skipped is undone.
     * Comparing against a fresh render catches both without this test having to
     * model the browser's shorthand expansion, which jsdom may not implement.
     */
    const updated = render(<RichText value={styled(before)} />);
    updated.rerender(<RichText value={styled(after)} />);
    const afterUpdate = attributeOf(updated.container);
    cleanup();

    const fresh = render(<RichText value={styled(after)} />);
    const afterFresh = attributeOf(fresh.container);

    // The population first: two empty attributes would compare equal and pass.
    expect(afterFresh).not.toBe("");
    expect(afterUpdate).toBe(afterFresh);
  });

  it.each([
    [
      "a shorthand beside its own longhand",
      "text-decoration: underline blue; text-decoration-color: green",
      "text-decoration: overline blue; text-decoration-color: green",
    ],
    ["a plain value", "color: #ff0000", "color: #00ff00"],
  ])("replaces the element when %s changes", (_label, before, after) => {
    /*
     * The MECHANISM, because the outcome is not observable here. Assigning
     * `text-decoration` resets `text-decoration-color` in a browser, so React
     * writing only the changed shorthand undoes the longhand it skipped as
     * unchanged — but jsdom does not implement shorthand expansion, so that
     * reset never happens and the resulting attribute matches a fresh render
     * either way. Measured: with the key on property order alone, every
     * assertion above still passes.
     *
     * What the key actually buys is a REPLACEMENT rather than a diff, and that
     * is observable: the DOM node itself changes. Asserting it here is
     * asserting the thing this file controls, rather than a browser behaviour
     * this environment declines to model.
     */
    const view = render(<RichText value={styled(before)} />);
    const first = view.container.querySelector("span");
    expect(first, "the population: a styled span drew at all").not.toBeNull();
    view.rerender(<RichText value={styled(after)} />);
    const second = view.container.querySelector("span");

    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it("does not replace the element when the cascade resolves the same way", () => {
    /*
     * Two different declaration LISTS, one resolved style. The shorthand's
     * colour is overwritten by the longhand after it either way, so
     * `underline blue` and `underline red` beside `text-decoration-color:
     * green` mean the same thing — and the element correctly stays put.
     *
     * This was a remount fixture until the shorthand began being resolved,
     * which is the clearest demonstration of what that change bought: the
     * question moved from "did the text differ" to "did the meaning differ".
     */
    const view = render(
      <RichText
        value={styled(
          "text-decoration: underline blue; text-decoration-color: green"
        )}
      />
    );
    const first = view.container.querySelector("span");
    expect(first).not.toBeNull();
    view.rerender(
      <RichText
        value={styled(
          "text-decoration: underline red; text-decoration-color: green"
        )}
      />
    );
    expect(view.container.querySelector("span")).toBe(first);
  });

  it("does not replace the element when nothing changed", () => {
    // The control on the other side: a key that varied on every render would
    // satisfy both assertions above while throwing the node away on each pass.
    const view = render(<RichText value={styled("color: #ff0000")} />);
    const first = view.container.querySelector("span");
    view.rerender(<RichText value={styled("color: #ff0000")} />);
    expect(view.container.querySelector("span")).toBe(first);
  });
});

describe("rich-text a decoration that adds a second line", () => {
  const mk = (style: string, format: number): RichTextValue =>
    doc([
      {
        type: "paragraph",
        children: [{ type: "text", text: "Hi", style, format }],
      },
    ] as unknown as RichTextValue["root"]["children"]);

  it("keeps the wrapper AND the declaration when they draw different lines", () => {
    // A decoration accumulates rather than replacing an ancestor's, so a
    // strike and an authored underline are both wanted. Dropping either loses
    // something the author wrote.
    const html = renderToStaticMarkup(
      <RichText
        value={mk(
          "text-decoration: underline wavy red",
          TEXT_FORMAT.STRIKETHROUGH
        )}
      />
    );
    expect(html).toContain("<s>");
    expect(html).toContain("text-decoration-line:underline");
  });

  it("drops the wrapper when they draw the SAME line", () => {
    // The other branch, unchanged: same line means the two would double up.
    const html = renderToStaticMarkup(
      <RichText
        value={mk("text-decoration: underline wavy red", TEXT_FORMAT.UNDERLINE)}
      />
    );
    expect(html).not.toContain("<u>");
    expect(html).toContain("text-decoration-line:underline");
  });
});

describe("a passage nested far deeper than any document limit", () => {
  /**
   * Containers that neither scan stops at.
   *
   * The type matters: nesting LINKS proves nothing, because the interactive
   * scan matches the first one and returns without descending — a probe built
   * that way renders one anchor at any depth and reports success it never
   * earned. An unknown container is neither interactive nor block, so both
   * scans walk every level of it.
   *
   * Built with a loop rather than by recursion, so the fixture itself cannot be
   * what exhausts the stack.
   */
  function nested(levels: number): RichTextValue {
    let node: RichTextValue["root"]["children"][number] = {
      type: "text",
      text: "MARKER",
    };
    for (let i = 0; i < levels; i++)
      node = { type: "wrapper", children: [node] };
    return doc([{ type: "paragraph", children: [node] }]);
  }

  /**
   * The same chain, ending in a PARAGRAPH inside a HEADING.
   *
   * A heading may hold only phrasing content, so block content beneath it takes
   * a different route through the renderer — one that rebuilds the tree as it
   * splits it. A fixture ending in TEXT never reaches that route at all, which
   * is why the case below passed while this one still overflowed.
   */
  function nestedUnderHeading(levels: number): RichTextValue {
    let node: RichTextValue["root"]["children"][number] = {
      type: "paragraph",
      children: [{ type: "text", text: "MARKER" }],
    };
    for (let i = 0; i < levels; i++)
      node = { type: "wrapper", children: [node] };
    return doc([{ type: "heading", tag: "h2", children: [node] }]);
  }

  it("renders block content buried under a heading", () => {
    // The route that rearranges rather than merely scans. Measured: 5,000
    // levels threw `RangeError` here after the scans were already iterative.
    const html = renderToStaticMarkup(
      <RichText value={nestedUnderHeading(5000)} />
    );

    expect(html).toContain("MARKER");
  });

  it("renders instead of exhausting the call stack", () => {
    /*
     * The document limits count BLOCK nodes and cap total bytes; neither bounds
     * the tree inside one prop. Measured on this renderer, five thousand such
     * levels is roughly a fifth of a megabyte — far below the cap — and threw
     * `RangeError: Maximum call stack size exceeded` while the scans recursed.
     *
     * A throw here is not one bad passage rendering as a placeholder. It escapes
     * the render and takes the page route with it, so a visitor gets nothing.
     */
    const html = renderToStaticMarkup(<RichText value={nested(5000)} />);

    // Asserted on the OUTPUT rather than on the absence of a throw: a scan that
    // silently stopped descending would also not throw, and would be wrong.
    expect(html).toContain("MARKER");
  });
});
