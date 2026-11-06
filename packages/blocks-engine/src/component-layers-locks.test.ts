/**
 * Which composed blocks a component's Layers lock covers.
 */
import { describe, expect, it } from "vitest";

import {
  componentLayersLocks,
  heldBaselines,
  keptForSameComponents,
  placedLockChanges,
} from "./component-layers-locks";
import {
  COMPONENT_INSTANCE_TYPE,
  type BlockDocument,
  type BlockNode,
} from "./document";

const node = (
  id: string,
  extra: Record<string, unknown> = {},
  children?: BlockNode[]
): BlockNode =>
  ({
    id,
    type: "core/box",
    version: 1,
    props: {},
    ...(children === undefined ? {} : { slots: { children } }),
    ...extra,
  }) as BlockNode;

describe("componentLayersLocks", () => {
  it("covers a block the component locks and everything inside it, the page's own content too", () => {
    const covered = componentLayersLocks([
      node("hero", { instanceOf: "p1", locked: true }, [
        node("title", { instanceOf: "p1" }),
        node("given"),
      ]),
      node("free", { instanceOf: "p1" }),
    ]);

    expect([...covered.keys()]).toEqual(["hero", "title", "given"]);
    expect(covered.get("given")).toEqual({
      holderId: "hero",
      placementId: "p1",
    });
  });

  it("leaves a lock the page sets on its own block to the page's own check", () => {
    expect(
      componentLayersLocks([node("own", { locked: true }, [node("inside")])])
        .size
    ).toBe(0);
  });
});

const LIMITS = { maxNodes: 1000 };

const placement = (
  id: string,
  props: Record<string, unknown>,
  slots?: Record<string, BlockNode[]>
): BlockNode =>
  ({
    id,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props,
    ...(slots === undefined ? {} : { slots }),
  }) as BlockNode;

const page = (nodes: BlockNode[]): BlockDocument =>
  ({ formatVersion: 1, kind: "page", nodes }) as BlockDocument;

describe("heldBaselines", () => {
  it("holds a placement inside another's slot at a level of its own, the outer one as the page gives it", () => {
    const outer = (inner: BlockNode) =>
      placement(
        "o1",
        { componentId: "frame", overrides: { a: 1 }, variant: "wide" },
        { body: [inner] }
      );
    const levels = heldBaselines(
      page([
        outer(
          placement(
            "i1",
            { componentId: "promo", overrides: { title: "Mine" } },
            { extra: [node("given")] }
          )
        ),
      ]),
      LIMITS
    );

    expect(levels.map(level => [...level.placements])).toEqual([
      ["o1"],
      ["i1"],
    ]);
    // Outermost: the frame as it holds itself, its slot content gone.
    expect(levels[0]!.document.nodes).toEqual([
      placement("o1", { componentId: "frame" }),
    ]);
    // Next: the frame as the page gives it, the promo inside as it holds itself.
    expect(levels[1]!.document.nodes).toEqual([
      outer(placement("i1", { componentId: "promo" })),
    ]);
  });

  it("holds none for a page placing no component", () => {
    expect(heldBaselines(page([node("own")]), LIMITS)).toEqual([]);
  });
});

describe("keptForSameComponents", () => {
  it("leaves out a placement the page now draws from another component", () => {
    const kept = page([
      placement("i1", { componentId: "promo", overrides: { title: "Mine" } }),
      node("own"),
    ]);

    expect(
      keptForSameComponents(
        page([placement("i1", { componentId: "copy" })]),
        kept,
        LIMITS
      ).nodes
    ).toEqual([node("own")]);
    // The same component keeps the form itself, uncopied.
    expect(
      keptForSameComponents(
        page([placement("i1", { componentId: "promo" })]),
        kept,
        LIMITS
      )
    ).toBe(kept);
  });
});

describe("placedLockChanges", () => {
  it("judges each level's own locks only, naming the placement a change came through", () => {
    const hero = (text: string) =>
      node("fh", { instanceOf: "o1", locked: true, props: { text } });
    const promoHero = (text: string) =>
      node("ph", { instanceOf: "i1", locked: true, props: { text } });
    const composed = page([
      node("well", { instanceOf: "o1" }, [promoHero("Mine")]),
      hero("Frame's"),
    ]);

    const changes = placedLockChanges(
      composed,
      [
        {
          form: page([node("well", { instanceOf: "o1" }), hero("Frame's")]),
          placements: new Set(["o1"]),
        },
        // The frame's lock differs here, but is the outer level's to judge.
        {
          form: page([
            node("well", { instanceOf: "o1" }, [promoHero("Held")]),
            hero("Other"),
          ]),
          placements: new Set(["i1"]),
        },
      ],
      [],
      LIMITS
    );

    expect(changes).toEqual([
      expect.objectContaining({ kind: "changed", id: "ph", placementId: "i1" }),
    ]);
  });
});
