import { test } from "vitest";

import { byteCapRefusal } from "./byte-cap";
import { keptJsonBytes } from "./kept-sizes";
import { countNodes, DEFAULT_LIMITS, treeDepth } from "./limits";
import { migrateDocument } from "./migration";
import { applyOp } from "./ops";
import {
  SCALE_BREAKPOINTS,
  fiveThousandNodePage,
  scaleDocument,
  staleMigrationSource,
  staleVersionPage,
  thousandNodePage,
} from "./scale.fixtures";
import { validate } from "./validation";

/**
 * Absolute numbers for humans, run with `pnpm bench`.
 *
 * These are a report, not a gate. What CI enforces is in `performance.test.ts`,
 * and it asserts scaling rather than milliseconds, because a wall-clock limit on
 * a shared runner fails for reasons that have nothing to do with the code. The
 * budgets this program quotes — validate and migrate inside 25 ms on the
 * thousand-node page — are read off these results on a developer machine.
 *
 * Documents are built once outside the measured function so the numbers reflect
 * the operation and not the fixture generator.
 */

const ctx = { breakpoints: SCALE_BREAKPOINTS, mode: "strict" as const };

const thousand = thousandNodePage();
const fourThousand = scaleDocument({ nodes: 4000 });
const fiveThousand = fiveThousandNodePage();
const plain = scaleDocument({ nodes: 1000, styled: false });

const source = staleMigrationSource();
const staleThousand = staleVersionPage(1000, 1);
const staleFourThousand = staleVersionPage(4000, 1);

// Each group is one comparison table: `bench.compare` runs its entries
// against each other and prints them side by side.
test("validate", async ({ bench }) => {
  await bench.compare(
    bench("1000 nodes, styled", () => {
      validate(thousand, ctx);
    }),
    bench("1000 nodes, no styles", () => {
      validate(plain, ctx);
    }),
    bench("4000 nodes, styled", () => {
      validate(fourThousand, ctx);
    }),
    bench("5000 nodes, at the node ceiling", () => {
      validate(fiveThousand, ctx);
    })
  );
});

test("migrate", async ({ bench }) => {
  await bench.compare(
    bench("1000 nodes, every node one version behind", () => {
      migrateDocument(staleThousand, source);
    }),
    bench("4000 nodes, every node one version behind", () => {
      migrateDocument(staleFourThousand, source);
    })
  );
});

// One whole editor edit (`applyOp`), on a 4-block and a 150-block page. Each
// document's own size is kept first, as an editor holding it already has. This
// is the cap check plus the op layer's per-edit validity pass, which still
// reads every node; "the cap check alone" below is the part kept sizes make
// independent of the page's size.
const fourBlocks = scaleDocument({ nodes: 4 });
const longPage = scaleDocument({ nodes: 150 });
keptJsonBytes(fourBlocks);
keptJsonBytes(longPage);
let edit = 0;
const updateFirst = (document: typeof longPage) =>
  applyOp(document, {
    kind: "update",
    id: "n0",
    patch: { props: { text: `edit ${String((edit += 1))}` } },
  });

test("one whole edit", async ({ bench }) => {
  await bench.compare(
    bench("4 blocks", () => {
      updateFirst(fourBlocks);
    }),
    bench("150 blocks", () => {
      updateFirst(longPage);
    })
  );
});

// The cap check alone: a fresh edit each run (the first block's text, the rest
// shared), then the node count, the depth and the byte cap it must fit, as
// `assertFitsCaps` asks them. The edited path is measured; the rest is kept.
const freshEdit = (document: typeof longPage) => {
  const [first, ...rest] = document.nodes;
  if (first === undefined) return document;
  return {
    ...document,
    nodes: [
      { ...first, props: { text: `edit ${String((edit += 1))}` } },
      ...rest,
    ],
  };
};
countNodes(fourBlocks.nodes);
countNodes(longPage.nodes);

const capCheck = (document: typeof longPage) => () => {
  const result = freshEdit(document);
  countNodes(result.nodes);
  treeDepth(result.nodes);
  byteCapRefusal(document, result, DEFAULT_LIMITS.maxBytes, "update");
};

test("the cap check alone", async ({ bench }) => {
  await bench.compare(
    bench("4 blocks", capCheck(fourBlocks)),
    bench("150 blocks", capCheck(longPage))
  );
});
