/**
 * Depth priority: when an ancestor and a descendant both claim the pointer,
 * the DESCENDANT owns the drop target.
 *
 * `checklist.spec.ts`'s nested-container test names this property and cannot
 * separate it. Its fixture nests a container in block flow, where every
 * ancestor zone lies OUTSIDE the nested container's box — so the container
 * under the pointer is also the owner of the zone under the pointer, and the
 * test passes on a canvas with no depth rule at all, which is the canvas this
 * repository has.
 *
 * The geometry that separates them comes from the grid path. `CanvasNode`
 * merges the `before` droppable's ref onto the CHILD'S OWN ELEMENT:
 *
 *   const ref = mergeRefs(dragRef, before.ref, grid ? append.ref : undefined);
 *
 * and that droppable carries `parentId` of the GRID. So a grid whose child is
 * itself a container puts an ancestor-owned target over the descendant's
 * entire box, competing with the descendant's own zones at every interior
 * point. `@dnd-kit/collision` ranks by `priority` first and nothing in
 * `plugin-page-builder` sets it, so ranking falls through to geometric score —
 * where a full-box target beats the zero-height gap zones inside it.
 */
import { expect, test } from "@playwright/test";

import { seedPage, type SeedOptions } from "./fixtures";
import { createPocDriver } from "./poc-driver";
import { ACTIVE_ZONE } from "./poc-driver";

test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 2560, height: 1400 } });

/** `.nx-pb-drop-before` / `.nx-pb-drop-append` — a target on a node's own box. */
const BLOCK_LEVEL_TARGET = ".nx-pb-drop-before, .nx-pb-drop-append";

const GRID = "nx-dp-grid";
const INNER = "nx-dp-inner";

const spacer = (id: string, height: string) => ({
  id,
  type: "core/spacer",
  props: { height },
  slots: {},
});

/**
 * A container inside a GRID, so the grid's insert-before target covers it.
 *
 * The inner spacers are tall so the pointer can sit far from every boundary:
 * an assertion taken near an edge would be reporting the gap zone that
 * legitimately belongs to the outer container, not a priority decision.
 */
const GRID_NESTED_FIXTURE: SeedOptions = {
  title: "depth priority grid-nested",
  slug: "depth-priority-grid-nested",
  content: {
    version: 1,
    kind: "page",
    root: {
      id: "nx-dp-root",
      type: "core/container",
      props: { as: "div" },
      slots: {
        default: [
          {
            id: GRID,
            type: "core/grid",
            props: {},
            slots: {
              default: [
                {
                  id: INNER,
                  type: "core/container",
                  props: { as: "div" },
                  slots: {
                    default: [
                      spacer("nx-dp-inner-0", "300px"),
                      spacer("nx-dp-inner-1", "300px"),
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  },
  blockIds: ["nx-dp-root", GRID, INNER, "nx-dp-inner-0", "nx-dp-inner-1"],
};

/**
 * Which node's slot the active target would insert into.
 *
 * One formula covers both target kinds, because both attach to an element
 * whose PARENT is the owner: a gap zone renders inside its owner, and a
 * `before` target sits on the child's element while belonging to that child's
 * parent. Written here rather than taken from `poc-driver`, whose
 * `readActiveZoneOwner` throws on a block-level target by design — it models
 * gap zones only, so it cannot observe the competition under test.
 */
async function activeTargetOwner(page: import("@playwright/test").Page) {
  return page
    .frameLocator("iframe")
    .locator("body")
    .evaluate(
      (body, [active, blockLevel]) => {
        const targets = [
          ...body.querySelectorAll(active),
          ...body.querySelectorAll(blockLevel),
        ];
        if (targets.length === 0) return null;
        if (targets.length > 1) {
          const ids = targets.map(t => {
            const owner = t.parentElement?.closest("[data-nx-id]");
            return `${t.className}->${owner?.getAttribute("data-nx-id")}`;
          });
          throw new Error(
            `${targets.length} drop targets active at once: ${ids.join(", ")}`
          );
        }
        const owner = targets[0]!.parentElement?.closest("[data-nx-id]");
        return owner?.getAttribute("data-nx-id") ?? null;
      },
      [ACTIVE_ZONE, BLOCK_LEVEL_TARGET] as const
    );
}

test("[acceptance] a descendant outranks an ancestor whose target covers it", async ({
  page,
  request,
}) => {
  const fixture = await seedPage(request, GRID_NESTED_FIXTURE);
  const driver = createPocDriver(page);
  await driver.mountTree(fixture);

  // The fixture only separates the two if the ancestor's target really does
  // cover the descendant. Asserted rather than assumed: if `CanvasNode` stops
  // merging `before.ref` onto the child's element, this test would go green by
  // losing its own premise, which is the failure mode it exists to avoid.
  const innerBox = await page
    .frameLocator("iframe")
    .locator(`[data-nx-id="${INNER}"]`)
    .boundingBox();
  expect(innerBox, "the nested container must be laid out").not.toBeNull();
  expect(
    innerBox!.height,
    "the nested container must be tall enough to hold a pointer far from every edge"
  ).toBeGreaterThan(400);

  const source = await driver.dragSourceCentre();
  await driver.startDragAt(source);

  // Dead centre of the nested container. Every ancestor zone in the block-flow
  // fixture lies outside this point; the grid's insert-before target does not.
  const centre = {
    x: innerBox!.x + innerBox!.width / 2,
    y: innerBox!.y + innerBox!.height / 2,
  };
  await driver.moveBy(centre.x - source.x, centre.y - source.y);

  // Polled, not read once. The collision observer resolves asynchronously after
  // a pointer move, so a single read immediately afterwards samples whatever
  // was active mid-flight — measured as a genuine flake here, passing on one
  // run of this suite and failing on the next with the pointer in the same
  // place. Polling asserts the SETTLED owner, which is the property claimed.
  //
  // Waiting cannot manufacture a pass: without depth priority the ancestor's
  // target is stably active for as long as the pointer stays here, so the poll
  // exhausts its budget and reports the ancestor.
  await expect
    .poll(() => activeTargetOwner(page), {
      timeout: 5_000,
      message: `the pointer is inside ${INNER}, so the target must belong to it and not to the enclosing ${GRID}`,
    })
    .toBe(INNER);
});
