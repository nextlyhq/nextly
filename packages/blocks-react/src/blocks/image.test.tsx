// @vitest-environment jsdom
/**
 * Which ELEMENT the image block's defaults land on.
 *
 * `base-styles.test.tsx` derives its checks from every block that declares
 * defaults, and asks whether each declaration reaches the compiled stylesheet.
 * It cannot ask the question this file exists for: a rule can be emitted
 * correctly, against the right class, and still be attached to the wrong
 * element. This block has two render branches — a bare `<img>`, and an `<img>`
 * inside a `<figure>` once it has a caption — and only one of them can be the
 * one the sizing constrains.
 *
 * @module blocks/image.test
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderImage } from "./image";

const TYPE_CLASS = "nx-bt-core--image";

async function draw(caption: string) {
  const { container } = render(
    await renderImage({
      props: {
        src: "https://example.test/wide.png",
        alt: "a wide asset",
        ...(caption === "" ? {} : { caption }),
      },
      className: `nx-pb-node1 ${TYPE_CLASS}`,
    } as never)
  );
  return container;
}

describe("core/image, whichever branch it renders", () => {
  it("puts the type class on the IMG when there is no caption", async () => {
    const img = (await draw("")).querySelector("img");
    expect(img?.className).toContain(TYPE_CLASS);
  });

  it("puts the type class on the IMG when there IS a caption", async () => {
    // The defect this guards: the class used to move wholesale to the figure,
    // so the block's own `max-width`/`height` constrained the WRAPPER while the
    // image inside kept the intrinsic size its width/height attributes declare
    // — and a captioned asset wider than its column overflowed a figure that
    // measured correctly.
    const container = await draw("a caption");
    expect(container.querySelector("figure")).not.toBeNull();
    expect(container.querySelector("img")?.className).toContain(TYPE_CLASS);
  });

  it("leaves the node's own classes on the figure, which is the root", async () => {
    // The type class rides both; the per-node class must not, or two elements
    // answer to one node's identity.
    const container = await draw("a caption");
    expect(container.querySelector("figure")?.className).toContain(
      "nx-pb-node1"
    );
    expect(container.querySelector("img")?.className).not.toContain(
      "nx-pb-node1"
    );
  });
});
