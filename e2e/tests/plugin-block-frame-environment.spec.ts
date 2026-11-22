/**
 * A plugin block's own code, in the editor, finds the canvas frame's document
 * and window: never the admin's.
 *
 * The playground's block fixture contributes `fixture/probe`, whose client
 * code asks `useBlockEnvironment()` for its window, measures its own element,
 * reads `innerWidth`, asks `matchMedia` and listens for `resize` there. It
 * writes what it found onto its element, and marks its listener with a
 * property so a window's listeners can be told apart.
 *
 * What each test asserts, and the broken version it rules out:
 *
 * - At every device the probe reads the frame's width (the device's), its
 *   media query answers for that width, it measures itself in the frame's
 *   document, and its node's `ownerDocument` and `defaultView` are the hook's.
 *   The admin window is wider than every device and answers the query the
 *   other way, so a hook handing out the admin's window fails on every reading.
 * - Its `resize` listener hears each device change, and it sits on the frame's
 *   window and nowhere on the admin's. A canvas whose blocks listened to the
 *   admin window would hear nothing when the device changes, since the admin
 *   window keeps its size.
 * - Its listeners never pile up: after device changes, a delete and undo, a
 *   duplicate and its undo, the frame's window holds exactly one per probe
 *   drawn. A canvas that left an unmounted block's effects running, or mounted
 *   a block twice, fails the count.
 *
 * The listeners are counted through the Chrome DevTools Protocol, which reads
 * a window's real listener list rather than anything the probe reports about
 * itself.
 *
 * Black box like the rest of `e2e/`: no product code is imported.
 */
import { expect, type APIRequestContext, type Page } from "@playwright/test";

import { gotoAdmin } from "./support/admin";
import { CANVAS_FRAME, canvasFrame } from "./support/canvas-frame";
import { test } from "./support/test";

const ENTRIES = "/admin/api/collections/pages/entries";
/** The probe block's id in the page each test makes. */
const PROBE_ID = "00000000-0000-4000-8000-0000000000e1";
/**
 * The property marking the probe's listener, as
 * `apps/playground/src/plugins/block-fixture/environment-probe.ts` sets it.
 */
const PROBE_LISTENER_MARK = "nextlyFixtureProbe";
/** The widest window the probe's media query (`max-width: 1100px`) matches. */
const PROBE_QUERY_MAX = 1100;
/** The admin window: wider than every device and than the query. */
const ADMIN_WIDTH = 1440;

/** A draft page holding one probe block, and its id. */
async function createProbePage(request: APIRequestContext): Promise<string> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(ENTRIES, {
    data: {
      title: `Probe ${stamp}`,
      slug: `probe-${stamp}`,
      status: "draft",
      content: {
        formatVersion: 1,
        kind: "page",
        nodes: [{ id: PROBE_ID, type: "fixture/probe", version: 1, props: {} }],
      },
    },
  });
  if (!created.ok()) {
    throw new Error(
      `creating a page failed: ${created.status()} ${await created.text()}`
    );
  }
  const id = ((await created.json()) as { item?: { id?: string } }).item?.id;
  if (typeof id !== "string") throw new Error("the new page has no id");
  return id;
}

/** The probes drawn on the canvas. */
function probes(page: Page) {
  return canvasFrame(page).locator(".nx-canvas [data-fixture-probe]");
}

/** The device buttons, by their group's name. */
function devices(page: Page) {
  return page.getByRole("radiogroup", { name: "Device" });
}

/** Choose a device, and return the width it lays the page out at. */
async function chooseDevice(
  page: Page,
  name: "Desktop" | "Tablet" | "Mobile"
): Promise<number> {
  await devices(page)
    .getByRole("radio", { name: new RegExp(`^${name}`) })
    .click();
  // The device buttons are icons, so the chosen one's width is in its
  // accessible name ("Desktop · 1280px · styles for …"), not its text.
  const chosen = devices(page).getByRole("radio", { checked: true });
  await expect(chosen).toHaveAccessibleName(new RegExp(`^${name} · \\d+px · `));
  const width = Number(
    (await chosen.getAttribute("aria-label"))?.match(/ · (\d+)px · /)?.[1]
  );
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error(`the ${name} device names no width`);
  }
  return width;
}

/** Undo the last change, from the top bar. */
async function undo(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Undo", exact: true }).click();
}

/** One `data-*` reading off the first probe. */
async function reading(page: Page, name: string): Promise<string | null> {
  return await probes(page).first().getAttribute(`data-${name}`);
}

/**
 * How many of the probe's `resize` listeners the canvas frame's window and the
 * admin's window each hold, read through the DevTools Protocol.
 *
 * Each window is read in its OWN default execution context. The frame's window
 * reached from the admin's context (`iframe.contentWindow`) is a proxy whose
 * listener list the protocol reports as empty, which would pass a "no
 * listeners" assertion for the wrong reason.
 */
async function probeListeners(
  page: Page
): Promise<{ frame: number; admin: number }> {
  const cdp = await page.context().newCDPSession(page);
  const group = "probe-listeners";
  // Every frame's default context, by frame id, as enabling reports them.
  const contexts = new Map<string, number>();
  cdp.on("Runtime.executionContextCreated", ({ context }) => {
    const aux = context.auxData as
      | { frameId?: string; isDefault?: boolean }
      | undefined;
    if (aux?.isDefault === true && aux.frameId !== undefined) {
      contexts.set(aux.frameId, context.id);
    }
  });
  await cdp.send("Runtime.enable");
  const count = async (contextId: number): Promise<number> => {
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: "window",
      contextId,
      objectGroup: group,
    });
    if (result.objectId === undefined) {
      throw new Error("[e2e] the window is not an object");
    }
    // Each listener comes back with its handler as a remote object.
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
      objectId: result.objectId,
    });
    let marked = 0;
    for (const listener of listeners) {
      const handler = listener.handler?.objectId;
      if (listener.type !== "resize" || handler === undefined) continue;
      const { result: isProbe } = await cdp.send("Runtime.callFunctionOn", {
        objectId: handler,
        functionDeclaration: `function () { return this[${JSON.stringify(PROBE_LISTENER_MARK)}] === true; }`,
        returnByValue: true,
      });
      if (isProbe.value === true) marked += 1;
    }
    return marked;
  };
  try {
    const { frameTree } = await cdp.send("Page.getFrameTree");
    const { result: iframe } = await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(CANVAS_FRAME)})`,
      contextId: contexts.get(frameTree.frame.id),
      objectGroup: group,
    });
    const { node } = await cdp.send("DOM.describeNode", {
      objectId: iframe.objectId,
    });
    const frameContext =
      node.frameId === undefined ? undefined : contexts.get(node.frameId);
    const adminContext = contexts.get(frameTree.frame.id);
    if (frameContext === undefined || adminContext === undefined) {
      throw new Error("[e2e] no execution context for the canvas frame");
    }
    return {
      frame: await count(frameContext),
      admin: await count(adminContext),
    };
  } finally {
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup: group });
    await cdp.detach();
  }
}

/**
 * What the probe read at a device `width` wide: the frame's width and its
 * media query, its own measurement in the frame's document, its node's
 * document and window, and its one listener, on the frame's window.
 */
async function expectFrameReadings(page: Page, width: number): Promise<void> {
  const probe = probes(page).first();
  await expect(probe).toHaveAttribute("data-inner-width", String(width));
  await expect(probe).toHaveAttribute(
    "data-narrow",
    String(width <= PROBE_QUERY_MAX)
  );
  await expect(probe).toHaveAttribute("data-same-document", "true");
  await expect(probe).toHaveAttribute("data-same-window", "true");
  await expect(probe).toHaveAttribute("data-framed", "true");
  // Measured as the frame lays it out, from inside the frame.
  const laidOut = await probe.evaluate(element =>
    Math.round(element.getBoundingClientRect().width)
  );
  await expect(probe).toHaveAttribute("data-self-width", String(laidOut));
  expect(laidOut).toBeGreaterThan(0);
  expect(laidOut).toBeLessThanOrEqual(width);
  expect(await probeListeners(page)).toEqual({ frame: 1, admin: 0 });
}

/**
 * Every probe drawn has heard the device change to `width`, so a count taken
 * next is of the listeners as they stand after the change.
 */
async function expectSettledAt(page: Page, width: number): Promise<void> {
  const drawn = await probes(page).count();
  for (let index = 0; index < drawn; index += 1) {
    await expect(probes(page).nth(index)).toHaveAttribute(
      "data-inner-width",
      String(width)
    );
  }
}

/** The probe's listeners on each window settle at `expected`. */
async function expectListeners(
  page: Page,
  expected: { frame: number; admin: number }
): Promise<void> {
  await expect.poll(() => probeListeners(page)).toEqual(expected);
}

/** Open the builder on a probe page, at the admin width. */
async function openProbe(page: Page): Promise<void> {
  const id = await createProbePage(page.request);
  await page.setViewportSize({ width: ADMIN_WIDTH, height: 900 });
  await gotoAdmin(page, `/collections/pages/${id}/builder?field=content`);
  await expect(page.getByRole("region", { name: "Canvas" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(probes(page)).toHaveCount(1, { timeout: 60_000 });
  await expect(probes(page)).toHaveAttribute("data-inner-width", /\d+/);
}

test.describe("a plugin block in the canvas frame", () => {
  test.describe.configure({ timeout: 180_000 });

  test("measures, reads the viewport and listens in the frame at every device", async ({
    page,
  }) => {
    await openProbe(page);
    expect(await page.evaluate(() => window.innerWidth)).toBe(ADMIN_WIDTH);

    // Desktop first, as the editor opens; then each change of device.
    let width = await chooseDevice(page, "Desktop");
    await expectFrameReadings(page, width);
    for (const device of ["Tablet", "Mobile", "Desktop"] as const) {
      const heard = Number(await reading(page, "resizes"));
      width = await chooseDevice(page, device);
      await expectFrameReadings(page, width);
      // Its listener heard the change.
      await expect
        .poll(async () => Number(await reading(page, "resizes")))
        .toBeGreaterThan(heard);
    }
    // The admin window kept its size throughout.
    expect(await page.evaluate(() => window.innerWidth)).toBe(ADMIN_WIDTH);
  });

  test("keeps one listener per drawn block across devices and remounts", async ({
    page,
  }) => {
    await openProbe(page);
    await expectListeners(page, { frame: 1, admin: 0 });

    for (const device of ["Tablet", "Mobile", "Desktop", "Tablet"] as const) {
      await expectSettledAt(page, await chooseDevice(page, device));
      await expectListeners(page, { frame: 1, admin: 0 });
    }

    // Deleted, the block takes its listener with it; undone, it comes back
    // with exactly one.
    await probes(page).first().click();
    await page.keyboard.press("Delete");
    await expect(probes(page)).toHaveCount(0);
    await expectListeners(page, { frame: 0, admin: 0 });
    await undo(page);
    await expect(probes(page)).toHaveCount(1);
    await expect(probes(page)).toHaveAttribute("data-inner-width", /\d+/);
    await expectListeners(page, { frame: 1, admin: 0 });

    // Duplicated, one each; the duplicate undone, one again.
    await probes(page).first().click();
    await page
      .getByRole("toolbar", { name: "Block actions" })
      .getByRole("button", { name: "Duplicate" })
      .click();
    await expect(probes(page)).toHaveCount(2);
    await expect(probes(page).nth(1)).toHaveAttribute(
      "data-inner-width",
      /\d+/
    );
    await expectListeners(page, { frame: 2, admin: 0 });
    await undo(page);
    await expect(probes(page)).toHaveCount(1);
    await expectListeners(page, { frame: 1, admin: 0 });

    // And the devices again, after the remounts.
    for (const device of ["Mobile", "Desktop"] as const) {
      await expectSettledAt(page, await chooseDevice(page, device));
      await expectListeners(page, { frame: 1, admin: 0 });
    }
  });
});
