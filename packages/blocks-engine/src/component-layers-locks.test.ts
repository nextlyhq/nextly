/**
 * Which composed blocks a component's Layers lock covers.
 */
import { describe, expect, it } from "vitest";

import { componentLayersLocks } from "./component-layers-locks";
import type { BlockNode } from "./document";

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
