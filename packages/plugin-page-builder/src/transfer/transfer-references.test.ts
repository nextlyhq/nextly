import {
  COMPONENT_INSTANCE_TYPE,
  type BlockDocument,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  collectDocumentReferences,
  emptyReferences,
  imageExposureIds,
  mediaIdOf,
} from "./transfer-references";

const mediaProps = (type: string): readonly string[] =>
  type === "core/image" ? ["mediaId"] : [];

function sorted(set: ReadonlySet<string>): string[] {
  return [...set].sort();
}

describe("collectDocumentReferences", () => {
  it("reads classes, tokens, breakpoints, hide settings, media and types through every slot", () => {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "pattern",
      settings: {
        styles: { base: { base: { color: { $token: "color.page" } } } },
      },
      nodes: [
        {
          id: "box",
          type: "core/box",
          version: 1,
          props: {},
          classes: ["c-card"],
          styles: {
            base: { tablet: { padding: { top: { $token: "space.lg" } } } },
            hover: { base: { color: { $token: "color.accent" } } },
          },
          slots: {
            children: [
              {
                id: "img",
                type: "core/image",
                version: 1,
                props: { mediaId: "m-1", src: "m-not-media" },
                visibility: { devices: { phone: false } },
              },
            ],
          },
        },
      ],
    };
    const into = emptyReferences();
    collectDocumentReferences(document, into, { mediaProps });

    expect(sorted(into.classes)).toEqual(["c-card"]);
    expect(sorted(into.tokens)).toEqual([
      "color.accent",
      "color.page",
      "space.lg",
    ]);
    expect(sorted(into.breakpoints)).toEqual(["base", "phone", "tablet"]);
    expect(sorted(into.media)).toEqual(["m-1"]);
    expect(sorted(into.blockTypes)).toEqual(["core/box", "core/image"]);
    expect(into.components.size).toBe(0);
  });

  it("reads a placement's component, its image values and its own slot content, never its type", () => {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: "p",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: {
            componentId: "card",
            overrides: { photo: "m-2", heading: "m-3-is-text" },
          },
          slots: {
            body: [{ id: "t", type: "core/text", version: 1, props: {} }],
          },
        },
      ],
    };
    const into = emptyReferences();
    collectDocumentReferences(document, into, {
      mediaProps,
      imageExposures: id => new Set(id === "card" ? ["photo"] : []),
    });

    expect(sorted(into.components)).toEqual(["card"]);
    expect(sorted(into.media)).toEqual(["m-2"]);
    expect(sorted(into.blockTypes)).toEqual(["core/text"]);
  });

  it("reads the media a component's variants set on its image exposures", () => {
    const definition: ComponentDocument = {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "img",
          type: "core/image",
          version: 1,
          props: { mediaId: "m-own" },
        },
      ],
      exposed: [
        {
          id: "photo",
          label: "Photo",
          nodeId: "img",
          propPath: "mediaId",
          type: "image",
        },
        {
          id: "title",
          label: "Title",
          nodeId: "img",
          propPath: "alt",
          type: "text",
        },
      ],
      variants: {
        v1: { label: "Dark", overrides: { photo: "m-dark", title: "m-not" } },
      },
    };
    const into = emptyReferences();
    collectDocumentReferences(definition, into, { mediaProps });

    expect(sorted(into.media)).toEqual(["m-dark", "m-own"]);
    expect(sorted(imageExposureIds(definition))).toEqual(["photo"]);
  });

  it("reads the media a document lists among its assets", () => {
    const into = emptyReferences();
    collectDocumentReferences(
      {
        formatVersion: 1,
        kind: "page",
        nodes: [],
        assets: { mediaIds: ["m-9"] },
      },
      into,
      { mediaProps }
    );
    expect(sorted(into.media)).toEqual(["m-9"]);
  });
});

describe("mediaIdOf", () => {
  it("takes a non-empty string or a finite number, and nothing else", () => {
    expect(mediaIdOf("m")).toBe("m");
    expect(mediaIdOf(7)).toBe("7");
    expect(mediaIdOf("")).toBeUndefined();
    expect(mediaIdOf({ id: "m" })).toBeUndefined();
    expect(mediaIdOf(Number.NaN)).toBeUndefined();
  });
});
