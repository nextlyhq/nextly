/**
 * Registering starter pages, and refusing one at start-up: from the site's
 * option and a plugin's declaration, the page builder's own set hidden on
 * request, and each refusal naming the starter, where it came from and why.
 *
 * @module starter-pages/starter-pages.test
 */
import {
  createBlockRegistry,
  DEFAULT_LIMITS,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import type { StarterPageDefinition } from "@nextlyhq/plugin-sdk/blocks";
import { describe, expect, it } from "vitest";

import { siteBreakpoints } from "../site-style";

import { fixtureStarter } from "./starter-pages.fixture";
import {
  registerStarterPagesAtBoot,
  type StarterPageOptions,
} from "./starter-pages";

const blocks = createBlockRegistry();
blocks.register(coreBlocks, { source: "@nextlyhq/plugin-page-builder" });
const judgement = { blocks, breakpoints: siteBreakpoints() };

/** A plugin declaring `value` to the page builder. */
function declaring(name: string, value: unknown) {
  return {
    name,
    contributes: {
      declarations: { "@nextlyhq/plugin-page-builder": value },
    },
  };
}

/** A boot of a site with `options` and `plugins`, its built-in set `builtIn`. */
function boot(
  options: StarterPageOptions,
  plugins: unknown[] = [],
  builtIn: readonly StarterPageDefinition[] = []
) {
  return registerStarterPagesAtBoot(
    { config: { plugins } as never },
    options,
    builtIn,
    judgement
  );
}

/** The fixture with its blocks replaced. */
function withBlocks(blocks: BlockNode[], id = "broken"): StarterPageDefinition {
  return { ...fixtureStarter(id), blocks };
}

const heading = (props: Record<string, unknown> = {}): BlockNode => ({
  id: "h",
  type: "core/heading",
  version: 1,
  props: { text: "Hi", level: "h2", ...props },
});

describe("registering starter pages", () => {
  it("lists the built-in set, the site's, then each plugin's", () => {
    const registered = boot(
      { starterPages: [fixtureStarter("site-one")] },
      [
        declaring("acme-plugin", {
          starterPages: [fixtureStarter("from-acme")],
        }),
      ],
      [fixtureStarter("ours")]
    );
    expect(
      registered.map(entry => [entry.starter.id, entry.source, entry.builtIn])
    ).toEqual([
      ["ours", "the page builder's own starter pages", true],
      ["site-one", "pageBuilder({ starterPages })", false],
      ["from-acme", "acme-plugin", false],
    ]);
  });

  it("hides the built-in set when the site asks", () => {
    const registered = boot(
      {
        starterPages: [fixtureStarter("site-one")],
        builtInStarterPages: false,
      },
      [],
      [fixtureStarter("ours")]
    );
    expect(registered.map(entry => entry.starter.id)).toEqual(["site-one"]);
  });

  it("ignores a declaration it can't read, and one with no starters", () => {
    expect(
      boot({}, [declaring("other", "not an object"), declaring("blocks", {})])
    ).toEqual([]);
  });
});

describe("refusing a starter page at start-up", () => {
  it("refuses one naming a block the site doesn't have, naming the starter, its source and the block", () => {
    expect(() =>
      boot({
        starterPages: [
          withBlocks([{ id: "x", type: "acme/hero", version: 1, props: {} }]),
        ],
      })
    ).toThrow(
      '[page-builder] The starter page "broken" from pageBuilder({ starterPages }) uses the block "acme/hero", which this site doesn\'t have.'
    );
  });

  it("refuses an unknown block however deep it sits, from a plugin", () => {
    const nested = fixtureStarter("deep");
    const section = nested.blocks[0] as BlockNode;
    const starter = withBlocks(
      [
        {
          ...section,
          slots: {
            children: [{ id: "x", type: "acme/card", version: 1, props: {} }],
          },
        },
      ],
      "deep"
    );
    expect(() =>
      boot({}, [declaring("acme-plugin", { starterPages: [starter] })])
    ).toThrow(
      'The starter page "deep" from acme-plugin uses the block "acme/card"'
    );
  });

  it("leaves out a built-in starter needing a block the site doesn't have, rather than refusing the start", () => {
    const registered = boot(
      {},
      [],
      [
        withBlocks([{ id: "x", type: "acme/hero", version: 1, props: {} }]),
        fixtureStarter("ours"),
      ]
    );
    expect(registered.map(entry => entry.starter.id)).toEqual(["ours"]);
  });

  it.each([
    ["no id", { id: "" }, "needs an id of 1 to 64 lower case letters"],
    ["an id with capitals", { id: "Landing" }, "needs an id of 1 to 64"],
    ["no name", { label: " " }, "needs a name"],
    ["a long name", { label: "x".repeat(81) }, "has a name longer than 80"],
    ["no description", { description: "" }, "needs a short description"],
    ["a long description", { description: "x".repeat(201) }, "longer than 200"],
    ["no blocks", { blocks: [] }, "needs at least one block"],
  ])("refuses one with %s", (_case, over, words) => {
    expect(() =>
      boot({ starterPages: [{ ...fixtureStarter(), ...over }] })
    ).toThrow(words);
  });

  it("refuses a starter page that is not an object", () => {
    expect(() =>
      boot({ starterPages: ["landing" as unknown as StarterPageDefinition] })
    ).toThrow(
      "The starter page from pageBuilder({ starterPages }) must be an object made with defineStarterPage."
    );
  });

  it("refuses a second starter taking an id, naming the first one's source", () => {
    expect(() =>
      boot({ starterPages: [fixtureStarter("landing")] }, [
        declaring("acme-plugin", { starterPages: [fixtureStarter("landing")] }),
      ])
    ).toThrow(
      'The starter page "landing" from acme-plugin takes an id pageBuilder({ starterPages }) already uses'
    );
  });

  it("refuses a plugin's starterPages that is not a list", () => {
    expect(() =>
      boot({}, [declaring("acme-plugin", { starterPages: "landing" })])
    ).toThrow(
      '"acme-plugin" declared starterPages for the page builder as string'
    );
  });

  it("refuses a placed component", () => {
    expect(() =>
      boot({
        starterPages: [
          withBlocks([
            {
              id: "c",
              type: "nextly/component-instance",
              version: 1,
              props: { componentId: "hero" },
            },
          ]),
        ],
      })
    ).toThrow("places a component");
  });

  it.each([
    [
      "a picture from the media library",
      { id: "i", type: "core/image", version: 1, props: { mediaId: "42" } },
      '"core/image" ("mediaId")',
    ],
    [
      "an image address on another site",
      {
        id: "i",
        type: "core/image",
        version: 1,
        props: { src: "https://images.example.com/a.jpg" },
      },
      '"core/image" ("src")',
    ],
    [
      "a video to embed",
      {
        id: "e",
        type: "core/embed",
        version: 1,
        props: { src: "https://www.youtube.com/watch?v=x" },
      },
      '"core/embed" ("src")',
    ],
    [
      "a picture written as CSS in its styles",
      {
        ...heading(),
        styles: {
          base: { base: { backgroundImage: "url(https://x.example/a.png)" } },
        },
      },
      '"core/heading"\'s styles',
    ],
    [
      "a background image on this site, as the Style tab stores it",
      {
        ...heading(),
        styles: { base: { base: { background: { url: "/a.png" } } } },
      },
      '"core/heading"\'s styles',
    ],
    [
      "a background image on another site, as the Style tab stores it",
      {
        ...heading(),
        styles: {
          base: { mobile: { background: { url: "https://x.example/a.png" } } },
        },
      },
      '"core/heading"\'s styles',
    ],
    [
      "a picture an empty binding falls back to",
      {
        id: "i",
        type: "core/image",
        version: 1,
        props: {},
        bindings: {
          src: {
            $bind: "cover",
            source: "entry",
            fallback: "https://cdn.example/image.jpg",
          },
        },
      },
      '"core/image" ("src")',
    ],
    [
      "a media library picture an empty binding falls back to",
      {
        id: "i",
        type: "core/image",
        version: 1,
        props: {},
        bindings: {
          mediaId: { $bind: "cover", source: "entry", fallback: "42" },
        },
      },
      '"core/image" ("mediaId")',
    ],
  ])("refuses %s", (_case, node, where) => {
    expect(() =>
      boot({ starterPages: [withBlocks([node as BlockNode])] })
    ).toThrow(`has a picture or an address to load in ${where}`);
  });

  it("takes a background with no picture: a colour, or `none`", () => {
    const plain = withBlocks(
      [
        {
          ...heading(),
          styles: {
            base: {
              base: { backgroundColor: "#fff", background: { url: "none" } },
            },
          },
        },
      ],
      "plain"
    );
    expect(boot({ starterPages: [plain] }).map(e => e.starter.id)).toEqual([
      "plain",
    ]);
  });

  it("refuses a starter larger than the site's document limits allow", () => {
    expect(() =>
      registerStarterPagesAtBoot(
        { config: { plugins: [] } as never },
        { starterPages: [fixtureStarter()] },
        [],
        { ...judgement, limits: { ...DEFAULT_LIMITS, maxNodes: 3 } }
      )
    ).toThrow(
      'The starter page "test-welcome" from pageBuilder({ starterPages }) fails validation'
    );
  });

  it("takes a button's link, which is followed and never loaded", () => {
    expect(
      boot({ starterPages: [fixtureStarter()] }).map(entry => entry.starter.id)
    ).toEqual(["test-welcome"]);
  });

  it("refuses blocks the engine's validation refuses, saying where", () => {
    expect(() =>
      boot({
        starterPages: [withBlocks([heading(), heading()])],
      })
    ).toThrow(
      /The starter page "broken" from pageBuilder\(\{ starterPages \}\) fails validation at \/nodes\/1/
    );
  });
});
