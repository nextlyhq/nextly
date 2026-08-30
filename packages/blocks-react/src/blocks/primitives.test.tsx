/**
 * The core primitives, rendered.
 *
 * These assert the two things a block library gets wrong most expensively: the
 * markup an assistive technology depends on, and the values that reach an
 * attribute a browser will execute. Styling is deliberately absent, because it
 * belongs to the style system rather than to any block.
 */
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import {
  Activity,
  Fragment,
  Profiler,
  StrictMode,
  Suspense,
  createContext,
} from "react";

const TestContext = createContext("");
import { describe, expect, it } from "vitest";

import {
  blockTypeClassName,
  defineBlock,
  type AnyBlockDefinition,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";

import { BlockBoundary } from "../block-boundary";
import type {
  BlockHostPolicy,
  BlockRenderArgs,
  PageContext,
  ResolvedMedia,
} from "../context";
import { createBlockResolver } from "../resolver";

import { button, renderButton } from "./button";
import { divider, renderDivider } from "./divider";
import { embed, renderEmbed } from "./embed";
import { heading, renderHeading } from "./heading";
import { image, renderImage } from "./image";
import { list, renderList } from "./list";
import { paragraph, renderParagraph } from "./paragraph";
import { quote, renderQuote } from "./quote";
import { spacer, renderSpacer } from "./spacer";
const NODE: BlockNode = { id: "n1", type: "core/text", version: 1, props: {} };

function context(overrides: Partial<PageContext> = {}): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
    ...overrides,
  };
}

function args<P>(
  props: P,
  ctx: PageContext = context(),
  hostPolicy?: BlockHostPolicy
): BlockRenderArgs<P> {
  return {
    props,
    node: NODE,
    className: "nx-n1",
    // Required by the render contract. These fixtures declare no parts, so the
    // answer is empty for every name — but a renderer that could omit it would
    // leave every block's parts unmarked with nothing to report.
    partClass: () => "",
    ctx,
    renderSlot: () => null,
    ...(hostPolicy === undefined ? {} : { hostPolicy }),
  };
}

const html = (element: ReactElement | null): string =>
  element === null ? "" : renderToStaticMarkup(element);

describe("core/heading", () => {
  it("renders the stored level rather than one derived from nesting", () => {
    // A level computed from depth changes when a block is dragged, which is the
    // accessibility failure headings exist to prevent.
    expect(html(renderHeading(args({ text: "Title", level: "h3" })))).toBe(
      '<h3 class="nx-n1">Title</h3>'
    );
  });

  it("falls back to h2 for a level nothing recognises", () => {
    const stored = { text: "Title", level: "h9" } as never;
    expect(html(renderHeading(args(stored)))).toContain("<h2");
  });

  it("puts the link inside the heading, not around it", () => {
    // Around it, a screen reader announces the whole heading as a link.
    const out = html(renderHeading(args({ text: "Title", href: "/docs" })));
    expect(out).toBe('<h2 class="nx-n1"><a href="/docs">Title</a></h2>');
  });

  it("adds noopener noreferrer to a new-tab link", () => {
    const out = html(
      renderHeading(args({ text: "T", href: "/x", target: "_blank" }))
    );
    expect(out).toContain('target="_blank"');
    expect(out).toContain("noopener");
    expect(out).toContain("noreferrer");
  });
});

describe("core/text", () => {
  it("renders a paragraph", () => {
    expect(html(renderParagraph(args({ text: "Hello" })))).toBe(
      '<p class="nx-n1">Hello</p>'
    );
  });

  it("renders a stored non-string without stringifying it as an object", () => {
    const stored = { text: { nope: true } } as never;
    expect(html(renderParagraph(args(stored)))).toBe('<p class="nx-n1"></p>');
  });
});

describe("core/list", () => {
  it("renders real list items so length and position are announced", () => {
    const out = html(renderList(args({ items: ["one", "two"] })));
    expect(out).toBe('<ul class="nx-n1"><li>one</li><li>two</li></ul>');
  });

  it("renders an ordered list with its start", () => {
    const out = html(
      renderList(args({ kind: "ordered", items: ["a"], start: 3 }))
    );
    expect(out).toBe('<ol class="nx-n1" start="3"><li>a</li></ol>');
  });

  it("survives a stored items value that is not an array", () => {
    const stored = { items: "one, two" } as never;
    expect(html(renderList(args(stored)))).toBe('<ul class="nx-n1"></ul>');
  });
});

describe("core/quote", () => {
  it("keeps the attribution outside the quotation", () => {
    // Inside, the quotation claims the speaker also said their own name.
    const out = html(
      renderQuote(args({ text: "Words", attribution: "Ada", source: "A Book" }))
    );
    expect(out).toContain("<figure");
    // The quotation holds the words and NOTHING else. Asserted on what sits
    // BETWEEN the tags, captured non-greedily: a match run across the closing
    // tag reaches the figcaption and reports the attribution as inside the
    // quotation when it is beside it. The element's own attributes are left
    // out of the comparison, so a class the block needs for its defaults does
    // not read as the attribution leaking in.
    const quoted = /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/.exec(out)?.[1];
    expect(quoted).toBe("<p>Words</p>");

    // The quotation carries no block-type class of its own. The figure is the
    // root and already has it, so repeating it here would apply the whole
    // default twice — indenting an attributed quote further than a bare one,
    // and leaving the inner copy standing when a node-local style overrides
    // the root.
    expect(out).not.toMatch(/<blockquote[^>]*nx-bt-core--quote/);
    expect(out).toContain("<figcaption>Ada, <cite>A Book</cite></figcaption>");
  });

  it("is a bare blockquote when there is nothing to attribute", () => {
    const out = html(renderQuote(args({ text: "Words" })));
    expect(out).toBe('<blockquote class="nx-n1"><p>Words</p></blockquote>');
  });
});

describe("core/button", () => {
  it("renders a button when it has no destination", async () => {
    // A link with no href is not focusable and is announced as neither.
    const out = html(await renderButton(args({ label: "Send" })));
    expect(out).toBe('<button class="nx-n1" type="button">Send</button>');
  });

  it("renders an anchor when it has one", async () => {
    const out = html(await renderButton(args({ label: "Go", href: "/x" })));
    expect(out).toBe('<a class="nx-n1" href="/x">Go</a>');
  });

  it("prefers a resolved entry path over a typed url", async () => {
    // An entry reference survives a rename; a pasted path does not.
    const out = html(
      await renderButton(
        args(
          {
            label: "Read",
            href: "/stale",
            entryCollection: "posts",
            entryId: "7",
          },
          context({ resolveEntryPath: () => Promise.resolve("/posts/current") })
        )
      )
    );
    expect(out).toContain('href="/posts/current"');
  });

  it("falls back to the typed url when resolution fails", async () => {
    const out = html(
      await renderButton(
        args(
          {
            label: "Read",
            href: "/fallback",
            entryCollection: "posts",
            entryId: "7",
          },
          context({ resolveEntryPath: () => Promise.reject(new Error("down")) })
        )
      )
    );
    expect(out).toContain('href="/fallback"');
  });
});

describe("executable urls", () => {
  // The one prop type where a bad stored value is code execution rather than a
  // broken link. Each variant is a real bypass of a naive prefix test.
  // The control characters are written as escapes rather than as themselves. A
  // literal NUL byte makes the whole file binary to git and to grep: it cannot
  // be merged line by line, and a reader sees a space where the byte that
  // matters is.
  const hostile = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "javascript\u0000:alert(1)",
    "vbscript:msgbox",
    "data:text/html,<script>alert(1)</script>",
  ];

  it("carries the control characters it claims to", () => {
    // Without this the suite still passes if an escape is flattened into an
    // ordinary space or letter: every variant would be refused for having no
    // usable scheme, and the smuggling each one stands for would go untested.
    expect(hostile.filter(value => value.includes("\u0000"))).toHaveLength(1);
    expect(hostile.filter(value => value.includes("\t"))).toHaveLength(1);
    expect(hostile.filter(value => value.includes("\n"))).toHaveLength(1);
  });

  it("refuses them on a button", async () => {
    for (const href of hostile) {
      const out = html(await renderButton(args({ label: "x", href })));
      expect(out, href).not.toContain("href=");
      expect(out, href).toContain("<button");
    }
  });

  it("refuses them on a heading link", () => {
    for (const href of hostile) {
      expect(
        html(renderHeading(args({ text: "t", href }))),
        href
      ).not.toContain("href=");
    }
  });

  it("refuses them as an embed source", () => {
    for (const src of hostile) {
      expect(html(renderEmbed(args({ src, title: "t" }))), src).toBe("");
    }
  });

  it("still allows the ordinary ones", async () => {
    for (const href of [
      "/about",
      "https://example.com",
      "mailto:a@b.co",
      "#top",
    ]) {
      const out = html(await renderButton(args({ label: "x", href })));
      expect(out, href).toContain(`href="${href}"`);
    }
  });
});

describe("core/image", () => {
  const media: ResolvedMedia = {
    url: "/uploads/a.jpg",
    alt: "From the library",
    width: 800,
    height: 600,
  };

  it("resolves through the host and reserves the space", async () => {
    // Intrinsic dimensions are what stop the text below jumping on load.
    const out = html(
      await renderImage(
        args(
          { mediaId: "m1" },
          context({ resolveMedia: () => Promise.resolve(media) })
        )
      )
    );
    expect(out).toContain('src="/uploads/a.jpg"');
    expect(out).toContain('width="800"');
    expect(out).toContain('height="600"');
    expect(out).toContain('alt="From the library"');
  });

  it("emits empty alt for a decorative image rather than omitting it", async () => {
    // Omitted, a screen reader reads the file name instead.
    const out = html(
      await renderImage(
        args({ src: "/a.jpg", alt: "ignored", decorative: true })
      )
    );
    expect(out).toContain('alt=""');
    expect(out).toContain('role="presentation"');
  });

  it("renders nothing rather than an image with no source", async () => {
    expect(html(await renderImage(args({})))).toBe("");
  });

  it("filters a host-resolved url the same way it filters a typed one", async () => {
    // The resolver is trusted code, but the URL it returns came from a media
    // record a person filled in, so it is input in the same sense the direct
    // prop is. Not exploitable in an `img` src, which is why it survived: the
    // point is that the module's own rule was applied at one position of a pair.
    const out = html(
      await renderImage(
        args(
          { mediaId: "m1" },
          context({
            resolveMedia: () =>
              Promise.resolve({ url: "javascript:alert(1)", alt: "x" }),
          })
        )
      )
    );

    expect(out).toBe("");
  });

  it("falls back to the typed url when the resolved one is refused", async () => {
    const out = html(
      await renderImage(
        args(
          { mediaId: "m1", src: "/safe.jpg" },
          context({
            resolveMedia: () =>
              Promise.resolve({ url: "javascript:alert(1)", alt: "x" }),
          })
        )
      )
    );

    expect(out).toContain('src="/safe.jpg"');
  });

  it("drops a refused record's alt and size along with its url", async () => {
    // A rejected record describes the asset that was rejected. Keeping its
    // metadata beside the fallback url would announce one image to a screen
    // reader and reserve the other one's space, so the record goes whole.
    const out = html(
      await renderImage(
        args(
          { mediaId: "m1", src: "/safe.jpg" },
          context({
            resolveMedia: () =>
              Promise.resolve({
                url: "javascript:alert(1)",
                alt: "A different picture",
                width: 1600,
                height: 900,
              }),
          })
        )
      )
    );

    expect(out).toContain('src="/safe.jpg"');
    expect(out).not.toContain("A different picture");
    expect(out).not.toContain("1600");
    expect(out).not.toContain("900");
    // Still announced, as an image with no known description must be.
    expect(out).toContain('alt=""');
  });

  it("survives a media resolver that throws", async () => {
    const out = html(
      await renderImage(
        args(
          { mediaId: "m1", src: "/fallback.jpg" },
          context({ resolveMedia: () => Promise.reject(new Error("gone")) })
        )
      )
    );
    expect(out).toContain('src="/fallback.jpg"');
  });

  it("moves its class to the figure when it has a caption", async () => {
    const out = html(
      await renderImage(args({ src: "/a.jpg", caption: "A view" }))
    );
    expect(out).toContain('<figure class="nx-n1">');
    expect(out).toContain("<figcaption>A view</figcaption>");
    expect(out).not.toContain('<img class="nx-n1"');
  });
});

describe("core/embed", () => {
  it("sandboxes without granting same-origin alongside scripts", () => {
    // Both together let the frame remove its own sandbox.
    const out = html(
      renderEmbed(args({ src: "https://e.com/v", title: "Demo" }))
    );
    expect(out).toContain("allow-scripts");
    expect(out).not.toContain("allow-same-origin");
  });

  it("always carries a title", () => {
    // Without one an iframe is announced only as "frame".
    const out = html(renderEmbed(args({ src: "https://e.com/v" })));
    expect(out).toContain('title="Embedded content"');
  });

  it("does not leak the page path to the embedded party", () => {
    const out = html(renderEmbed(args({ src: "https://e.com/v", title: "t" })));
    expect(out.toLowerCase()).toContain(
      'referrerpolicy="strict-origin-when-cross-origin"'
    );
  });

  it("grants same-origin to an origin the host trusted", () => {
    const out = html(
      renderEmbed(
        args({ src: "https://player.example.com/v", title: "t" }, context(), {
          trustedFrameOrigins: ["https://player.example.com"],
        })
      )
    );
    expect(out).toContain("allow-same-origin");
  });

  it("ignores a stored request to drop the sandbox", () => {
    // The flag used to be a checkbox on the block, which put a security posture
    // in the hands of whoever edited the page. Documents written then still
    // carry it, and it must now do nothing at all.
    const stored = {
      src: "https://e.com/v",
      title: "t",
      allowSameOrigin: true,
    } as never;

    expect(html(renderEmbed(args(stored)))).not.toContain("allow-same-origin");
  });

  it.each([
    // Each is a way a naive check would have said yes.
    ["a different scheme", "http://player.example.com/v"],
    ["a suffix lookalike", "https://player.example.com.evil.test/v"],
    ["a subdomain of a trusted host", "https://a.player.example.com/v"],
    ["a different port", "https://player.example.com:8443/v"],
    // `new URL(x)` with no base reads these as the trusted origin, while an
    // `iframe src` resolves them against the DOCUMENT, because the scheme
    // matches: they load `https://site.example/.../player.example.com`. Trusting
    // the parser's answer would grant same-origin on the HOST's own origin.
    ["a same-scheme url with no authority", "https:player.example.com/v"],
    ["a same-scheme url with one slash", "https:/player.example.com/v"],
    // A relative URL resolves to the host's OWN origin, where the grant would
    // let the frame reach the document around it. The most dangerous case, and
    // the one a prefix test is likeliest to wave through.
    ["a relative url", "/player/v"],
  ])("refuses same-origin for %s", (label, src) => {
    const out = html(
      renderEmbed(
        args({ src, title: "t" }, context(), {
          trustedFrameOrigins: ["https://player.example.com"],
        })
      )
    );
    expect(out, label).not.toContain("allow-same-origin");
  });

  it("survives an unparseable entry in the trusted list", () => {
    // One typo in configuration must not throw out of a render and take the
    // page with it, and must not widen the list either.
    const policy = {
      trustedFrameOrigins: ["not a url", "https://player.example.com"],
    };

    expect(
      html(
        renderEmbed(
          args(
            { src: "https://player.example.com/v", title: "t" },
            context(),
            policy
          )
        )
      )
    ).toContain("allow-same-origin");
    expect(
      html(
        renderEmbed(
          args(
            { src: "https://other.example/v", title: "t" },
            context(),
            policy
          )
        )
      )
    ).not.toContain("allow-same-origin");
  });
});

describe("spacer and divider", () => {
  it("hides the spacer from assistive technology", () => {
    // It carries no content, so announcing it is noise.
    expect(html(renderSpacer(args({})))).toBe(
      '<div class="nx-n1" aria-hidden="true"></div>'
    );
  });

  it("renders the divider as a thematic break", () => {
    expect(html(renderDivider(args({})))).toBe('<hr class="nx-n1"/>');
  });
});

/**
 * The primitives rendered through `BlockBoundary`, which is what production
 * does.
 *
 * The suite above calls each render function directly. That is worth keeping —
 * it isolates a block's own logic — but it is not the path a page takes. The
 * boundary appends the block-type class, clones the node's `cssId` and
 * attributes onto the root, and normalizes the output before React sees it, so
 * a block can be correct in isolation and wrong on a page. Only these cover
 * that difference.
 */
/** Markup with React's streaming comment markers removed. */
function withoutComments(html: string): string {
  return html.replace(/<!--.*?-->/g, "").trim();
}

describe("through the boundary", () => {
  const resolver = createBlockResolver([
    heading as AnyBlockDefinition,
    paragraph as AnyBlockDefinition,
    image as AnyBlockDefinition,
    button as AnyBlockDefinition,
    list as AnyBlockDefinition,
    quote as AnyBlockDefinition,
    divider as AnyBlockDefinition,
    spacer as AnyBlockDefinition,
    embed as AnyBlockDefinition,
  ]);

  async function renderNode(
    node: BlockNode,
    ctx: PageContext = context()
  ): Promise<string> {
    const stream = await renderToReadableStream(
      <BlockBoundary
        node={node}
        context={ctx}
        blocks={resolver}
        classes={{ [node.id]: "nx-node" }}
      />
    );
    return new Response(stream).text();
  }

  function node(
    type: string,
    props: Record<string, unknown> = {},
    extra: Partial<BlockNode> = {}
  ): BlockNode {
    return { id: "n1", type, version: 1, props, ...extra };
  }

  it("gives every primitive both of its classes", async () => {
    // The node class carries this instance's values and the type class carries
    // the block's shared defaults. A block rendered directly has neither, so
    // the direct suite cannot see one going missing.
    for (const [type, props] of [
      ["core/heading", { text: "Title" }],
      ["core/text", { text: "Words" }],
      ["core/list", { items: ["a"] }],
      ["core/quote", { text: "Quoted" }],
      ["core/divider", {}],
      ["core/spacer", {}],
      ["core/button", { label: "Go" }],
    ] as const) {
      const html = await renderNode(node(type, props));
      expect(html, type).toContain("nx-node");
      expect(html, type).toContain(blockTypeClassName(type));
    }
  });

  it("puts a node's cssId on the element the block rendered", async () => {
    // The block never sees `cssId`; the boundary clones it onto whatever root
    // came back. Rendering the function directly skips that entirely.
    const html = await renderNode(
      node("core/heading", { text: "Title" }, { cssId: "pricing" })
    );

    expect(html).toContain('id="pricing"');
    expect(html).toContain("<h2");
  });

  it("applies a node's allowed attributes and drops the rest", async () => {
    const html = await renderNode(
      node(
        "core/text",
        { text: "Words" },
        { attributes: { title: "hint", "data-x": "1", onclick: "steal()" } }
      )
    );

    expect(html).toContain('title="hint"');
    expect(html).toContain('data-x="1"');
    expect(html).not.toContain("steal");
  });

  it("renders an image with a caption as a figure carrying the node class", async () => {
    // The caption path moves the class from the img to the figure, so the
    // boundary's clone has to land on the figure and not on the image.
    const html = await renderNode(
      node("core/image", { src: "/a.jpg", caption: "A view" })
    );

    expect(html).toContain("<figure");
    expect(html).toContain("nx-node");
    expect(html).toContain("<figcaption>A view</figcaption>");
  });

  it("awaits an async primitive rather than rendering its promise", async () => {
    // `core/button` resolves an entry path before it can render, so it returns
    // a promise. Only the boundary awaits it.
    const html = await renderNode(
      node("core/button", {
        label: "Read",
        entryCollection: "posts",
        entryId: "7",
      }),
      context({ resolveEntryPath: () => Promise.resolve("/posts/current") })
    );

    expect(html).toContain('href="/posts/current"');
    expect(html).toContain("Read");
  });

  it("does not placeholder a block that deliberately renders nothing", async () => {
    // `core/image` with no usable source returns null on purpose: an `<img>`
    // with no `src` re-requests the current page in some browsers. Carrying a
    // `cssId` must not turn that decision into a broken-block diagnostic, which
    // in production is an invisible marker the author never sees.
    const html = await renderNode(node("core/image", {}, { cssId: "hero" }));

    expect(html).not.toContain("data-nx-block-placeholder");
    // Comments only. This block is async, so React leaves its Suspense markers
    // behind; what matters is that no element and no diagnostic reached the
    // page, not that the string is empty.
    expect(withoutComments(html)).toBe("");
  });

  it("does not placeholder an embed with no source", async () => {
    // Same contract, second block: an iframe with an empty `src` loads the
    // current page inside itself.
    const html = await renderNode(node("core/embed", {}, { cssId: "player" }));

    expect(html).not.toContain("data-nx-block-placeholder");
    expect(withoutComments(html)).toBe("");
  });

  /** Renders a node whose block returns exactly `value`. */
  async function renderReturning(
    value: unknown,
    name: string
  ): Promise<string> {
    const block = defineBlock({
      name,
      version: 1,
      description: "Returns a fixed value.",
      example: { props: {} },
      render: () => value as ReactElement,
    });
    const stream = await renderToReadableStream(
      <BlockBoundary
        node={{ id: "n1", type: name, version: 1, props: {}, cssId: "anchor" }}
        context={context()}
        blocks={createBlockResolver([block as AnyBlockDefinition])}
        classes={{ n1: "nx-node" }}
      />
    );
    return new Response(stream).text();
  }

  // The two blocks above reach "renders nothing" by returning `null`, but that
  // is not the only value React draws as nothing, and a rule written for one
  // member of a family silently excludes the rest. `false` is what the ordinary
  // conditional form `enabled && <element />` produces when disabled, which
  // makes it the shape a plugin author is most likely to hit.
  it.each([
    ["false, the disabled arm of a conditional", false],
    ["true", true],
    ["an empty string", ""],
    // The same intent spelled as a list. `normalizeRenderable` materialises an
    // iterable root into an array, so a map over an empty collection arrives as
    // `[]` and a list of disabled conditionals as `[false, false]`.
    ["an empty list", []],
    ["a list of nothing", [false, null, undefined, ""]],
    ["a nested list of nothing", [[], [false]]],
    // Any iterable a block RETURNS, because the normalizer materialises it into
    // an array this renderer owns before anything here reads it.
    ["an empty set", new Set()],
  ])("does not placeholder a block returning %s", async (label, value) => {
    const html = await renderReturning(
      value,
      `test/nothing-${label.replace(/[^a-z]+/gi, "-")}`
    );

    expect(html).not.toContain("data-nx-block-placeholder");
    expect(withoutComments(html)).toBe("");
  });

  it.each([
    ["an empty fragment", <></>],
    ["a fragment of nothing", <>{[]}</>],
    ["a fragment of an empty set", <>{new Set()}</>],
    [
      "a fragment wrapping falsy children",
      <>
        {false}
        {null}
      </>,
    ],
    [
      "a hidden Activity with children",
      <Activity mode="hidden">
        <div>x</div>
      </Activity>,
    ],
    ["an empty StrictMode", <StrictMode>{null}</StrictMode>],
    [
      "an empty Profiler",
      <Profiler id="p" onRender={() => {}}>
        {null}
      </Profiler>,
    ],
    ["an empty Activity", <Activity mode="visible">{null}</Activity>],
    [
      "an empty context provider",
      <TestContext.Provider value="v">{null}</TestContext.Provider>,
    ],
    ["an empty Suspense", <Suspense fallback={<b>wait</b>}>{null}</Suspense>],
  ])(
    "keeps the diagnostic for %s, which only the block can vouch for",
    async (label, value) => {
      // Emptiness is judged ONLY from what this renderer owns. A wrapper the
      // block built is not that: its children, its `value`, its `key` and `ref`,
      // and any iterator inside it are all author-controlled, and React reads
      // every one of them AGAIN after this check has returned. An exemption
      // granted on a reading React need not repeat is one the author can
      // invalidate afterwards, so it is not granted at all.
      //
      // So a node asking for an anchor on a wrapper root keeps its diagnostic,
      // and a block that genuinely draws nothing says so through
      // `rendersNothing`, which is computed from props and cannot vary.
      const html = await renderReturning(
        value,
        `test/wrapper-${label.replace(/[^a-z]+/gi, "-")}`
      );

      expect(html).toContain('data-nx-block-placeholder="invalid-output"');
    }
  );

  it("takes the block's own word for it, whatever the output looks like", async () => {
    // The sound channel, and the reason narrowing the inspection costs nothing a
    // block cannot recover. `rendersNothing` is answered from the node's PROPS,
    // which this renderer already holds and no author code can change between
    // now and React's read.
    const declared = defineBlock({
      name: "test/declares-nothing",
      version: 1,
      description: "Returns a wrapper and declares it draws nothing.",
      example: { props: {} },
      rendersNothing: () => true,
      render: () => <>{new Set()}</>,
    });
    const stream = await renderToReadableStream(
      <BlockBoundary
        node={{
          id: "n1",
          type: "test/declares-nothing",
          version: 1,
          props: {},
          cssId: "anchor",
        }}
        context={context()}
        blocks={createBlockResolver([declared as AnyBlockDefinition])}
        classes={{ n1: "nx-node" }}
      />
    );
    const html = await new Response(stream).text();

    expect(html).not.toContain("data-nx-block-placeholder");
  });

  it("asks the declaration before the render, not after", async () => {
    // The contract says this answer is about the STORED props. A block that
    // mutates its own props while building output would otherwise be judged on
    // what the render left behind — declaring itself empty while holding
    // elements, and taking the node's anchor down with it.
    const mutating = defineBlock({
      name: "test/mutates-its-props",
      version: 1,
      description: "Mutates props while rendering.",
      example: { props: {} },
      rendersNothing: (props: { drawn?: boolean }) => props.drawn !== true,
      render: ({ props }) => {
        (props as { drawn?: boolean }).drawn = true;
        return <>{null}</>;
      },
    });
    const stream = await renderToReadableStream(
      <BlockBoundary
        node={{
          id: "n1",
          type: "test/mutates-its-props",
          version: 1,
          props: {},
          cssId: "anchor",
        }}
        context={context()}
        blocks={createBlockResolver([mutating as AnyBlockDefinition])}
        classes={{ n1: "nx-node" }}
      />
    );
    const html = await new Response(stream).text();

    // Answered from the props as STORED — `drawn` absent, so it declared empty
    // — rather than from the object the render mutated on its way past.
    expect(html).not.toContain("data-nx-block-placeholder");
  });

  it("contains a declaration that answers with a rejecting promise", async () => {
    // A JavaScript plugin can write `async rendersNothing`. The answer is not a
    // boolean, so it declares nothing — but an unhandled rejection would take
    // the process down under Node's default `--unhandled-rejections=throw`,
    // after this boundary has already returned.
    const asyncDeclaration = defineBlock({
      name: "test/async-declaration",
      version: 1,
      description: "Declares with a promise that rejects.",
      example: { props: {} },
      rendersNothing: (() =>
        Promise.reject(new Error("hostile async declaration"))) as unknown as (
        props: object
      ) => boolean,
      render: () => <>{null}</>,
    });
    const stream = await renderToReadableStream(
      <BlockBoundary
        node={{
          id: "n1",
          type: "test/async-declaration",
          version: 1,
          props: {},
          cssId: "anchor",
        }}
        context={context()}
        blocks={createBlockResolver([asyncDeclaration as AnyBlockDefinition])}
        classes={{ n1: "nx-node" }}
      />
    );
    const html = await new Response(stream).text();

    // A non-boolean answer is no declaration, so the wrapper root keeps its
    // diagnostic; the rejection is handled rather than left to the process.
    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it("ignores a declaration that throws rather than losing the page", async () => {
    // It is plugin code, called outside the render's own try/catch. A throw here
    // means no declaration, not an error.
    const hostile = defineBlock({
      name: "test/declaration-throws",
      version: 1,
      description: "Throws while declaring.",
      example: { props: {} },
      rendersNothing: () => {
        throw new Error("hostile declaration");
      },
      render: () => <>{null}</>,
    });
    const stream = await renderToReadableStream(
      <BlockBoundary
        node={{
          id: "n1",
          type: "test/declaration-throws",
          version: 1,
          props: {},
          cssId: "anchor",
        }}
        context={context()}
        blocks={createBlockResolver([hostile as AnyBlockDefinition])}
        classes={{ n1: "nx-node" }}
      />
    );
    const html = await new Response(stream).text();

    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
  });

  it("keeps the diagnostic for a list whose members are still pending", async () => {
    // The contract's edge, pinned rather than left to be rediscovered. A list
    // holding a promise cannot be judged empty synchronously: the normalizer
    // has already substituted a Suspense wrapper for the promise, so the list
    // is non-empty at the moment the root decision is made.
    //
    // It keeps the diagnostic, and that is the deliberate side. A LIST can
    // never carry the node's `cssId` whatever it resolves to, so the node asked
    // for an anchor that was never going to exist. The emptiness exemption is
    // for a block that drew nothing at all, not for one whose root shape cannot
    // hold the fields — and a visible false alarm is the error this module
    // chooses over a silently dropped anchor.
    const html = await renderReturning(
      [Promise.resolve(null)],
      "test/async-empty-list"
    );

    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
  });

  it("still treats a suspending Suspense as output", async () => {
    // The control for including Suspense: children that CAN suspend make the
    // fallback real, so this draws and must keep its diagnostic.
    const pending = new Promise<string>(() => {});
    const html = await renderReturning(
      <Suspense fallback={<b>wait</b>}>{pending}</Suspense>,
      "test/suspending"
    );

    expect(html).toContain("data-nx-block-placeholder");
  });

  it("refuses a fragment whose props are missing", async () => {
    // A forged element passing `isValidElement`. Treating it as deliberately
    // empty would let it through to React, which throws reading its props and
    // takes the page; it is unusable output, not an empty block.
    // Derived from a REAL element so `$$typeof` is whatever this React uses —
    // a hand-written `Symbol.for("react.element")` is not an element in React
    // 19 and would be refused as a plain object, never reaching this branch.
    const forged = { ...(<></>), props: null };

    const html = await renderReturning(forged, "test/forged-fragment");

    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
  });

  it("refuses a wrapper whose props throw on the way in", async () => {
    // A forged Activity whose `mode` is a getter that raises. Reading it happens
    // AFTER the block's own try/catch has returned, so an unguarded read costs
    // the page rather than the block. Derived from a real element for the same
    // reason as the fragment above.
    const forged = {
      ...(<Activity mode="visible">{null}</Activity>),
      props: {
        get mode(): string {
          throw new Error("hostile mode");
        },
        children: null,
      },
    };

    const html = await renderReturning(forged, "test/forged-activity");

    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
  });

  it("keeps the diagnostic for a borrowed iterable that answers twice", async () => {
    // Emptiness is judged from a read, and React renders from a LATER one. An
    // iterable that yields differently each time can read empty here and hand
    // React an element, which would then reach the DOM without the `cssId` the
    // node asked for — the exact silent loss the diagnostic exists to prevent.
    // Only an array and a `Set` are trusted, because neither answers by running
    // the block's iterator again.
    // Four passes precede React's: two to classify the iterator as re-readable,
    // one to validate what it holds, and one that judging emptiness would add.
    // Staying empty for all four is what leaves the element for React alone.
    const QUIET_READS = 4;
    let reads = 0;
    const shifting: Iterable<unknown> = {
      [Symbol.iterator]() {
        const quiet = reads++ < QUIET_READS;
        return (quiet ? [] : [<span key="late">late</span>])[Symbol.iterator]();
      },
    };

    const html = await renderReturning(<>{shifting}</>, "test/shifting-set");

    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
    expect(html).not.toContain("late");
    // Without this the test passes for the wrong reason: one pass fewer and the
    // element appears while emptiness is being judged, so the diagnostic is kept
    // by the ordinary non-empty path and the fix above is never exercised.
    expect(reads).toBeLessThan(QUIET_READS);
  });

  it("keeps the diagnostic for a Set that iterates its own way", async () => {
    // A real `Set` may define its OWN `Symbol.iterator`. Its internal slot stays
    // empty however that iterator behaves, so reading the size alone would
    // declare this empty while React draws whatever the iterator yields — the
    // node's `cssId` dropped with nothing said. Only the built-in iterator can
    // vouch for the slot.
    const shifting = new Set<unknown>();
    let reads = 0;
    Object.defineProperty(shifting, Symbol.iterator, {
      value() {
        const quiet = reads++ < 3;
        return (quiet ? [] : [<span key="late">late</span>])[Symbol.iterator]();
      },
    });

    const html = await renderReturning(
      <>{shifting}</>,
      "test/shifting-set-own"
    );

    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
    expect(html).not.toContain("late");
    // The size never stopped saying zero, so a check that trusted it alone would
    // have called this empty no matter how the iterator behaved.
    expect(shifting.size).toBe(0);
  });

  it("refuses an empty provider whose value cannot be read", async () => {
    // Calling a wrapper empty hands the WRAPPER to React, which reads props this
    // check does not: a provider's `value` is read after the boundary has
    // returned, so a getter that raises there costs the page rather than the
    // block.
    const forged = {
      ...(<TestContext.Provider value="v">{null}</TestContext.Provider>),
      props: {
        get value(): string {
          throw new Error("hostile value");
        },
        children: null,
      },
    };

    const html = await renderReturning(forged, "test/forged-provider");

    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
  });

  it("refuses a provider whose value hides from enumeration", async () => {
    // `Object.values` reports enumerable OWN properties, and React cares about
    // neither: it simply reads `props.value`. A forged element carrying the
    // getter as non-enumerable is invisible to enumeration and not to React, so
    // the read has to be by name.
    const hostile: Record<string, unknown> = { children: null };
    Object.defineProperty(hostile, "value", {
      enumerable: false,
      get(): string {
        throw new Error("hidden hostile value");
      },
    });
    const forged = {
      ...(<TestContext.Provider value="v">{null}</TestContext.Provider>),
      props: hostile,
    };

    const html = await renderReturning(forged, "test/hidden-provider-value");

    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
  });

  it("refuses a provider whose value is inherited", async () => {
    // The other half of the same gap: enumeration of own properties never sees
    // a prototype's accessor, and React still reads through the chain.
    const base = {};
    Object.defineProperty(base, "value", {
      get(): string {
        throw new Error("inherited hostile value");
      },
    });
    const forged = {
      ...(<TestContext.Provider value="v">{null}</TestContext.Provider>),
      props: Object.assign(Object.create(base) as object, { children: null }),
    };

    const html = await renderReturning(forged, "test/inherited-provider-value");

    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
  });

  it("still refuses a single-use iterator inside a fragment", async () => {
    // Not an emptiness question, and the distinction matters: React does not
    // support a single-use iterator as a JSX child at all, so the normalizer
    // refuses one BEFORE emptiness is considered. An empty generator is
    // therefore a placeholder while an empty Set is not.
    const html = await renderReturning(
      <>{(function* () {})()}</>,
      "test/single-use-iterator"
    );

    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
    expect(html).toContain("single-use iterator");
  });

  it("does not let a hostile array method escape the boundary", async () => {
    // `every` is author-controllable: an array can carry its own. Nothing here
    // calls it — the owned-array walk goes by index, exactly as React does, and
    // a wrapper root is never opened at all.
    const hostile = Object.assign([], {
      every() {
        throw new Error("hostile every");
      },
    });

    // Inside a FRAGMENT, which is borrowed. The node carries an anchor, so it
    // keeps its diagnostic — and the point is that it is a DIAGNOSTIC rather
    // than the page dying, which is what calling `every` here would have cost.
    const html = await renderReturning(<>{hostile}</>, "test/hostile-every");

    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
  });

  it.each([
    // The positive controls for the rule above. Widening it to cover every
    // falsy value would swallow `0`, which React renders as the character zero;
    // widening it to cover every list would swallow one that draws real
    // content. Both are output with no element to carry the node's `cssId`, so
    // both stay a diagnostic — the answer any other rootless output gets.
    ["zero", 0],
    ["a list holding zero", [0]],
    [
      "a list of elements",
      [<span key="a">one</span>, <span key="b">two</span>],
    ],
    // A fragment that draws something is a WRAPPER, which is exactly the case
    // the diagnostic exists for: the node asked for an anchor and the block
    // returned no element to put one on.
    [
      "a fragment with elements",
      <>
        <span>one</span>
        <span>two</span>
      </>,
    ],
    ["a fragment holding text", <>words</>],
    ["a set holding an element", new Set([<span key="a">one</span>])],
  ])("still placeholders a block returning %s", async (label, value) => {
    const html = await renderReturning(
      value,
      `test/renders-${label.replace(/[^a-z]+/gi, "-")}`
    );

    expect(html).toContain('data-nx-block-placeholder="invalid-output"');
  });
});

describe("declared empty output", () => {
  // A block that draws nothing still costs a reader: a stylesheet carries its
  // rules, and a rule may name a URL. `rendersNothing` is how a block says so
  // without being rendered, and these pin the answers against the SAME props
  // the render path treats as empty — the two must not drift.
  it.each([
    ["core/image", image, {}, true],
    ["core/image with a direct url", image, { src: "/a.jpg" }, false],
    ["core/image with a media id", image, { mediaId: "m1" }, false],
    // A refused scheme leaves nothing usable, so it is empty for this purpose
    // exactly as `renderImage` treats it.
    [
      "core/image with a refused url",
      image,
      { src: "javascript:alert(1)" },
      true,
    ],
    ["core/embed", embed, {}, true],
    ["core/embed with a url", embed, { src: "https://e.com/v" }, false],
    [
      "core/embed with a refused url",
      embed,
      { src: "javascript:alert(1)" },
      true,
    ],
  ])("%s answers %s", (_label, definition, props, expected) => {
    expect(definition.rendersNothing?.(props as never)).toBe(expected);
  });

  it("agrees with what the render actually produces", async () => {
    // The declaration and the render are written separately on purpose, so this
    // is the assertion that stops them drifting.
    //
    // The stakes changed when the boundary began CONSULTING the declaration. It
    // used to be carried and unread, so drift cost nothing; now a block that
    // says it draws nothing is exempted from the node-fields diagnostic, and a
    // wrong declaration silently drops the anchor the author asked for. So every
    // case is checked in BOTH directions, and through the real render rather
    // than through one of the two blocks.
    const declaredEmpty = [
      { label: "image with nothing", definition: image, props: {} },
      {
        label: "image with a refused scheme",
        definition: image,
        props: { src: "javascript:alert(1)" },
      },
      { label: "embed with nothing", definition: embed, props: {} },
      {
        label: "embed with a refused scheme",
        definition: embed,
        props: { src: "javascript:alert(1)" },
      },
    ] as const;

    for (const { label, definition, props } of declaredEmpty) {
      expect(definition.rendersNothing?.(props as never), label).toBe(true);
    }

    // Every one of them, rendered. `core/image` is asynchronous, which is why it
    // was the one this assertion previously skipped.
    expect(html(await renderImage(args({})))).toBe("");
    expect(html(await renderImage(args({ src: "javascript:alert(1)" })))).toBe(
      ""
    );
    expect(html(renderEmbed(args({})))).toBe("");
    expect(
      html(renderEmbed(args({ src: "javascript:alert(1)", title: "t" })))
    ).toBe("");

    // And the other direction: a block with usable input must NOT declare empty,
    // or a drawing block would be exempted from the diagnostic it needs.
    expect(image.rendersNothing?.({ src: "/a.png" } as never)).toBe(false);
    expect(image.rendersNothing?.({ mediaId: "m1" } as never)).toBe(false);
    expect(embed.rendersNothing?.({ src: "https://e.com/v" } as never)).toBe(
      false
    );
  });
});
