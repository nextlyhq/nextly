/**
 * @vitest-environment jsdom
 */
/**
 * The card hands the preview the same sections while nothing about them
 * changed.
 *
 * The preview holds the page's render — preparation, migration, every block,
 * the stylesheet compile — behind a memo keyed on the sections it is given. A
 * fresh array on each render of the form around the card re-ran all of it for
 * a page that had not changed. The preview is replaced here by a recorder of
 * what it receives, so the case reads identity directly.
 *
 * @module admin/PageBuilderCard.memo.test
 */
import {
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { pageRenderInputs } from "./page-render-inputs";
import { PageBuilderCard } from "./PageBuilderCard";

const received = vi.hoisted(() => ({ sections: [] as unknown[] }));
vi.mock("./PageMiniature", () => ({
  PageMiniature: (props: { sections?: unknown }) => {
    received.sections.push(props.sections);
    return null;
  },
}));

const TEXT = coreBlocks.find(block => block.name === "core/text");
if (!TEXT) throw new Error("core/text is missing from coreBlocks");

const document = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    { id: "a", type: TEXT.name, version: TEXT.version, props: { text: "A" } },
    { id: "b", type: TEXT.name, version: TEXT.version, props: { text: "B" } },
  ],
} as unknown as BlockDocument;

const props = {
  document,
  siteStyles: undefined,
  styleState: "ready" as const,
  components: { state: "ready" as const, retry: () => {} },
  render: pageRenderInputs({
    siteStyle: undefined,
    clientConfig: undefined,
    previewContainer: undefined,
    limits: DEFAULT_LIMITS,
    definitions: new Map(),
  }),
  canEdit: true,
  href: "/admin/collections/pages/p1/builder?field=body",
  onNavigate: () => {},
};

describe("PageBuilderCard's sections for the preview", () => {
  it("are the same array across renders that change nothing about them", () => {
    const { rerender } = render(<PageBuilderCard {...props} />);
    rerender(<PageBuilderCard {...props} />);

    const [first, second] = received.sections;
    // The control: there ARE sections, so identity is not two `undefined`s.
    expect(Array.isArray(first)).toBe(true);
    expect(second).toBe(first);
  });
});
