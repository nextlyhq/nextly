/**
 * One host list, asked by every channel a page fetches through.
 *
 * A block writes an `<iframe src>`; a page's compiled stylesheet writes
 * `url(...)` into a rule that fires wherever it applies; and the SITE sheet
 * writes the same thing for the named-class and block-default tiers, on every
 * page of the site at once. All three turn a stored value into a request, so a
 * policy answered by only some of them is not a policy — and the failure would
 * be invisible, because the channels still working look correct.
 *
 * The site sheet is the one that was missing, and it is the widest: it is
 * emitted on every page and it is emitted FIRST, so a page sheet that merely
 * omits a declaration cannot retract one it already carried.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { NodeStyles, RemotePattern } from "@nextlyhq/blocks-engine";

import { renderEmbed } from "./blocks/embed";
import { renderImage } from "./blocks/image";
import type { BlockHostPolicy, BlockRenderArgs, PageContext } from "./context";
import type { PageStyles } from "./styles";
import { PageRenderer } from "./page-renderer";
import { effectiveCompile, fetchPolicyLabel } from "./styles";
import { createBlockResolver } from "./resolver";
import { sharedStyleInputsId } from "./shared-style-inputs";
import { coreBlocks } from "./blocks";
import { withTypographyDefaults } from "./blocks/typography-defaults";

const ALLOWED: readonly RemotePattern[] = [
  { protocol: "https", hostname: "player.allowed.test" },
];

function context(): PageContext {
  return {
    entry: null,
    data: { find: () => Promise.resolve({ items: [], total: 0 }) },
    resolveMedia: () => Promise.resolve(null),
    resolveEntryPath: () => Promise.resolve(null),
  };
}

function embedArgs<P>(
  props: P,
  hostPolicy?: BlockHostPolicy
): BlockRenderArgs<P> {
  return {
    props,
    node: { id: "n1", type: "core/embed", version: 1, props: {} },
    className: "nx-n1",
    ctx: context(),
    renderSlot: () => null,
    ...(hostPolicy === undefined ? {} : { hostPolicy }),
  };
}

function styledDocument(url: string): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "n1",
        type: "core/text",
        version: 1,
        props: { text: "body" },
        styles: { base: { base: { background: { url } } } },
      },
    ],
  };
}

async function pageCss(
  url: string,
  hostPolicy?: BlockHostPolicy
): Promise<string> {
  const markup = renderToStaticMarkup(
    <PageRenderer
      document={styledDocument(url)}
      blocks={createBlockResolver(coreBlocks)}
      styleContext={{ breakpoints: { viewport: [], container: [] } }}
      {...(hostPolicy === undefined ? {} : { hostPolicy })}
    />
  );
  return markup;
}

/**
 * The markup for a page whose SITE sheet carries a stored class with a `url()`.
 *
 * Deliberately renders with NO `styleContext`, which is the ordinary production
 * path — a consumer showing a stored artifact supplies none — and is exactly
 * where reading the predicate off the reconciled compile context would have
 * found `undefined` and asked nothing.
 */
function siteSheetMarkup(
  url: string,
  hostPolicy?: BlockHostPolicy,
  ownPredicate?: (candidate: string) => boolean
): string {
  return renderToStaticMarkup(
    <PageRenderer
      document={{
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          { id: "n1", type: "core/text", version: 1, props: { text: "body" } },
        ],
      }}
      blocks={createBlockResolver(coreBlocks)}
      siteStyles={{
        breakpoints: { viewport: [], container: [] },
        classes: [
          {
            id: "c1",
            slug: "tracked",
            orderIndex: 0,
            styles: {
              base: { base: { background: { url } } },
            } as unknown as NodeStyles,
          },
        ],
        ...(ownPredicate === undefined ? {} : { mayFetchUrl: ownPredicate }),
      }}
      {...(hostPolicy === undefined ? {} : { hostPolicy })}
    />
  );
}

/** The shared inputs both reuse cases render under. */
const EMPTY_BREAKPOINTS = {
  breakpoints: { viewport: [], container: [] },
};

describe("the one derived fetch predicate", () => {
  // Identity, not equivalence. Two closures over the same pattern list behave
  // alike today and are two implementations of one policy — the shape this
  // module exists to prevent — so the property worth asserting is that the site
  // sheet and the page context receive the SAME function object.
  it("hands the page context the same function it hands the site sheet", () => {
    const result = effectiveCompile({
      styleContext: { breakpoints: { viewport: [], container: [] } },
      styles: undefined,
      limits: undefined,
      remotePatterns: ALLOWED,
    });

    expect(result.mayFetchUrl).toBeTypeOf("function");
    expect(result.context?.mayFetchUrl).toBe(result.mayFetchUrl);
  });

  it("keeps a caller's own predicate as that one function", () => {
    const own = (): boolean => true;
    const result = effectiveCompile({
      styleContext: {
        breakpoints: { viewport: [], container: [] },
        mayFetchUrl: own,
      },
      styles: undefined,
      limits: undefined,
      remotePatterns: ALLOWED,
    });

    expect(result.mayFetchUrl).toBe(own);
    expect(result.context?.mayFetchUrl).toBe(own);
  });

  it("derives nothing when the host configured no list", () => {
    const result = effectiveCompile({
      styleContext: { breakpoints: { viewport: [], container: [] } },
      styles: undefined,
      limits: undefined,
      remotePatterns: undefined,
    });

    expect(result.mayFetchUrl).toBeUndefined();
    expect(result.context?.mayFetchUrl).toBeUndefined();
  });
});

describe("the site sheet's share of the host fetch list", () => {
  it("emits an allowed host, which is the control for every absence below", () => {
    expect(
      siteSheetMarkup("https://player.allowed.test/a.png", {
        remotePatterns: ALLOWED,
      })
    ).toContain("player.allowed.test");
  });

  it("refuses an unlisted host in the SITE sheet, with no style context at all", () => {
    expect(
      siteSheetMarkup("https://cdn.other.test/a.png", {
        remotePatterns: ALLOWED,
      })
    ).not.toContain("cdn.other.test");
  });

  it("asks nothing when the host configured no list", () => {
    expect(siteSheetMarkup("https://cdn.other.test/a.png")).toContain(
      "cdn.other.test"
    );
  });

  it("keeps a predicate set on siteStyles over one derived from the list", () => {
    // The same precedence the style context gets: a caller who passed one meant
    // it, and deriving one here would silently replace it.
    expect(
      siteSheetMarkup(
        "https://cdn.other.test/a.png",
        { remotePatterns: ALLOWED },
        () => true
      )
    ).toContain("cdn.other.test");
  });
});

describe("the host fetch list", () => {
  it("lets an allowed origin through both channels", async () => {
    // The positive control for everything below. Both assertions here must hold
    // before a later "it is absent" means the policy refused it, rather than
    // that nothing was ever written in the first place.
    const policy: BlockHostPolicy = { remotePatterns: ALLOWED };

    const frame = renderToStaticMarkup(
      renderEmbed(
        embedArgs({ src: "https://player.allowed.test/v", title: "t" }, policy)
      )
    );
    expect(frame).toContain("player.allowed.test");

    const css = await pageCss("https://player.allowed.test/a.png", policy);
    expect(css).toContain("player.allowed.test");
  });

  it("refuses an unlisted host in a block's own markup", () => {
    const out = renderEmbed(
      embedArgs(
        { src: "https://player.other.test/v", title: "t" },
        { remotePatterns: ALLOWED }
      )
    );
    // Nothing at all rather than an empty frame: a frame with no usable source
    // loads the page inside itself in several browsers.
    expect(out).toBeNull();
  });

  it("refuses an unlisted host in the compiled stylesheet", async () => {
    const css = await pageCss("https://cdn.other.test/a.png", {
      remotePatterns: ALLOWED,
    });
    expect(css).not.toContain("cdn.other.test");
  });

  it("asks nothing when the host configured no list", async () => {
    // Absent means unasked, not allowed-nothing. A host that configures nothing
    // must render exactly as it did before this existed, through both channels.
    const frame = renderToStaticMarkup(
      renderEmbed(embedArgs({ src: "https://player.other.test/v", title: "t" }))
    );
    expect(frame).toContain("player.other.test");

    const css = await pageCss("https://cdn.other.test/a.png");
    expect(css).toContain("cdn.other.test");
  });

  it("keeps a caller's own predicate over one derived from the list", async () => {
    // The more specific answer wins. A host that passed `mayFetchUrl` on the
    // style context meant it, and deriving one here would silently replace it.
    const markup = renderToStaticMarkup(
      <PageRenderer
        document={styledDocument("https://cdn.other.test/a.png")}
        blocks={createBlockResolver(coreBlocks)}
        styleContext={{
          breakpoints: { viewport: [], container: [] },
          mayFetchUrl: () => true,
        }}
        hostPolicy={{ remotePatterns: ALLOWED }}
      />
    );
    expect(markup).toContain("cdn.other.test");
  });
});

describe("core/image", () => {
  function imageArgs<P>(
    props: P,
    hostPolicy?: BlockHostPolicy,
    mediaUrl?: string
  ) {
    return {
      props,
      node: { id: "n1", type: "core/image", version: 1, props: {} },
      className: "nx-n1",
      ctx: {
        ...context(),
        resolveMedia: () =>
          Promise.resolve(
            mediaUrl === undefined ? null : { url: mediaUrl, alt: "a" }
          ),
      },
      renderSlot: () => null,
      ...(hostPolicy === undefined ? {} : { hostPolicy }),
    } as BlockRenderArgs<P>;
  }

  it("refuses an unlisted host on the typed src", async () => {
    const out = await renderImage(
      imageArgs(
        { src: "https://cdn.other.test/a.png", alt: "x" },
        {
          remotePatterns: ALLOWED,
        }
      )
    );
    expect(out).toBeNull();
  });

  it("refuses an unlisted host the RESOLVER returned", async () => {
    // The resolver is trusted code, but the URL it hands back came out of a
    // media record a person filled in, so it names a host on the same terms the
    // typed prop does. Checking one of the pair and not the other is the shape
    // this exact block got wrong before.
    const out = await renderImage(
      imageArgs(
        { mediaId: "m1", alt: "x" },
        { remotePatterns: ALLOWED },
        "https://cdn.other.test/a.png"
      )
    );
    expect(out).toBeNull();
  });

  it("still renders an allowed host through both routes", async () => {
    // The control. Without it, a render that returned null for any reason at
    // all would satisfy both assertions above.
    const typed = await renderImage(
      imageArgs(
        { src: "https://player.allowed.test/a.png", alt: "x" },
        {
          remotePatterns: ALLOWED,
        }
      )
    );
    expect(renderToStaticMarkup(typed)).toContain("player.allowed.test");

    const resolved = await renderImage(
      imageArgs(
        { mediaId: "m1", alt: "x" },
        { remotePatterns: ALLOWED },
        "https://player.allowed.test/b.png"
      )
    );
    expect(renderToStaticMarkup(resolved)).toContain("player.allowed.test");
  });

  it("asks nothing when the host configured no list", async () => {
    const out = await renderImage(
      imageArgs({ src: "https://cdn.other.test/a.png", alt: "x" })
    );
    expect(renderToStaticMarkup(out)).toContain("cdn.other.test");
  });
});

describe("a stored stylesheet records the policy that compiled it", () => {
  const stale: PageStyles = {
    css: ".nx-n1{background-image:url(https://cdn.other.test/a.png)}",
    classes: { n1: "nx-n1" },
  };

  it("does not publish a sheet compiled under another policy", () => {
    // The artifact is a CACHE of a compile, and the fetch list is one of that
    // compile's inputs. A sheet written before the policy existed carries URLs
    // the current rules would refuse, so it cannot be reused just because the
    // document is unchanged.
    const markup = renderToStaticMarkup(
      <PageRenderer
        document={styledDocument("https://player.allowed.test/a.png")}
        blocks={createBlockResolver(coreBlocks)}
        // Stamped for the SHARED inputs, so the only thing that can refuse this
        // artifact is the policy. Left unstamped, the shared-input branch
        // recompiles it first and this test passes with the policy check
        // deleted — it would assert nothing about the policy at all.
        styles={{
          ...stale,
          sharedInputsId: sharedStyleInputsId(
            withTypographyDefaults(EMPTY_BREAKPOINTS)
          ),
        }}
        styleContext={{ breakpoints: { viewport: [], container: [] } }}
        hostPolicy={{ remotePatterns: ALLOWED }}
      />
    );
    expect(markup).not.toContain("cdn.other.test");
  });

  it("reuses a sheet stamped with the policy in force", () => {
    // The control, and the reason the stamp exists rather than recompiling
    // always: a sheet that WAS compiled under this policy is still served from
    // the store, so a site with a policy does not pay a compile per render.
    const stamped: PageStyles = {
      ...stale,
      css: ".nx-n1{color:rebeccapurple}",
      fetchPolicyId: fetchPolicyLabel(ALLOWED),
      // Stamped with the shared inputs too, because this asserts reuse and a
      // sheet is reused only when EVERY stamp it carries still describes the
      // render. Without this the artifact is refused for the shared inputs and
      // the test would pass or fail for a reason other than the policy.
      sharedInputsId: sharedStyleInputsId(
        withTypographyDefaults(EMPTY_BREAKPOINTS)
      ),
    };
    const markup = renderToStaticMarkup(
      <PageRenderer
        document={styledDocument("https://player.allowed.test/a.png")}
        blocks={createBlockResolver(coreBlocks)}
        styles={stamped}
        styleContext={{ breakpoints: { viewport: [], container: [] } }}
        hostPolicy={{ remotePatterns: ALLOWED }}
      />
    );
    expect(markup).toContain("rebeccapurple");
  });

  it("labels the same policy the same however it is written", () => {
    // Order is cosmetic; a reordering that changed the label would recompile
    // every stored sheet on a site for nothing.
    const a = fetchPolicyLabel([
      { protocol: "https", hostname: "a.test" },
      { protocol: "https", hostname: "b.test" },
    ]);
    const b = fetchPolicyLabel([
      { protocol: "https", hostname: "b.test" },
      { protocol: "https", hostname: "a.test" },
    ]);
    expect(a).toBe(b);
    // An EMPTY list allows no remote host and is a real policy; having no list
    // asks nothing. They must not label the same.
    expect(fetchPolicyLabel([])).not.toBe(fetchPolicyLabel(undefined));
    expect(fetchPolicyLabel(undefined)).toBeUndefined();
  });
});

describe("the policy label as a stored value", () => {
  it("carries no character a JSON column cannot hold", () => {
    // The label is persisted INSIDE the stylesheet artifact, and that artifact
    // is written to a JSON column. PostgreSQL's text-backed JSON types cannot
    // represent a NUL at all, so a separator picked for being impossible in a
    // hostname is also impossible to store — and the failure would be a save
    // that only errors once a site turns the policy on.
    const label = fetchPolicyLabel([
      { protocol: "https", hostname: "cdn.example", pathname: "/img/**" },
      { protocol: "http", hostname: "*.other.test" },
    ]);
    expect(label).toBeDefined();
    for (const character of label ?? "") {
      expect(character.codePointAt(0)).toBeGreaterThan(0x1f);
    }
    // It has to survive the round trip it will actually make.
    expect(JSON.parse(JSON.stringify({ label })).label).toBe(label);
  });

  it("keeps an omitted field apart from an empty one", () => {
    // `isAllowedRemoteUrl` reads an omitted `port` as "any port" and `port: ""`
    // as "the default port only". Those are different policies, and a label
    // that collapsed them would keep serving a sheet compiled under the broader
    // one after a site tightened to the narrower.
    const anyPort = fetchPolicyLabel([
      { protocol: "https", hostname: "cdn.example" },
    ]);
    const defaultPortOnly = fetchPolicyLabel([
      { protocol: "https", hostname: "cdn.example", port: "" },
    ]);
    expect(anyPort).not.toBe(defaultPortOnly);

    const anyPath = fetchPolicyLabel([
      { protocol: "https", hostname: "a.test" },
    ]);
    const emptyPath = fetchPolicyLabel([
      { protocol: "https", hostname: "a.test", pathname: "" },
    ]);
    expect(anyPath).not.toBe(emptyPath);
  });

  it("does not claim a URL pattern equals the object spelling of it", () => {
    // Written as an assertion of DIFFERENCE, because the difference is real and
    // easy to assume away. `new URL("https://cdn.example/img/**")` answers `""`
    // for both `port` and `search`, and the matcher reads a stated `port` as an
    // exact requirement — so a URL pattern pins the default port and an empty
    // query, while the object without those fields accepts any of either.
    //
    // The label must therefore keep them apart, for exactly the reason it keeps
    // an omitted port apart from an empty one.
    const asObject = fetchPolicyLabel([
      { protocol: "https", hostname: "cdn.example", pathname: "/img/**" },
    ]);
    const asUrl = fetchPolicyLabel([new URL("https://cdn.example/img/**")]);
    expect(asObject).not.toBe(asUrl);

    // The spelling that DOES mean the same labels the same, which is what shows
    // the difference above is about the fields and not about the input type.
    const explicit = fetchPolicyLabel([
      {
        protocol: "https",
        hostname: "cdn.example",
        port: "",
        pathname: "/img/**",
        search: "",
      },
    ]);
    expect(explicit).toBe(asUrl);
  });
});

describe("a caller's own fetch predicate", () => {
  const doc = styledDocument("https://cdn.other.test/a.png");
  const stored: PageStyles = {
    css: ".nx-n1{color:rebeccapurple}",
    classes: { n1: "nx-n1" },
  };

  it("never reuses a stored sheet when the predicate is unidentified", () => {
    // A predicate is opaque: nothing can tell one function from another, so a
    // stored sheet cannot be shown to have been compiled under this one. The
    // safe answer is to recompile, and it must not depend on the pattern list
    // happening to be absent on both sides.
    const markup = renderToStaticMarkup(
      <PageRenderer
        document={doc}
        blocks={createBlockResolver(coreBlocks)}
        // Stamped for the shared inputs, for the reason the sibling refusal
        // test gives: only the unidentified PREDICATE may be what refuses this.
        styles={{
          ...stored,
          sharedInputsId: sharedStyleInputsId(
            withTypographyDefaults(EMPTY_BREAKPOINTS)
          ),
        }}
        styleContext={{
          breakpoints: { viewport: [], container: [] },
          mayFetchUrl: () => true,
        }}
      />
    );
    expect(markup).not.toContain("rebeccapurple");
  });

  it("reuses one when the caller states which policy its predicate is", () => {
    // The control, and the reason the escape hatch exists: a caller that CAN
    // name its policy keeps its sheets cached.
    const markup = renderToStaticMarkup(
      <PageRenderer
        document={doc}
        blocks={createBlockResolver(coreBlocks)}
        styles={{
          ...stored,
          fetchPolicyId: "mine-v3",
          sharedInputsId: sharedStyleInputsId(
            withTypographyDefaults(EMPTY_BREAKPOINTS)
          ),
        }}
        styleContext={{
          breakpoints: { viewport: [], container: [] },
          mayFetchUrl: () => true,
          fetchPolicyId: "mine-v3",
        }}
      />
    );
    expect(markup).toContain("rebeccapurple");
  });
});

describe("the render and the link preview choose the same image", () => {
  // A divergence here is invisible on the page and visible everywhere the link
  // is shared, which is the worst place to find it.
  const both = {
    mediaId: "m1",
    src: "https://player.allowed.test/typed.png",
    alt: "x",
  };

  it("falls through to the typed url when the resolved one is refused", async () => {
    const out = await renderImage({
      props: both,
      node: { id: "n1", type: "core/image", version: 1, props: {} },
      className: "nx-n1",
      ctx: {
        ...context(),
        resolveMedia: () =>
          Promise.resolve({
            url: "https://cdn.other.test/lib.png",
            alt: "library",
          }),
      },
      renderSlot: () => null,
      hostPolicy: { remotePatterns: ALLOWED },
    } as BlockRenderArgs<typeof both>);

    const markup = renderToStaticMarkup(out);
    // The fallback the author wrote is used rather than the block being lost to
    // a setting they cannot see.
    expect(markup).toContain("typed.png");
    expect(markup).not.toContain("cdn.other.test");
    // And the refused record is dropped WHOLE: its alt describes the asset that
    // was refused, so carrying it here would announce one image while showing
    // another.
    expect(markup).not.toContain("library");
  });

  it("renders nothing when neither candidate is allowed", async () => {
    const out = await renderImage({
      props: {
        mediaId: "m1",
        src: "https://cdn.other.test/typed.png",
        alt: "x",
      },
      node: { id: "n1", type: "core/image", version: 1, props: {} },
      className: "nx-n1",
      ctx: {
        ...context(),
        resolveMedia: () =>
          Promise.resolve({
            url: "https://cdn.other.test/lib.png",
            alt: "library",
          }),
      },
      renderSlot: () => null,
      hostPolicy: { remotePatterns: ALLOWED },
    } as BlockRenderArgs<{ mediaId: string; src: string; alt: string }>);

    expect(out).toBeNull();
  });
});

describe("a page RECOMPILED from stored site styles", () => {
  // The route that supplies a stored artifact plus `siteStyles` and states no
  // `styleContext` can now recompile, because the site's own inputs are enough
  // to compile with. What it compiles under is this describe's subject: the site
  // sheet has always honoured `siteStyles.mayFetchUrl`, and the page sheet is
  // emitted AFTER it, so a page compiled under weaker rules publishes a request
  // the shared sheet beside it was refused.
  const URL = "https://cdn.other.test/a.png";

  const page: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "n1",
        type: "core/text",
        version: 1,
        props: { text: "body" },
        // NODE-local, so only a page compile can emit it. A url on the class
        // tier would be emitted by the site sheet and would answer whether THAT
        // honours the predicate, which was never in question.
        styles: { base: { base: { background: { url: URL } } } } as NodeStyles,
      },
    ],
  };

  /** A stored artifact carrying no stamp, so this render must recompile it. */
  const stale: PageStyles = {
    css: ".nx-n1{color:teal}",
    classes: { n1: "nx-n1" },
  };

  function render(mayFetchUrl?: (candidate: string) => boolean) {
    return renderToStaticMarkup(
      <PageRenderer
        document={page}
        blocks={createBlockResolver(coreBlocks)}
        styles={stale}
        siteStyles={{
          breakpoints: { viewport: [], container: [] },
          ...(mayFetchUrl === undefined ? {} : { mayFetchUrl }),
        }}
      />
    );
  }

  it("asks the site's OWN predicate about a node-local url", () => {
    // The defect: with no `styleContext`, the synthesized compile context is
    // built from the site's inputs — and a context that omitted this predicate
    // would leave the recompile asking the host list, or asking nothing at all.
    const markup = render(() => false);

    expect(markup).not.toContain("color:teal");
    expect(markup).not.toContain("cdn.other.test");
  });

  it("CONTROL: emits the same url when the site asks nothing", () => {
    // The separating property. A render that dropped the url unconditionally —
    // or one that never recompiled at all — would satisfy the assertion above
    // while asking no host question anywhere.
    const markup = render();

    expect(markup).not.toContain("color:teal");
    expect(markup).toContain("cdn.other.test");
  });
});
