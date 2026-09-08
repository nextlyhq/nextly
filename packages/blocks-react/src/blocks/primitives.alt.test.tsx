/**
 * `core/image` alt text, which is an accessibility contract rather than a
 * cosmetic one: a screen reader handed nothing reads the file name instead.
 */
import { describe, expect, it } from "vitest";

import { createStandaloneContext } from "../context";
import { renderImage } from "./image";

function ctxWith(alt?: string) {
  return createStandaloneContext({
    resolveMedia: async () => ({ url: "/photo.png", ...(alt ? { alt } : {}) }),
  });
}

const args = (props: Record<string, unknown>, alt?: string) =>
  ({
    props,
    className: undefined,
    // Required by the render contract; these fixtures declare no parts.
    partClass: () => "",
    ctx: ctxWith(alt),
  }) as never;

describe("core/image alt text", () => {
  it("uses the media record's alt when the placement has none", async () => {
    // Nobody said anything about this placement, so the record's text is what
    // stops a screen reader being handed the file name.
    const el = (await renderImage(args({ mediaId: "m" }, "A tabby cat"))) as {
      props: { alt: string };
    };

    expect(el.props.alt).toBe("A tabby cat");
  });

  it("keeps an explicitly empty alt empty, even when the record has text", async () => {
    // `alt: ""` is this block's DOCUMENTED way to mark an image decorative, and
    // it predates the `decorative` flag. Treating it as "nothing was said" and
    // substituting the record's text would make every existing document using
    // that form start announcing an image the author silenced on purpose.
    const el = (await renderImage(
      args({ mediaId: "m", alt: "" }, "A tabby cat")
    )) as { props: { alt: string } };

    expect(el.props.alt).toBe("");
  });

  it("prefers the author's own alt over the record's", async () => {
    const el = (await renderImage(
      args({ mediaId: "m", alt: "Written for this page" }, "A tabby cat")
    )) as { props: { alt: string } };

    expect(el.props.alt).toBe("Written for this page");
  });

  it("keeps alt empty when the image is marked decorative", async () => {
    // Decorative wins outright: an author saying so means `alt=""` even when
    // the record has text.
    const el = (await renderImage(
      args({ mediaId: "m", alt: "", decorative: true }, "A tabby cat")
    )) as { props: { alt: string } };

    expect(el.props.alt).toBe("");
  });
});
