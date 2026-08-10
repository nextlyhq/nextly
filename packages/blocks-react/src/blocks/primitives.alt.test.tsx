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
    ctx: ctxWith(alt),
  }) as never;

describe("core/image alt text", () => {
  it("uses the media record's alt when the block's is the empty default", async () => {
    // The block ships `alt: ""`, and the old fallback never fired because the
    // empty string reads as a value — so a freshly created image emitted
    // `alt=""` while the record held usable text.
    const el = (await renderImage(
      args({ mediaId: "m", alt: "" }, "A tabby cat")
    )) as { props: { alt: string } };

    expect(el.props.alt).toBe("A tabby cat");
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
