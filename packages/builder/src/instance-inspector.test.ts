/**
 * What a selected component instance exposes for editing, and the patch that
 * changes it.
 *
 * Driven through the engine's own resolver rather than a stub of its answer:
 * which value is in force for a row, and which layer supplied it, is exactly
 * what a stub would restate, and a stub that agreed today would keep agreeing
 * after the resolver changed what an override means.
 *
 * @module instance-inspector.test
 */
import { describe, expect, it } from "vitest";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
  type ComponentDocument,
  type ComponentLookup,
} from "@nextlyhq/blocks-engine";

import type { SavedComponent } from "./inserter";
import {
  EDITABLE_EXPOSED_TYPES,
  inspectInstance,
  overridesPatch,
  resetOverrideOp,
  setOverrideOp,
} from "./instance-inspector";

/** A definition exposing a title (text), a tone (select) and a picture (image). */
function header(extra: Partial<ComponentDocument> = {}): ComponentDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [
      {
        id: "h1",
        type: "acme/heading",
        version: 1,
        props: { text: "Site name", tone: "light", image: "hero.png" },
      },
    ],
    exposed: [
      {
        id: "title",
        label: "Title",
        nodeId: "h1",
        propPath: "text",
        type: "text",
      },
      {
        id: "tone",
        label: "Tone",
        nodeId: "h1",
        propPath: "tone",
        type: "select",
        options: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
      },
      {
        id: "picture",
        label: "Picture",
        nodeId: "h1",
        propPath: "image",
        type: "image",
      },
    ],
    ...extra,
  } as ComponentDocument;
}

/** An instance node pointing at the header, with whatever it stores. */
function instance(props: Record<string, unknown> = {}): BlockNode {
  return {
    id: "i1",
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId: "header", ...props },
  };
}

function pageOf(...nodes: BlockNode[]): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes,
  } as BlockDocument;
}

const LIBRARY: readonly SavedComponent[] = [
  { id: "header", title: "Header", usedOn: 12, document: header() },
];

function lookupOf(
  ...definitions: [string, ComponentDocument][]
): ComponentLookup {
  return new Map(definitions);
}

const HEADER = lookupOf(["header", header()]);

describe("what is inspected", () => {
  it("answers nothing for no selection, a missing id, or an ordinary block", () => {
    // The block inspector answers for a block; this must not answer beside it.
    const page = pageOf(
      { id: "b", type: "acme/heading", version: 1, props: {} },
      instance()
    );

    expect(inspectInstance(page, null, HEADER, LIBRARY)).toBeNull();
    expect(inspectInstance(page, "gone", HEADER, LIBRARY)).toBeNull();
    expect(inspectInstance(page, "b", HEADER, LIBRARY)).toBeNull();
    // The positive control, without which the three above are satisfied by a
    // function that always answers nothing.
    expect(inspectInstance(page, "i1", HEADER, LIBRARY)).not.toBeNull();
  });

  it("titles the instance from the LIBRARY row, and carries its usage and identity", () => {
    // The document carries no title; the library's row is the only holder of
    // one, and of how many pages place the component.
    const page = pageOf(instance({}));
    const inspection = inspectInstance(
      pageOf({ ...instance(), name: "Top header", locked: true }),
      "i1",
      HEADER,
      LIBRARY
    );

    expect(inspection).toMatchObject({
      nodeId: "i1",
      componentId: "header",
      label: "Header",
      usedOn: 12,
      identity: { name: "Top header", locked: true },
      definitionFound: true,
    });
    // And by the id when the library has no row: a title is better than
    // nothing, and the id is the only name left.
    expect(inspectInstance(page, "i1", HEADER, [])?.label).toBe("header");
    expect(inspectInstance(page, "i1", HEADER, [])).not.toHaveProperty(
      "usedOn"
    );
  });

  it("says when the lookup holds no definition, with no rows to draw", () => {
    const page = pageOf(instance());

    const inspection = inspectInstance(page, "i1", lookupOf(), LIBRARY);

    expect(inspection?.definitionFound).toBe(false);
    expect(inspection?.rows).toEqual([]);
    expect(inspection?.orphaned).toEqual([]);
  });

  it("reads a componentId that is not a string as naming no component", () => {
    // A stored document can hold anything; a non-string must not reach the
    // lookup as a key.
    const page = pageOf(instance({ componentId: 7 }));

    const inspection = inspectInstance(page, "i1", HEADER, LIBRARY);

    expect(inspection?.componentId).toBe("");
    expect(inspection?.definitionFound).toBe(false);
  });
});

describe("the rows", () => {
  it("lists the exposed properties in declared order, each with the value IN FORCE and its source", () => {
    const page = pageOf(instance({ overrides: { title: "Acme" } }));

    const rows = inspectInstance(page, "i1", HEADER, LIBRARY)?.rows ?? [];

    expect(rows.map(row => row.id)).toEqual(["title", "tone", "picture"]);
    expect(rows[0]).toMatchObject({
      label: "Title",
      type: "text",
      value: "Acme",
      source: "instance",
      cleared: false,
    });
    expect(rows[1]).toMatchObject({
      value: "light",
      source: "definition",
      options: [
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ],
    });
  });

  it("marks which rows this inspector can draw a control for, and carries the rest", () => {
    // The set is named rather than inferred: a type with no control is a KNOWN
    // gap the row states, never a row that goes missing.
    const rows =
      inspectInstance(pageOf(instance()), "i1", HEADER, LIBRARY)?.rows ?? [];

    expect(rows.map(row => [row.type, row.supported])).toEqual([
      ["text", true],
      ["select", true],
      ["image", false],
    ]);
    expect([...EDITABLE_EXPOSED_TYPES]).toEqual(["text", "select"]);
  });

  it("reports a cleared row as cleared, with no value", () => {
    const page = pageOf(instance({ overrides: { title: { $unset: true } } }));

    const [title] = inspectInstance(page, "i1", HEADER, LIBRARY)?.rows ?? [];

    expect(title).toMatchObject({ source: "instance", cleared: true });
    expect(title?.value).toBeUndefined();
  });

  it("names the exposure that shadows a row by its LABEL, not its id", () => {
    // Two exposures pointing at one target: the resolver says which is in
    // force, and the panel has to say it in words an author has seen.
    const twice = header({
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "h1",
          propPath: "text",
          type: "text",
        },
        {
          id: "headline",
          label: "Headline",
          nodeId: "h1",
          propPath: "text",
          type: "text",
        },
      ],
    });
    const page = pageOf(instance({ overrides: { headline: "Later wins" } }));

    const rows =
      inspectInstance(page, "i1", lookupOf(["header", twice]), LIBRARY)?.rows ??
      [];

    expect(rows[0]?.shadowedBy).toEqual({ id: "headline", label: "Headline" });
    expect(rows[1]).not.toHaveProperty("shadowedBy");
  });

  it("says which rows hold an override of THEIR OWN, apart from the source in force at the target", () => {
    // The resolver reports the winning exposure's source on the shadowed row
    // too, so `source` alone would offer a reset on a row with nothing to
    // reset — and resetting it would remove nothing. Whether THIS row's id
    // is in the instance's own record is a separate fact.
    const twice = header({
      exposed: [
        {
          id: "title",
          label: "Title",
          nodeId: "h1",
          propPath: "text",
          type: "text",
        },
        {
          id: "headline",
          label: "Headline",
          nodeId: "h1",
          propPath: "text",
          type: "text",
        },
      ],
    });
    const page = pageOf(instance({ overrides: { headline: "Later wins" } }));

    const rows =
      inspectInstance(page, "i1", lookupOf(["header", twice]), LIBRARY)?.rows ??
      [];

    expect(rows.map(row => [row.id, row.source, row.ownOverride])).toEqual([
      ["title", "instance", false],
      ["headline", "instance", true],
    ]);
  });

  it("counts a cleared property as the row's own override", () => {
    const page = pageOf(instance({ overrides: { title: { $unset: true } } }));

    const [title] = inspectInstance(page, "i1", HEADER, LIBRARY)?.rows ?? [];

    expect(title?.ownOverride).toBe(true);
  });

  it("reports no override of its own for an inherited row", () => {
    const [title] =
      inspectInstance(pageOf(instance()), "i1", HEADER, LIBRARY)?.rows ?? [];

    expect(title).toMatchObject({ source: "definition", ownOverride: false });
  });

  it("refuses a definition the canvas refuses, so no row is drawn for a component the page shows as a placeholder", () => {
    // The same readability rule the resolver applies, not only the kind: a
    // definition in a format this build does not read is left standing on the
    // canvas, and an inspector that read it anyway would offer edits to a
    // placeholder. And a list of nodes that is not one would throw inside the
    // exposure rather than answer "not found".
    // Spelled as what arrives from storage, not as this build's type.
    const stale = {
      ...HEADER.get("header")!,
      formatVersion: DOCUMENT_FORMAT_VERSION + 1,
    } as unknown as ComponentDocument;
    const broken = {
      ...HEADER.get("header")!,
      nodes: "oops",
    } as unknown as ComponentDocument;
    const page = pageOf(instance({ overrides: { title: "Acme" } }));

    const old = inspectInstance(
      page,
      "i1",
      lookupOf(["header", stale]),
      LIBRARY
    );
    const malformed = inspectInstance(
      page,
      "i1",
      lookupOf(["header", broken]),
      LIBRARY
    );

    expect(old).toMatchObject({ definitionFound: false, rows: [] });
    expect(malformed).toMatchObject({ definitionFound: false, rows: [] });
  });

  it("surfaces overrides this instance holds for properties no longer exposed", () => {
    const page = pageOf(
      instance({ overrides: { title: "Acme", subtitle: "Gone now" } })
    );

    const inspection = inspectInstance(page, "i1", HEADER, LIBRARY);

    expect(inspection?.orphaned).toEqual([
      { id: "subtitle", value: "Gone now" },
    ]);
  });

  it("does not offer a VARIANT's orphaned value as the instance's to discard", () => {
    // The resolver reports every orphaned id it applied, the variant's
    // included; only what THIS node stores is this author's.
    const withVariant = header({
      variants: {
        bold: { label: "Bold", overrides: { subtitle: "From variant" } },
      },
    });
    const page = pageOf(instance({ variant: "bold" }));

    const inspection = inspectInstance(
      page,
      "i1",
      lookupOf(["header", withVariant]),
      LIBRARY
    );

    expect(inspection?.orphaned).toEqual([]);
  });
});

describe("the patch that changes an override", () => {
  it("carries the WHOLE props object, so the component id survives the edit", () => {
    // `updateNode` merges at the top level: a patch carrying only the
    // overrides would replace the props and the node would name no component.
    const patch = overridesPatch(instance({ variant: "bold" }), {
      title: "Acme",
    });

    expect(patch.props).toEqual({
      componentId: "header",
      variant: "bold",
      overrides: { title: "Acme" },
    });
  });

  it("omits the record when nothing remains, rather than storing an empty one", () => {
    const patch = overridesPatch(
      instance({ overrides: { title: "Acme" } }),
      {}
    );

    expect(patch.props).toEqual({ componentId: "header" });
    expect(patch.props).not.toHaveProperty("overrides");
  });

  it("sets one override and keeps every other", () => {
    const op = setOverrideOp(
      instance({ overrides: { tone: "dark" } }),
      "title",
      "Acme"
    );

    expect(op).toEqual({
      kind: "update",
      id: "i1",
      patch: {
        props: {
          componentId: "header",
          overrides: { tone: "dark", title: "Acme" },
        },
      },
    });
  });

  it("resets one override by REMOVING it, and drops the record with the last", () => {
    // Removal rather than writing the definition's value back: an override
    // equal to the definition's value is still an override.
    const two = resetOverrideOp(
      instance({ overrides: { tone: "dark", title: "Acme" } }),
      "title"
    );
    const last = resetOverrideOp(
      instance({ overrides: { title: "Acme" } }),
      "title"
    );

    // Strict, because a reset that wrote `undefined` under the id instead of
    // removing it would compare equal under the loose matcher and still be a
    // key the record carries.
    expect(two).toStrictEqual({
      kind: "update",
      id: "i1",
      patch: { props: { componentId: "header", overrides: { tone: "dark" } } },
    });
    expect(last).toStrictEqual({
      kind: "update",
      id: "i1",
      patch: { props: { componentId: "header" } },
    });
  });

  it("reads a stored record that is not a record as empty", () => {
    const op = setOverrideOp(
      instance({ overrides: ["not", "a", "record"] }),
      "title",
      "Acme"
    );

    expect(op).toEqual({
      kind: "update",
      id: "i1",
      patch: { props: { componentId: "header", overrides: { title: "Acme" } } },
    });
  });
});
