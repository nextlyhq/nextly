// @vitest-environment jsdom
import { TEXT_FORMAT, type RichTextValue } from "@nextlyhq/blocks-engine";
import { render, screen } from "@testing-library/react";
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
