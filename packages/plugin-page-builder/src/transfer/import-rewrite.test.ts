import {
  COMPONENT_INSTANCE_TYPE,
  type BlockDocument,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import {
  rewriteClass,
  rewriteDocument,
  type ReferenceMaps,
} from "./import-rewrite";

const maps: ReferenceMaps = {
  components: new Map([["c-src", "c-dst"]]),
  classes: new Map([["k-src", "k-dst"]]),
  tokens: new Map([["color.src", "color.dst"]]),
  breakpoints: new Map([["tablet", "md"]]),
  media: new Map([["m-src", "m-dst"]]),
};

const lookups = {
  mediaProps: (type: string): readonly string[] =>
    type === "core/image" ? ["mediaId"] : [],
  imageExposures: (id: string): ReadonlySet<string> =>
    new Set(id === "c-src" ? ["photo"] : []),
};

describe("rewriteDocument", () => {
  it("maps every reference and drops what sits under a breakpoint not kept", () => {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "pattern",
      settings: { styles: { base: { gone: { color: "red" } } } },
      assets: { mediaIds: ["m-src"] },
      nodes: [
        {
          id: "box",
          type: "core/box",
          version: 1,
          props: {},
          classes: ["k-src", "k-unknown"],
          styles: {
            base: {
              base: { padding: { top: { $token: "color.src" } } },
              tablet: { color: { $token: "color.src" } },
              dropped: { color: "blue" },
            },
            hover: { dropped: { color: "blue" } },
          },
          visibility: { devices: { tablet: false, dropped: false } },
          slots: {
            children: [
              {
                id: "img",
                type: "core/image",
                version: 1,
                props: { mediaId: "m-src", alt: "m-src" },
              },
              {
                id: "place",
                type: COMPONENT_INSTANCE_TYPE,
                version: 1,
                props: {
                  componentId: "c-src",
                  variant: "v-1",
                  overrides: { photo: "m-src", title: "m-src" },
                },
              },
            ],
          },
        },
      ],
    };

    const rewritten = rewriteDocument(document, maps, lookups);

    expect(rewritten.settings).toEqual({});
    expect(rewritten.assets).toEqual({ mediaIds: ["m-dst"] });
    const box = rewritten.nodes[0];
    // A class the file does not carry is left behind, never bound by id.
    expect(box?.classes).toEqual(["k-dst"]);
    expect(box?.styles).toEqual({
      base: {
        base: { padding: { top: { $token: "color.dst" } } },
        md: { color: { $token: "color.dst" } },
      },
    });
    expect(box?.visibility).toEqual({ devices: { md: false } });
    const [image, placement] = box?.slots?.children ?? [];
    expect(image?.props).toEqual({ mediaId: "m-dst", alt: "m-src" });
    expect(placement?.props).toEqual({
      componentId: "c-dst",
      variant: "v-1",
      overrides: { photo: "m-dst", title: "m-src" },
    });
    // The source is left as it was.
    expect(document.nodes[0]?.classes).toEqual(["k-src", "k-unknown"]);
  });

  it("keeps a component's variant keys and maps the images they set", () => {
    const definition: ComponentDocument = {
      formatVersion: 1,
      kind: "component",
      nodes: [
        {
          id: "img",
          type: "core/image",
          version: 1,
          props: { mediaId: "m-src" },
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
      ],
      variants: { "v-dark": { label: "Dark", overrides: { photo: "m-src" } } },
    };

    const rewritten = rewriteDocument(definition, maps, lookups);

    expect(rewritten.variants).toEqual({
      "v-dark": { label: "Dark", overrides: { photo: "m-dst" } },
    });
    expect(rewritten.exposed).toEqual(definition.exposed);
  });

  it("leaves out each property naming a withheld variable, after mapping, and keeps the rest", () => {
    const document: BlockDocument = {
      formatVersion: 1,
      kind: "pattern",
      settings: {
        styles: { base: { base: { color: { $token: "color.src" } } } },
      },
      nodes: [
        {
          id: "box",
          type: "core/box",
          version: 1,
          props: {},
          styles: {
            base: {
              base: {
                // Named inside a structured value: the whole value goes.
                padding: { top: { $token: "color.src" }, left: "4px" },
                margin: { top: { $token: "space.kept" } },
                color: "red",
              },
              // Every property withheld: the breakpoint goes with them.
              tablet: { color: { $token: "color.src" } },
            },
          },
        },
      ],
    };

    const judged = rewriteDocument(
      document,
      { ...maps, withheldTokens: new Set(["color.dst"]) },
      lookups
    );

    expect(judged.nodes[0]?.styles).toEqual({
      base: {
        base: { margin: { top: { $token: "space.kept" } }, color: "red" },
      },
    });
    expect(judged.settings).toEqual({});
    // CONTROL: unset, the same document keeps every reference, mapped.
    expect(rewriteDocument(document, maps, lookups).nodes[0]?.styles).toEqual({
      base: {
        base: {
          padding: { top: { $token: "color.dst" }, left: "4px" },
          margin: { top: { $token: "space.kept" } },
          color: "red",
        },
        md: { color: { $token: "color.dst" } },
      },
    });
  });
});

describe("rewriteClass", () => {
  it("keeps a look bound to its block type", () => {
    // Rewritten as a plain style, an imported look would change its place in
    // the cascade and show where looks are kept out.
    expect(
      rewriteClass(
        {
          id: "look:core/button:outline",
          slug: "button-outline",
          orderIndex: 0,
          blockType: "core/button",
          styles: {},
        },
        "look:core/button:outline-2",
        "button-outline-2",
        4,
        maps
      ).blockType
    ).toBe("core/button");
  });

  it("names the class as the site will hold it, its styles mapped", () => {
    expect(
      rewriteClass(
        {
          id: "k-src",
          slug: "card",
          orderIndex: 3,
          styles: {
            base: {
              tablet: { color: { $token: "color.src" } },
              gone: { color: "red" },
            },
          },
        },
        "k-dst",
        "card-2",
        9,
        maps
      )
    ).toEqual({
      id: "k-dst",
      slug: "card-2",
      orderIndex: 9,
      styles: { base: { md: { color: { $token: "color.dst" } } } },
    });
  });
});
