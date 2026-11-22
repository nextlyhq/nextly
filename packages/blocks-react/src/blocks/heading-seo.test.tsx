/**
 * A heading never speaks for the page's title: the browser tab and a search
 * result read the page's SEO title, else its title in the content type's
 * pattern, never the text of a heading on it.
 *
 * What separates a correct heading from a plausible broken one: walked as
 * the page's metadata is walked, a page opening with a heading of any level
 * derives no title, while the paragraph beside it still offers the page's
 * description (the walk reached the heading's neighbour, so its silence is
 * the heading's own).
 */
import {
  DOCUMENT_FORMAT_VERSION,
  deriveSeoFromDocument,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { HEADING_LEVELS, heading } from "./heading";
import { paragraph } from "./paragraph";

const node = (
  id: string,
  type: string,
  props: Record<string, unknown>
): BlockNode => ({ id, type, version: 1, props });

const definitions = (type: string) =>
  type === "core/heading"
    ? heading
    : type === "core/paragraph"
      ? paragraph
      : undefined;

describe("a heading and the page's title", () => {
  it.each(HEADING_LEVELS)(
    "offers no title at level %s, while the prose beside it still offers the description",
    level => {
      const document: BlockDocument = {
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          node("h", "core/heading", { text: "Plans for every team", level }),
          node("p", "core/paragraph", { text: "Pick the plan that fits." }),
        ],
      };

      const derived = deriveSeoFromDocument(document, definitions, () => true);

      expect(derived.title).toBeUndefined();
      // CONTROL: the walk reached the heading's neighbour.
      expect(derived.description).toBe("Pick the plan that fits.");
    }
  );

  it("offers nothing for the page's head at all", () => {
    expect(
      heading.seo?.({ text: "Plans for every team", level: "h1" })
    ).toBeUndefined();
  });
});
