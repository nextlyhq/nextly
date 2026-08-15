/**
 * Block documents seeded straight through the entry API.
 *
 * Seeding rather than clicking keeps block geometry exact: the jitter question
 * is about the size ratio between the dragged item and the item it passes over,
 * so the heights have to be chosen, not inherited from whatever a default
 * heading happens to render at.
 *
 * Both fixtures use `core/spacer` for the same reason. It is the one block
 * whose height is a literal authored prop, so the only variable between the
 * control and the extreme-ratio case is height.
 */
import { expect, type APIRequestContext } from "@playwright/test";

import type { CanvasDriver, CanvasFixture } from "./driver";

/** `BlockDocument.version` is the literal 1. */
const DOCUMENT_VERSION = 1;

/** The primary slot name; container blocks put their children here. */
const DEFAULT_SLOT = "default";

interface SeedOptions {
  title: string;
  slug: string;
  content: unknown;
  blockIds: string[];
}

/**
 * Block boxes, refusing a read that did not observe the fixture.
 *
 * Comparing two geometry reads is satisfied by ABSENCE: if the query stops
 * matching rendered nodes, both sides come back empty, they compare equal, and
 * "nothing moved" cannot be told apart from "nothing was looked at". The same
 * holds for any assertion over the ids alone.
 *
 * The fixture already declares which ids must render, so requiring exactly
 * those makes an empty or partial read a failure instead of the quietest
 * possible pass. Derived from the fixture rather than listed again here,
 * because a second copy of the expected set stops agreeing with the first.
 */
export async function readSeededBlockBoxes(
  driver: CanvasDriver,
  fixture: SeedOptions
): Promise<Awaited<ReturnType<CanvasDriver["readBlockBoxes"]>>> {
  const boxes = await driver.readBlockBoxes();
  expect(
    [...boxes.map(box => box.id)].sort(),
    "the geometry reader must observe the blocks the fixture seeded"
  ).toEqual([...fixture.blockIds].sort());
  return boxes;
}

function spacer(id: string, height: string) {
  return { id, type: "core/spacer", props: { height } };
}

/** Wrap children in the container shape the builder treats as a document root. */
function document(children: ReturnType<typeof spacer>[]) {
  return {
    version: DOCUMENT_VERSION,
    kind: "page",
    root: {
      id: "nx-spike-root",
      type: "core/container",
      props: { as: "div" },
      slots: { [DEFAULT_SLOT]: children },
    },
  };
}

/** Six equal-height siblings. The control: no size ratio to speak of. */
export const FLAT_LIST_FIXTURE: SeedOptions = {
  title: "spike flat list",
  slug: "spike-flat-list",
  content: document(
    Array.from({ length: 6 }, (_, i) => spacer(`nx-flat-${i}`, "60px"))
  ),
  // Root first: `readTreeShape` walks every `data-nx-id`, and the container
  // carries one too.
  blockIds: [
    "nx-spike-root",
    ...Array.from({ length: 6 }, (_, i) => `nx-flat-${i}`),
  ],
};

/**
 * Alternating 400px and 24px siblings, a ratio of about 16:1. dnd-kit #2088
 * reports the jitter as proportional to the ratio between the dragged element
 * and the one it moves over, so this is the condition under test.
 */
/**
 * A flat list PLUS an empty container, so both drop-zone shapes are on the page at once.
 *
 * `.nx-pb-dropzone` and `.nx-pb-dropzone-empty` are different elements with different markup and
 * different states — the empty placeholder carries `data-active` alone — and the driver waits on
 * both. A fixture with only one of them lets a guard read as covering the canvas while measuring
 * half of it.
 */
export const BOTH_ZONE_SHAPES_FIXTURE: SeedOptions = {
  title: "spike both zone shapes",
  slug: "spike-both-zone-shapes",
  content: {
    version: DOCUMENT_VERSION,
    kind: "page",
    root: {
      id: "nx-both-root",
      type: "core/container",
      props: { as: "div" },
      slots: {
        [DEFAULT_SLOT]: [
          spacer("nx-both-0", "60px"),
          spacer("nx-both-1", "60px"),
          // No children, so its slot renders the empty placeholder rather than gap zones.
          {
            id: "nx-both-empty",
            type: "core/container",
            props: { as: "div" },
            slots: { [DEFAULT_SLOT]: [] },
          },
        ],
      },
    },
  },
  blockIds: ["nx-both-root", "nx-both-0", "nx-both-1", "nx-both-empty"],
};

export const EXTREME_RATIO_FIXTURE: SeedOptions = {
  title: "spike extreme ratio",
  slug: "spike-extreme-ratio",
  content: document(
    Array.from({ length: 6 }, (_, i) =>
      spacer(`nx-ratio-${i}`, i % 2 === 0 ? "400px" : "24px")
    )
  ),
  blockIds: [
    "nx-spike-root",
    ...Array.from({ length: 6 }, (_, i) => `nx-ratio-${i}`),
  ],
};

/** A container nested inside the root, for collision-priority-by-depth. */
export const NESTED_FIXTURE: SeedOptions = {
  title: "spike nested",
  slug: "spike-nested",
  content: {
    version: DOCUMENT_VERSION,
    kind: "page",
    root: {
      id: "nx-spike-root",
      type: "core/container",
      props: { as: "div" },
      slots: {
        [DEFAULT_SLOT]: [
          spacer("nx-outer-0", "80px"),
          {
            id: "nx-inner",
            type: "core/container",
            props: { as: "div" },
            slots: {
              [DEFAULT_SLOT]: [
                spacer("nx-inner-0", "120px"),
                spacer("nx-inner-1", "120px"),
              ],
            },
          },
          spacer("nx-outer-1", "80px"),
        ],
      },
    },
  },
  blockIds: [
    "nx-spike-root",
    "nx-outer-0",
    "nx-inner",
    "nx-inner-0",
    "nx-inner-1",
    "nx-outer-1",
  ],
};

/**
 * A document taller than the canvas viewport, so the canvas can actually
 * scroll.
 *
 * Autoscroll is unobservable without this. The suite runs at 1400px tall and
 * `NESTED_FIXTURE` renders roughly 400px of authored height, so the canvas has
 * no scroll range at all — `canvasScrollTop()` cannot change, and the target
 * could not pass even once autoscroll is implemented correctly.
 *
 * Its own fixture rather than borrowing `LARGE_FIXTURE`: that one is sized for
 * a PERF budget, and a later tuning of the block count for timing reasons would
 * silently take the scroll range away from this. Two questions, two fixtures.
 */
const TALL_BLOCK_HEIGHT = 200;
const TALL_COUNT = 30;
// One sequence, read by both the rendered nodes and the declared ids. Two
// generators of the same names agree the day they are written; a later change
// to the count or the naming applied to one leaves the fixture declaring a
// document it does not render, and `mountTree` then waits for ids that never
// appear.
const TALL_BLOCK_IDS = Array.from(
  { length: TALL_COUNT },
  (_unused, index) => `nx-tall-${String(index)}`
);
export const TALL_FIXTURE: SeedOptions = {
  title: "spike tall",
  slug: "spike-tall",
  content: document(
    TALL_BLOCK_IDS.map(id => spacer(id, `${String(TALL_BLOCK_HEIGHT)}px`))
  ),
  blockIds: ["nx-spike-root", ...TALL_BLOCK_IDS],
};

/** 500 siblings: the tree size the perf budget is stated against. */
const LARGE_COUNT = 500;
export const LARGE_FIXTURE: SeedOptions = {
  title: "spike large tree",
  slug: "spike-large-tree",
  content: document(
    Array.from({ length: LARGE_COUNT }, (_, i) => spacer(`nx-big-${i}`, "12px"))
  ),
  blockIds: [
    "nx-spike-root",
    ...Array.from({ length: LARGE_COUNT }, (_, i) => `nx-big-${i}`),
  ],
};

/**
 * Block ids in the entry's STORED document, in document order, root first.
 *
 * Read through the API rather than the canvas so tree integrity can still be
 * checked after the editor has unmounted: a gesture that navigates away AND
 * persists a mutation is invisible to any assertion that needs a live canvas.
 *
 * `?status=all` is required: entries are seeded as drafts, and the plain read
 * is published-only.
 */
export async function readStoredBlockIds(
  request: APIRequestContext,
  entryId: string
): Promise<string[]> {
  const response = await request.get(
    `/admin/api/collections/pages/entries/${entryId}?status=all`
  );
  if (!response.ok()) {
    throw new Error(
      `readStoredBlockIds failed: ${response.status()} ${await response.text()}`
    );
  }
  const body = (await response.json()) as {
    content?: { root?: unknown };
  };

  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null) return;
    const record = node as { id?: unknown; slots?: Record<string, unknown> };
    if (typeof record.id === "string") ids.push(record.id);
    for (const children of Object.values(record.slots ?? {})) {
      if (Array.isArray(children)) children.forEach(walk);
    }
  };
  walk(body.content?.root);
  return ids;
}

/** Create a page whose builder document is exactly `content`, and return its id. */
export async function seedPage(
  request: APIRequestContext,
  opts: SeedOptions
): Promise<CanvasFixture> {
  // Slugs are unique on this collection, so a re-run would collide with the row
  // the previous run left behind. Millisecond resolution alone is not enough:
  // two workers seeding the same fixture in the same millisecond collide, and
  // the POST then fails on the constraint, reporting a seed error rather than a
  // canvas result.
  const slug = `${opts.slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const response = await request.post("/admin/api/collections/pages/entries", {
    data: {
      title: opts.title,
      slug,
      editorMode: "builder",
      content: opts.content,
    },
  });
  if (!response.ok()) {
    throw new Error(
      `seedPage failed: ${response.status()} ${await response.text()}`
    );
  }

  // The admin's mutation envelope is `{ message, item }`, but this asserts
  // nothing about it: an unexpected shape throws with the body attached rather
  // than feeding `undefined` into a URL and failing somewhere less obvious.
  const body: unknown = await response.json();
  const entryId = readEntryId(body);
  if (!entryId) {
    throw new Error(`seedPage returned no id: ${JSON.stringify(body)}`);
  }
  return { entryId, blockIds: opts.blockIds };
}

function readEntryId(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;

  const direct = record.id;
  if (typeof direct === "string") return direct;

  for (const key of ["item", "data", "entry"]) {
    const nested = record[key];
    if (typeof nested === "object" && nested !== null) {
      const id = (nested as Record<string, unknown>).id;
      if (typeof id === "string") return id;
      if (typeof id === "number") return String(id);
    }
  }
  if (typeof direct === "number") return String(direct);
  return undefined;
}
