import { bench, describe } from "vitest";

import { migrateDocument } from "./migration";
import type { MigrationSource } from "./migration";
import {
  SCALE_BREAKPOINTS,
  fiveThousandNodePage,
  scaleDocument,
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

/**
 * One shared definition, as a real registry returns. Building a fresh object and
 * closure per node would put thousands of allocations inside the measured region
 * that migration itself never performs.
 */
const SCALE_BLOCK_INFO = {
  version: 2,
  migrate: { 1: (props: Record<string, unknown>) => props },
};

const source: MigrationSource = {
  get: type => (type.startsWith("core/") ? SCALE_BLOCK_INFO : undefined),
};
const staleThousand = staleVersionPage(1000, 1);
const staleFourThousand = staleVersionPage(4000, 1);

describe("validate", () => {
  bench("1000 nodes, styled", () => {
    validate(thousand, ctx);
  });

  bench("1000 nodes, no styles", () => {
    validate(plain, ctx);
  });

  bench("4000 nodes, styled", () => {
    validate(fourThousand, ctx);
  });

  bench("5000 nodes, at the node ceiling", () => {
    validate(fiveThousand, ctx);
  });
});

describe("migrate", () => {
  bench("1000 nodes, every node one version behind", () => {
    migrateDocument(staleThousand, source);
  });

  bench("4000 nodes, every node one version behind", () => {
    migrateDocument(staleFourThousand, source);
  });
});
