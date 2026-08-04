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
import type { APIRequestContext } from "@playwright/test";

import type { CanvasFixture } from "./driver";

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

/** Create a page whose builder document is exactly `content`, and return its id. */
export async function seedPage(
  request: APIRequestContext,
  opts: SeedOptions
): Promise<CanvasFixture> {
  // Slugs are unique on this collection, so a re-run would collide with the row
  // the previous run left behind.
  const slug = `${opts.slug}-${Date.now()}`;

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
