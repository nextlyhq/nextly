/**
 * An Accordion as an author adds it and a visitor opens it: three matching
 * questions to start, one open at a time with no script, the first open, the
 * titles as headings, and a toggle a finger and a keyboard can find.
 *
 * The no-script half is what a browser does with the markup, so these
 * assertions are about the markup a browser is handed: the shared `name`
 * that makes `<details>` elements close each other, and the `open` attribute
 * only on the section that starts open. That the browser then behaves is the
 * browser tests' (`e2e/tests/accordion-no-script.spec.ts`).
 *
 * @module blocks/accordion-questions.test
 */
import {
  DISCLOSURE_ICON_CLASS,
  expandSlotDefaults,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import type { ReactElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandaloneContext } from "../context";
import { PageRenderer } from "../page-renderer";
import { createBlockResolver } from "../resolver";
import { resolvePageStyles } from "../styles";

import { accordion } from "./accordion";
import { accordionItem, ACCORDION_ITEM_BLOCK } from "./accordion-item";
import { coreBlocks } from "./index";

const resolver = createBlockResolver([...coreBlocks]);
const CONTEXT = {
  breakpoints: {
    viewport: [{ id: "base", label: "Desktop" }],
    container: [],
  },
};
const source = { get: (name: string) => resolver.get(name) } as never;

/** The words a Text holds, as one paragraph's text. */
function wordsOf(node: BlockNode | undefined): string {
  return JSON.stringify(node?.props.text ?? null);
}

describe("a new Accordion", () => {
  const slots = expandSlotDefaults("core/accordion", source);
  const questions = slots?.children ?? [];

  it("starts with three questions, Question 1 to Question 3", () => {
    expect(questions.map(each => each.type)).toEqual([
      ACCORDION_ITEM_BLOCK,
      ACCORDION_ITEM_BLOCK,
      ACCORDION_ITEM_BLOCK,
    ]);
    expect(questions.map(each => each.props.title)).toEqual([
      "Question 1",
      "Question 2",
      "Question 3",
    ]);
  });

  it("gives each question one Text, 'Write the answer here.'", () => {
    for (const question of questions) {
      const answer = question.slots?.children ?? [];
      expect(answer.map(each => each.type)).toEqual(["core/text"]);
      expect(wordsOf(answer[0])).toContain('"text":"Write the answer here."');
    }
  });

  it("mints its own ids for every question and answer", () => {
    const ids = questions.flatMap(question => [
      question.id,
      ...(question.slots?.children ?? []).map(each => each.id),
    ]);
    expect(new Set(ids).size).toBe(6);
  });

  it("opens one at a time, its first open, with Heading 3 titles", () => {
    expect(accordion.defaultProps).toMatchObject({
      openMode: "one",
      firstOpen: true,
      titlesAs: "h3",
    });
  });

  it("is named Question in the editor, with its title called Question", () => {
    expect(accordionItem.editor?.label).toBe("Question");
    expect(accordionItem.props?.title?.label).toBe("Question");
    // Edited on the canvas: the title is declared inline, and marked below.
    expect(accordionItem.props?.title?.inline).toBe(true);
  });

  it("offers Open, First open and Titles as in Behaviour", () => {
    expect(accordion.props?.openMode).toMatchObject({
      label: "Open",
      section: "Behaviour",
      options: ["one", "many"],
      optionLabels: { one: "One at a time", many: "Many" },
    });
    expect(accordion.props?.firstOpen).toMatchObject({
      label: "First open",
      section: "Behaviour",
      type: "checkbox",
    });
    expect(accordion.props?.titlesAs?.section).toBe("Behaviour");
  });
});

describe("a Question's answer", () => {
  it("holds any block, not only text", () => {
    // No allow-list: a picture, a button and a list may all go in.
    expect(accordionItem.slots?.children?.allow).toBeUndefined();
    const answer = expandSlotDefaults(ACCORDION_ITEM_BLOCK, source);
    // Must-be-found: the slot is declared and starts with a Text.
    expect(answer?.children?.map(each => each.type)).toEqual(["core/text"]);
  });
});

/** A page of one accordion holding questions with these own props. */
function page(
  props: Record<string, unknown>,
  questions: Record<string, unknown>[] = [
    { title: "One", open: false },
    { title: "Two", open: false },
    { title: "Three", open: false },
  ],
  id = "acc"
): BlockNode {
  return {
    id,
    type: "core/accordion",
    version: 1,
    props: { as: "div", contained: false, ...props },
    slots: {
      children: questions.map((each, index) => ({
        id: `${id}-q${index}`,
        type: ACCORDION_ITEM_BLOCK,
        version: 1,
        props: each,
        slots: { children: [] },
      })),
    },
  } as unknown as BlockNode;
}

function markup(...nodes: BlockNode[]): string {
  const document = {
    formatVersion: 1,
    kind: "page",
    nodes,
  } as unknown as BlockDocument;
  return renderToStaticMarkup(
    <PageRenderer
      document={document}
      blocks={resolver}
      styles={resolvePageStyles(document, undefined, CONTEXT, resolver)}
    />
  );
}

/** Each `<details>` opening tag, in order. */
function detailsTags(html: string): string[] {
  return [...html.matchAll(/<details[^>]*>/g)].map(match => match[0]);
}

/** The `name` a `<details>` tag carries, or `undefined`. */
function nameOf(tag: string): string | undefined {
  return /\bname="([^"]*)"/.exec(tag)?.[1];
}

describe("One at a time, on the page", () => {
  it("gives every question one shared name, so opening one closes the others", () => {
    const tags = detailsTags(markup(page({ openMode: "one" })));
    expect(tags).toHaveLength(3);
    const names = tags.map(nameOf);
    expect(names[0]).toBeTruthy();
    expect(new Set(names).size).toBe(1);
  });

  it("names two accordions apart, so one never closes the other's", () => {
    const html = markup(
      page({ openMode: "one" }, undefined, "a1"),
      page({ openMode: "one" }, undefined, "a2")
    );
    const names = new Set(detailsTags(html).map(nameOf));
    expect(names.size).toBe(2);
  });

  it("opens the first question while First open is on, and only it", () => {
    const tags = detailsTags(
      markup(
        page({ openMode: "one", firstOpen: true }, [
          { title: "One", open: false },
          // Its own "Open by default" is hidden while one opens at a time,
          // so a stored one is not drawn open.
          { title: "Two", open: true },
        ])
      )
    );
    expect(tags.map(tag => /\bopen=""/.test(tag))).toEqual([true, false]);
  });

  it("opens none while First open is off", () => {
    const tags = detailsTags(
      markup(page({ openMode: "one", firstOpen: false }))
    );
    expect(tags.some(tag => /\bopen=""/.test(tag))).toBe(false);
  });

  it("gives a nested accordion a group of its own", () => {
    const inner = page({ openMode: "one" }, undefined, "inner");
    const outer = page({ openMode: "one" }, [{ title: "Outer" }], "outer");
    (outer.slots?.children?.[0] as BlockNode).slots = { children: [inner] };
    const tags = detailsTags(markup(outer));
    expect(tags).toHaveLength(4);
    expect(nameOf(tags[0] ?? "")).not.toBe(nameOf(tags[1] ?? ""));
    expect(new Set(tags.slice(1).map(nameOf)).size).toBe(1);
  });
});

describe("First open, in a Collection list", () => {
  /** A page drawn to the end, so a list's entries are read and drawn. */
  async function streamed(element: ReactElement): Promise<string> {
    const stream = await renderToReadableStream(element, {
      onError(error) {
        throw error;
      },
    });
    await stream.allReady;
    return await new Response(stream).text();
  }

  it("opens the first question an entry shows, when its conditions hide the first stored", async () => {
    const shown = page({ openMode: "one", firstOpen: true }, [
      { title: "Featured" },
      { title: "Two" },
      { title: "Three" },
    ]);
    // The first question shows only for a featured post.
    const [first] = shown.slots?.children ?? [];
    (first as { visibility?: unknown }).visibility = {
      conditions: [[{ field: "featured", op: "is_true" }]],
    };
    const document = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "loop",
          type: "core/collection-loop",
          version: 1,
          props: { collection: "posts", limit: 2 },
          slots: { children: [shown] },
        },
      ],
    } as unknown as BlockDocument;
    const html = await streamed(
      <PageRenderer
        document={document}
        blocks={resolver}
        siteStyles={false}
        // Drawn as an editor draws a list, judging each entry's conditions
        // and drawing nothing in a hidden question's place.
        itemHiddenAs={() => undefined}
        context={createStandaloneContext({
          data: {
            find: () =>
              Promise.resolve({
                items: [
                  { id: "1", featured: true },
                  { id: "2", featured: false },
                ],
              }),
          },
          fieldShapes: {
            fieldsOf: ref =>
              "collection" in ref && ref.collection === "posts"
                ? [{ name: "featured", type: "checkbox" }]
                : undefined,
          },
        })}
      />
    );
    const opened = detailsTags(html).map(tag => /\bopen=""/.test(tag));
    // The featured post draws all three, its first open; the other draws
    // Two and Three, and opens Two, the first it shows.
    expect(opened).toEqual([true, false, false, true, false]);
  });
});

describe("Many, on the page", () => {
  it("gives the questions no shared name, so each opens alone", () => {
    const tags = detailsTags(markup(page({ openMode: "many" })));
    expect(tags.map(nameOf)).toEqual([undefined, undefined, undefined]);
  });

  it("is what an accordion stored before the setting reads as", () => {
    const tags = detailsTags(
      markup(
        page({}, [
          { title: "One", open: false },
          { title: "Two", open: true },
        ])
      )
    );
    expect(tags.map(nameOf)).toEqual([undefined, undefined]);
    // Each question opens by its own setting, as it always did.
    expect(tags.map(tag => /\bopen=""/.test(tag))).toEqual([false, true]);
  });

  it("opens each question set to open, and the first while First open is on", () => {
    const tags = detailsTags(
      markup(
        page({ openMode: "many", firstOpen: true }, [
          { title: "One", open: false },
          { title: "Two", open: true },
          { title: "Three", open: false },
        ])
      )
    );
    expect(tags.map(tag => /\bopen=""/.test(tag))).toEqual([true, true, false]);
  });
});

describe("the toggle a visitor presses", () => {
  const html = markup(page({ openMode: "one" }));

  it("hides the icon from screen readers", () => {
    expect(html).toContain(
      `<span class="${DISCLOSURE_ICON_CLASS}" aria-hidden="true"></span>`
    );
  });

  it("is at least 44px tall, and shows a ring when focused from the keyboard", () => {
    const toggle = /<summary class="([^"]+)">/.exec(html)?.[1];
    expect(toggle).toBeTruthy();
    const rule = (selector: string): string =>
      new RegExp(`${selector}[^{]*\\{([^}]*)\\}`).exec(html)?.[1] ?? "";
    const part = (toggle ?? "").split(" ").pop() ?? "";
    expect(rule(`\\.${part}\\)`)).toMatch(/min-height: 44px/);
    const focused = rule(`\\.${part}:where\\(:focus-visible\\)\\)`);
    expect(focused).toMatch(/outline-style: solid/);
    expect(focused).toMatch(/outline-color: currentColor/);
  });

  it("draws a plus by default, which turns to a minus while open", () => {
    // The plus glyph's vertical stroke, and the minus over it while open.
    expect(html).toContain(encodeURIComponent("M8 3.5v9"));
    expect(html).toMatch(
      /details\[open\] > summary > \.nx-pb-disclosure-icon[^{]*\{[^}]*M3\.5%208h9/
    );
  });

  it("draws a stored Browser default as the plus too", () => {
    const stored = page({ openMode: "one" });
    stored.styles = { base: { base: { disclosureIcon: "browser" } } } as never;
    const out = markup(stored);
    expect(out).not.toMatch(/list-style: revert/);
    expect(out).toContain(encodeURIComponent("M8 3.5v9"));
  });
});
