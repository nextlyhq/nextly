/**
 * The binding checks validation runs when it is given the sources' schema:
 * the same rules the renderer checks every binding against before use.
 */
import { describe, expect, it } from "vitest";

import { BINDING_ISSUE_CODES } from "./binding-issues";
import type { BindingFieldShape, BindingSchemaSource } from "./binding-rules";
import { DOCUMENT_FORMAT_VERSION, type BlockDocument } from "./document";
import { FIXTURE_BREAKPOINTS } from "./validation.fixtures";
import { ISSUE_CODES, validate, type ValidationContext } from "./validation";

const FIELDS: Readonly<Record<string, readonly BindingFieldShape[]>> = {
  posts: [
    { name: "title", type: "text" },
    { name: "author", type: "relationship", relationTo: "authors" },
    {
      name: "tags",
      type: "relationship",
      relationTo: "tags",
      hasMany: true,
    },
  ],
  authors: [
    { name: "name", type: "text" },
    { name: "company", type: "relationship", relationTo: "companies" },
  ],
  companies: [{ name: "name", type: "text" }],
  tags: [{ name: "name", type: "text" }],
};

const schema: BindingSchemaSource = {
  fieldsOf: ref => ("collection" in ref ? FIELDS[ref.collection] : undefined),
};

/** A heading bound to one path of the entry. */
function headingBoundTo(id: string, path: string) {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text: "Own" },
    bindings: { text: { $bind: path } },
  };
}

const document: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    headingBoundTo("one-hop", "author.name"),
    headingBoundTo("two-hops", "author.company.name"),
    headingBoundTo("to-many", "tags.name"),
  ],
};

const context: ValidationContext = {
  breakpoints: FIXTURE_BREAKPOINTS,
  mode: "strict",
  bindingSchema: schema,
  bindingEntry: { collection: "posts" },
  definitions: {
    get: type =>
      type === "core/heading"
        ? { version: 1, props: { text: { type: "text" } } }
        : undefined,
  },
};

/** The binding codes reported for each node, by its position. */
function bindingCodes(ctx: ValidationContext): string[][] {
  const issues = validate(document, ctx);
  return document.nodes.map((_node, index) =>
    issues
      .filter(issue => issue.path.startsWith(`/nodes/${String(index)}/`))
      .map(issue => issue.code)
  );
}

describe("validating bindings against the sources' schema", () => {
  it("accepts a one-hop path, refuses a two-hop path and a path through a to-many relation", () => {
    expect(bindingCodes(context)).toEqual([
      [],
      ["binding-path-too-deep"],
      ["binding-path-to-many"],
    ]);
  });

  it("judges a field every entry carries, which a schema need not list, by its value", () => {
    const stamped: BlockDocument = {
      ...document,
      nodes: [
        headingBoundTo("stamp", "createdAt"),
        headingBoundTo("missing", "subtitle"),
      ],
    };
    const codes = validate(stamped, context).map(issue => [
      issue.path.split("/")[2],
      issue.code,
    ]);
    expect(codes).toEqual([["1", "binding-field-missing"]]);
  });

  it("judges a block whose definition declares no props as having none", () => {
    const propless: ValidationContext = {
      ...context,
      definitions: {
        get: type => (type === "core/heading" ? { version: 1 } : undefined),
      },
    };
    expect(bindingCodes(propless)[0]).toEqual(["binding-prop-missing"]);
  });

  it("checks shape only without a schema, as it always has", () => {
    const { bindingSchema: _schema, ...shapeOnly } = context;
    expect(bindingCodes(shapeOnly)).toEqual([[], [], []]);
  });

  it("refuses an image bound to plain text, and an image fallback no image is drawn from", () => {
    const imageFields: BindingSchemaSource = {
      fieldsOf: ref =>
        "collection" in ref && ref.collection === "posts"
          ? [
              { name: "title", type: "text" },
              { name: "cover", type: "upload", relationTo: "media" },
              { name: "photoUrl", type: "url" },
            ]
          : undefined,
    };
    const imageBoundTo = (id: string, path: string, fallback?: unknown) => ({
      id,
      type: "core/image",
      version: 1,
      props: {},
      bindings: {
        mediaId: {
          $bind: path,
          ...(fallback === undefined ? {} : { fallback }),
        },
      },
    });
    const images: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        imageBoundTo("text", "title"),
        imageBoundTo("script", "cover", "javascript:alert(1)"),
        imageBoundTo("data", "photoUrl", "data:image/png;base64,AAAA"),
        imageBoundTo("other-host", "cover", "//elsewhere.example/a.png"),
        // CONTROLS: a media id and an image address are image fallbacks.
        imageBoundTo("media-id", "cover", "media-1"),
        imageBoundTo("address", "photoUrl", "https://cdn.example/a.png"),
        imageBoundTo("site-path", "cover", "/media/a.png"),
      ],
    } as unknown as BlockDocument;
    const imageContext: ValidationContext = {
      ...context,
      bindingSchema: imageFields,
      definitions: {
        get: type =>
          type === "core/image"
            ? { version: 1, props: { mediaId: { type: "media" } } }
            : undefined,
      },
    };
    const issues = validate(images, imageContext);
    const codesAt = (index: number) =>
      issues
        .filter(issue => issue.path.startsWith(`/nodes/${String(index)}/`))
        .map(issue => issue.code);
    expect(images.nodes.map((_node, index) => codesAt(index))).toEqual([
      ["binding-type-misfit"],
      ["binding-fallback-invalid"],
      ["binding-fallback-invalid"],
      ["binding-fallback-invalid"],
      [],
      [],
      [],
    ]);
  });

  it("reports every binding code under the validator's own table", () => {
    for (const [code, description] of Object.entries(BINDING_ISSUE_CODES)) {
      expect(ISSUE_CODES).toHaveProperty(code, description);
    }
  });
});
