import { describe, expect, it } from "vitest";

import { migrateDocument } from "./migrate";
import { createBlockRegistry } from "./registry";
import type { BlockDefinition, BlockDocument } from "./types";

/**
 * Migration golden files (spec §12/§16): exact old-JSON → new-JSON for a versioned block,
 * plus byte-for-byte preservation of unknown blocks. Goldens are what make "keep
 * extending it" safe — a future block-version bump must not silently change these outputs.
 */
const cardV2: BlockDefinition = {
  type: "test/card",
  version: 2,
  label: "Card",
  icon: "Square",
  category: "basic",
  defaultProps: {},
  // v1 stored `heading`; v2 renames it to `title`.
  migrate: (old, from) => {
    const o = (old ?? {}) as Record<string, unknown>;
    return from < 2 ? { props: { title: o.heading ?? "" } } : { props: o };
  },
  render: () => null,
};

function registry() {
  const r = createBlockRegistry();
  r.register(cardV2);
  return r;
}

describe("migration goldens", () => {
  it("upgrades test/card v1 → v2 (heading → title) exactly", () => {
    const input: BlockDocument = {
      version: 1,
      root: {
        id: "r",
        type: "test/card",
        definitionVersion: 1,
        props: { heading: "Hi" },
      },
    };
    expect(migrateDocument(input, registry())).toEqual({
      version: 1,
      root: {
        id: "r",
        type: "test/card",
        definitionVersion: 2,
        props: { title: "Hi" },
      },
    });
  });

  it("stamps definitionVersion on a current-version block with no migrate needed", () => {
    const input: BlockDocument = {
      version: 1,
      root: {
        id: "r",
        type: "test/card",
        definitionVersion: 2,
        props: { title: "kept" },
      },
    };
    expect(migrateDocument(input, registry()).root.props).toEqual({
      title: "kept",
    });
  });

  it("preserves an unknown block byte-for-byte (retain and flag)", () => {
    const input: BlockDocument = {
      version: 1,
      root: {
        id: "r",
        type: "acme/unknown",
        props: { keep: true, n: 3 },
        slots: {
          default: [{ id: "c", type: "acme/also-unknown", props: {} }],
        },
      },
    };
    expect(migrateDocument(input, registry())).toEqual(input);
  });

  it("migrates a nested known block inside a container", () => {
    const input: BlockDocument = {
      version: 1,
      root: {
        id: "root",
        type: "acme/wrap",
        props: {},
        slots: {
          default: [
            {
              id: "card",
              type: "test/card",
              definitionVersion: 1,
              props: { heading: "Deep" },
            },
          ],
        },
      },
    };
    const out = migrateDocument(input, registry());
    expect(out.root.slots?.default?.[0]).toEqual({
      id: "card",
      type: "test/card",
      definitionVersion: 2,
      props: { title: "Deep" },
    });
  });
});
