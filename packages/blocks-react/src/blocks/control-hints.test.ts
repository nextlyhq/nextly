/**
 * The control hints core blocks give the editor are ones it can act on.
 *
 * A hint the editor cannot draw is dropped in silence: a `display: "switch"`
 * whose `switchOn` is not one of exactly two options stays a menu, and a
 * `display: "sort"` whose `collectionProp` names no collection prop offers no
 * fields. Nothing would fail; the control would simply not be the one the
 * block asked for. So every hint in the library is checked here.
 *
 * @module blocks/control-hints.test
 */
import type { PropSchema } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { coreBlocks } from "./index";

/** Every prop of every core block, with the block it belongs to. */
const PROPS = coreBlocks.flatMap(block =>
  Object.entries((block.props ?? {}) as Record<string, PropSchema>).map(
    ([name, schema]) => ({ block, name, schema })
  )
);

const hinted = (display: string) =>
  PROPS.filter(({ schema }) => schema.display === display);

describe("core blocks' control hints", () => {
  it("are present where the image and the collection loop ask for them", () => {
    // The population, before any verdict: an empty list satisfies every
    // assertion below by having nothing to contradict.
    expect(
      hinted("switch").map(({ block, name }) => `${block.name}.${name}`)
    ).toContain("core/image.loading");
    expect(
      hinted("sort").map(({ block, name }) => `${block.name}.${name}`)
    ).toContain("core/collection-loop.sort");
    expect(
      hinted("collection").map(({ block, name }) => `${block.name}.${name}`)
    ).toContain("core/collection-loop.collection");
  });

  it.each(
    hinted("switch").map(each => [`${each.block.name}.${each.name}`, each])
  )(
    "%s switches between exactly two options, one of them named as what on does",
    (_, { schema }) => {
      expect(schema.type).toBe("select");
      expect(schema.options).toHaveLength(2);
      expect(schema.options).toContain(schema.switchOn);
      const labels = schema.optionLabels ?? {};
      expect(typeof labels[String(schema.switchOn)]).toBe("string");
    }
  );

  it.each(
    hinted("sort").map(each => [`${each.block.name}.${each.name}`, each])
  )(
    "%s names a prop of its block that holds a collection",
    (_, { block, schema }) => {
      expect(schema.type).toBe("text");
      const props = (block.props ?? {}) as Record<string, PropSchema>;
      const named = props[String(schema.collectionProp)];
      expect(named?.display).toBe("collection");
    }
  );

  it.each(
    hinted("collection").map(each => [`${each.block.name}.${each.name}`, each])
  )("%s is stored as text", (_, { schema }) => {
    expect(schema.type).toBe("text");
  });
});
