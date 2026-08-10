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
import type { BlockHostPolicy, BlockRenderArgs, PageContext } from "./context";
import { PageRenderer } from "./page-renderer";
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
