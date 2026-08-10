/**
 * One host list, asked by both channels a page fetches through.
 *
 * A block writes an `<iframe src>`; a compiled stylesheet writes `url(...)` into
 * a rule that fires wherever it applies. Both turn a stored value into a
 * request, so a policy answered by only one of them is not a policy — and the
 * failure would be invisible, because the channel still working looks correct.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { RemotePattern } from "@nextlyhq/blocks-engine";

import { renderEmbed } from "./blocks/embed";
import { renderImage } from "./blocks/image";
import type { BlockHostPolicy, BlockRenderArgs, PageContext } from "./context";
import type { PageStyles } from "./styles";
import { PageRenderer } from "./page-renderer";
import { fetchPolicyLabel } from "./styles";
import { createBlockResolver } from "./resolver";
import { coreBlocks } from "./blocks";

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
      styleContext={{ breakpoints: { base: {} } }}
      {...(hostPolicy === undefined ? {} : { hostPolicy })}
    />
  );
  return markup;
}

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
        styleContext={{ breakpoints: { base: {} }, mayFetchUrl: () => true }}
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
        styles={stale}
        styleContext={{ breakpoints: { base: {} } }}
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
    };
    const markup = renderToStaticMarkup(
      <PageRenderer
        document={styledDocument("https://player.allowed.test/a.png")}
        blocks={createBlockResolver(coreBlocks)}
        styles={stamped}
        styleContext={{ breakpoints: { base: {} } }}
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
