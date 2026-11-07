/**
 * The Entry content block's own rules, judged by validation on every write,
 * and the composition of an entry's blocks into a template for drawing.
 *
 * Each refusal is paired with the document that passes beside it: one Entry
 * content block in a template is the control for a second, and a template is
 * the control for every other kind, so a rule refusing the block everywhere
 * (or nowhere) fails one half.
 */
import { describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION, type BlockDocument } from "./document";
import {
  composeEntryContent,
  ENTRY_CONTENT_SLOT,
  ENTRY_CONTENT_TYPE,
  entryContentPlacements,
  holdsEntryContent,
} from "./entry-content";
import { validate, type ValidationContext } from "./validation";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";

const ctx: ValidationContext = {
  breakpoints: FIXTURE_BREAKPOINTS,
  mode: "forgiving",
};

function entryContent(id: string, field: unknown = "body") {
  return { id, type: ENTRY_CONTENT_TYPE, version: 1, props: { field } };
}

function box(id: string, children: unknown[]) {
  return { id, type: "core/box", version: 1, props: {}, slots: { children } };
}

function text(id: string, words: string) {
  return { id, type: "core/text", version: 1, props: { text: words } };
}

function documentOf(kind: string, ...nodes: unknown[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind,
    nodes,
  } as BlockDocument;
}

/** The Entry content codes validation reports, with where each is. */
function entryContentFindings(document: BlockDocument) {
  return validate(document, ctx)
    .filter(issue => issue.code.startsWith("entry-content-"))
    .map(issue => ({ code: issue.code, path: issue.path }));
}

describe("an Entry content block, judged by validation", () => {
  it("passes once in a template, nested or at the top (the control)", () => {
    expect(
      entryContentFindings(documentOf("template", entryContent("ec")))
    ).toEqual([]);
    expect(
      entryContentFindings(
        documentOf("template", box("b", [entryContent("ec")]))
      )
    ).toEqual([]);
  });

  it("refuses a second one in a template, naming the second", () => {
    expect(
      entryContentFindings(
        documentOf(
          "template",
          entryContent("first"),
          box("b", [entryContent("second")])
        )
      )
    ).toEqual([
      {
        code: "entry-content-duplicate",
        path: "/nodes/1/slots/children/0",
      },
    ]);
  });

  it.each(["page", "component", "pattern", "region"])(
    "refuses one in a document of kind %s",
    kind => {
      expect(
        entryContentFindings(documentOf(kind, entryContent("ec")))
      ).toEqual([{ code: "entry-content-outside-template", path: "/nodes/0" }]);
    }
  );

  it("refuses a field that is not text, and takes a field named as text (the control)", () => {
    expect(
      entryContentFindings(documentOf("template", entryContent("ec", 42)))
    ).toEqual([
      { code: "entry-content-field-invalid", path: "/nodes/0/props/field" },
    ]);
    // Unset is the save's to judge against the collection, not a shape fault.
    expect(
      entryContentFindings(
        documentOf("template", {
          id: "ec",
          type: ENTRY_CONTENT_TYPE,
          version: 1,
          props: {},
        })
      )
    ).toEqual([]);
  });
});

describe("finding Entry content blocks", () => {
  it("finds them at any depth, in document order, and stops at the node cap", () => {
    const nodes = [
      entryContent("a"),
      box("b", [text("t", "x"), entryContent("c")]),
    ];
    expect(entryContentPlacements(nodes).map(({ node }) => node.id)).toEqual([
      "a",
      "c",
    ]);
    // One entry read: the first block only.
    expect(entryContentPlacements(nodes, 1).map(({ node }) => node.id)).toEqual(
      ["a"]
    );
    expect(holdsEntryContent(box("b", [entryContent("c")]))).toBe(true);
    expect(holdsEntryContent(box("b", [text("t", "x")]))).toBe(false);
  });
});

describe("composing an entry's content into its template", () => {
  const body = documentOf(
    "page",
    text("p1", "First paragraph"),
    box("inner", [text("p2", "Second paragraph")])
  );

  it("draws the entry's blocks for the field the block names, with ids of their own", () => {
    const template = documentOf(
      "template",
      text("title", "Title"),
      entryContent("ec", "body")
    );
    const composed = composeEntryContent(template, {
      valueOf: field => (field === "body" ? body : undefined),
    });
    const drawn = composed.nodes[1]?.slots?.[ENTRY_CONTENT_SLOT] ?? [];
    expect(drawn.map(node => node.id)).toEqual(["ec:p1", "ec:inner"]);
    expect(drawn[1]?.slots?.children?.[0]?.id).toBe("ec:p2");
    // What the template stores is untouched: nothing of the entry is in it.
    expect(template.nodes[1]).toEqual(entryContent("ec", "body"));
  });

  it("reads the field the block names, and no other", () => {
    const template = documentOf("template", entryContent("ec", "sidebar"));
    const asked: string[] = [];
    const composed = composeEntryContent(template, {
      valueOf: field => {
        asked.push(field);
        return field === "body" ? body : undefined;
      },
    });
    expect(asked).toEqual(["sidebar"]);
    // Nothing composed: the same document, by identity.
    expect(composed).toBe(template);
  });

  it("draws nothing for an empty field, one that is absent, or one holding no document", () => {
    const template = documentOf("template", entryContent("ec"));
    for (const value of [
      documentOf("page"),
      undefined,
      null,
      "not a document",
      { formatVersion: 99, nodes: [text("p", "x")] },
    ]) {
      expect(composeEntryContent(template, { valueOf: () => value })).toBe(
        template
      );
    }
  });

  it("reads a document stored as JSON text", () => {
    const template = documentOf("template", entryContent("ec"));
    const composed = composeEntryContent(template, {
      valueOf: () => JSON.stringify(body),
    });
    expect(
      composed.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT]?.map(node => node.id)
    ).toEqual(["ec:p1", "ec:inner"]);
  });

  it("never draws an Entry content block the entry's content holds, at any depth", () => {
    const holding = documentOf(
      "template",
      text("p1", "Kept"),
      entryContent("nested-top"),
      box("inner", [entryContent("nested-deep"), text("p2", "Kept too")])
    );
    const composed = composeEntryContent(
      documentOf("template", entryContent("ec")),
      { valueOf: () => holding }
    );
    const drawn = composed.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT] ?? [];
    // The control: the entry's other blocks are drawn.
    expect(drawn.map(node => node.id)).toEqual(["ec:p1", "ec:inner"]);
    expect(entryContentPlacements(drawn)).toEqual([]);
    expect(drawn[1]?.slots?.children?.map(node => node.id)).toEqual(["ec:p2"]);
  });

  it("composes only a template, and only its first Entry content block", () => {
    const page = documentOf("page", entryContent("ec"));
    expect(composeEntryContent(page, { valueOf: () => body })).toBe(page);
    const two = documentOf("template", entryContent("a"), entryContent("b"));
    const composed = composeEntryContent(two, { valueOf: () => body });
    expect(composed.nodes[0]?.slots?.[ENTRY_CONTENT_SLOT]).toHaveLength(2);
    expect(composed.nodes[1]?.slots?.[ENTRY_CONTENT_SLOT]).toBeUndefined();
  });
});
