import { readFileSync } from "node:fs";

import {
  DOCUMENT_FORMAT_VERSION,
  DOCUMENT_KINDS,
  RESERVED_OPERATION_NAMES,
  STYLE_STATES,
  isReservedOperationName,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  blockDocumentJsonSchema,
  blockDocumentSchema,
} from "../block-document";

/** The smallest document the format allows: a page with nothing on it. */
function emptyPage() {
  return { formatVersion: DOCUMENT_FORMAT_VERSION, kind: "page", nodes: [] };
}

/** A node nested inside a slot, so recursion is exercised rather than assumed. */
function nestedPage() {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "outer",
        type: "core/section",
        version: 1,
        props: {},
        slots: {
          default: [
            {
              id: "inner",
              type: "core/text",
              version: 1,
              props: { text: "hi" },
            },
          ],
        },
      },
    ],
  };
}

describe("block document schema", () => {
  it("accepts a document nested through a slot", () => {
    // The recursion is the part a hand-written schema gets wrong, so the
    // fixture nests rather than testing a flat page and inferring the rest.
    expect(blockDocumentSchema.safeParse(nestedPage()).success).toBe(true);
  });

  it("accepts every kind the engine declares", () => {
    // Iterated from the engine's own list: a test naming the kinds would pass
    // unchanged after one was added, which is the case it exists to catch.
    for (const kind of DOCUMENT_KINDS) {
      expect(
        blockDocumentSchema.safeParse({ ...emptyPage(), kind }).success,
        `kind "${kind}" should be accepted`
      ).toBe(true);
    }
  });

  it("accepts every style state the engine declares", () => {
    for (const state of STYLE_STATES) {
      const doc = {
        ...emptyPage(),
        nodes: [
          {
            id: "a",
            type: "core/text",
            version: 1,
            props: {},
            styles: { [state]: { base: { color: "red" } } },
          },
        ],
      };
      expect(
        blockDocumentSchema.safeParse(doc).success,
        `state "${state}" should be accepted`
      ).toBe(true);
    }
  });

  it("rejects a kind outside the closed vocabulary", () => {
    expect(
      blockDocumentSchema.safeParse({ ...emptyPage(), kind: "layout" }).success
    ).toBe(false);
  });

  it("rejects a format version it was not written for", () => {
    // The field exists so a reader can tell whether it understands the file.
    // Accepting an unknown version would answer that question wrongly.
    expect(
      blockDocumentSchema.safeParse({ ...emptyPage(), formatVersion: 2 })
        .success
    ).toBe(false);
  });

  it("requires a version on every node", () => {
    const doc = {
      ...emptyPage(),
      nodes: [{ id: "a", type: "core/text", props: {} }],
    };
    expect(blockDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("requires sourceKey when a binding reads a single", () => {
    const withKey = {
      ...emptyPage(),
      nodes: [
        {
          id: "a",
          type: "core/text",
          version: 1,
          props: {},
          bindings: {
            text: { $bind: "title", source: "single", sourceKey: "hero" },
          },
        },
      ],
    };
    const withoutKey = {
      ...emptyPage(),
      nodes: [
        {
          id: "a",
          type: "core/text",
          version: 1,
          props: {},
          bindings: { text: { $bind: "title", source: "single" } },
        },
      ],
    };
    expect(blockDocumentSchema.safeParse(withKey).success).toBe(true);
    // A single addressed by nothing resolves to nothing at read time; failing
    // here names the document, which is the only place the slug can be fixed.
    expect(blockDocumentSchema.safeParse(withoutKey).success).toBe(false);
  });

  it("refuses sourceKey on a source that has no single to name", () => {
    // Refused rather than stripped. An object schema drops what it does not
    // declare, so the permissive version would parse this, return a document
    // with the key quietly gone, and hand the caller a value the engine
    // rejects — two answers to one question, with the sanitizing one hiding
    // the disagreement.
    const doc = {
      ...emptyPage(),
      nodes: [
        {
          id: "a",
          type: "core/text",
          version: 1,
          props: {},
          bindings: {
            text: { $bind: "title", source: "entry", sourceKey: "hero" },
          },
        },
      ],
    };
    const result = blockDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("leaves unknown style properties alone", () => {
    // The property catalog is additive-open, so a schema that enumerated
    // today's properties would refuse documents the moment the catalog grew.
    const doc = {
      ...emptyPage(),
      nodes: [
        {
          id: "a",
          type: "core/text",
          version: 1,
          props: {},
          styles: { base: { base: { somePropertyAddedLater: "8px" } } },
        },
      ],
    };
    expect(blockDocumentSchema.safeParse(doc).success).toBe(true);
  });
});

describe("the frozen contract", () => {
  it("matches the committed schema exactly", () => {
    // The compile-time assertions pin which FIELDS exist. They cannot see a
    // field whose type or requiredness changed while its name stayed — which
    // is the change that silently reinterprets every stored document, because
    // the type, the schema, the validator and the fixtures can all move
    // together and stay self-consistent.
    //
    // The committed schema is the outside reference that cannot move with
    // them. It is a file rather than an inline snapshot on purpose: a format
    // change then appears in the PR diff, where a reviewer decides whether it
    // needs a `formatVersion` bump and a migration.
    //
    // If this fails, the format changed. Regenerate the fixture ONLY after
    // deciding that the change is compatible, or that it comes with a version
    // bump. Updating it to make the test pass is the one response that turns
    // this from a control into a formality.
    const committed = JSON.parse(
      readFileSync(
        new URL("./__fixtures__/block-document.schema.json", import.meta.url),
        "utf8"
      )
    ) as Record<string, unknown>;

    expect(blockDocumentJsonSchema()).toEqual(committed);
  });

  it("reserves the operation names the format spec publishes", () => {
    // Read from the engine rather than listed here: a copy in the test would
    // agree on the day it was written and then certify whichever list stopped
    // being maintained.
    expect([...RESERVED_OPERATION_NAMES]).toEqual([
      "saveAsPattern",
      "saveAsComponent",
      "convertToComponent",
      "detachComponent",
    ]);
    expect(isReservedOperationName("saveAsPattern")).toBe(true);
    expect(isReservedOperationName("insert")).toBe(false);
  });

  it("documents every reserved name in the format spec", () => {
    // A reservation nobody can look up is not a reservation. The spec page is
    // the only place an outside implementer meets these names, so a name added
    // to the engine and not to the page would be reserved in private.
    const spec = readFileSync(
      new URL(
        "../../../../../../docs/api-reference/block-document-format.mdx",
        import.meta.url
      ),
      "utf8"
    );
    for (const name of RESERVED_OPERATION_NAMES) {
      expect(spec, `"${name}" should appear in the format spec`).toContain(
        name
      );
    }
  });
});

describe("published JSON schema", () => {
  it("describes the recursive node shape by reference", () => {
    // A schema that unrolled the recursion would describe a fixed depth and
    // silently refuse anything deeper, so the $ref is the assertion.
    const schema = blockDocumentJsonSchema();
    expect(JSON.stringify(schema)).toContain("$ref");
  });

  it("carries the closed vocabularies it was derived from", () => {
    const text = JSON.stringify(blockDocumentJsonSchema());
    for (const kind of DOCUMENT_KINDS) {
      expect(
        text,
        `kind "${kind}" should reach the published schema`
      ).toContain(`"${kind}"`);
    }
  });
});
