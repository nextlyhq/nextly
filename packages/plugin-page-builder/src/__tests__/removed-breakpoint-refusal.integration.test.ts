/**
 * A page saved by an editor opened before one of the site's breakpoints was
 * removed: what it brings under that breakpoint is refused, with a message to
 * reload, and what the page already held there still saves. Through the real
 * blocks field, against the breakpoints as the site stores them, on every
 * configured dialect.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";
import {
  SITE_SETTINGS_WRITE_CONTEXT,
  SITE_STYLE_SLUG,
} from "../site-style-storage";

type Node = Record<string, unknown>;

const heading = (id: string, extra: Node = {}): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
  ...extra,
});

const pageOf = (nodes: Node[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** A colour stored at `breakpoint`. */
const colourAt = (breakpoint: string): Node => ({
  styles: { base: { [breakpoint]: { color: "#1155cc" } } },
});

const TABLET = { id: "tablet", label: "Tablet", maxWidth: 900 };
const MOBILE = { id: "mobile", label: "Mobile", maxWidth: 600 };

const REFUSED = {
  publicData: {
    errors: [
      expect.objectContaining({
        code: "removed-breakpoint",
        message: expect.stringContaining(
          "That breakpoint was removed from the site. Reload to keep editing."
        ),
      }),
    ],
  },
};

describe.each(getConfiguredTestDialects())(
  "a save under a breakpoint the site removed (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        seedPublic: true,
      });
      await storeBreakpoints(current, [TABLET, MOBILE]);
      return current;
    }

    /** The site's breakpoints, written through the Settings door. */
    async function storeBreakpoints(
      t: TestNextly,
      viewport: (typeof TABLET)[]
    ): Promise<void> {
      await t.nextly.updateSingle({
        slug: SITE_STYLE_SLUG,
        data: { breakpoints: { viewport, container: [] }, _overwrite: true },
        overrideAccess: true,
        context: { ...SITE_SETTINGS_WRITE_CONTEXT },
      });
    }

    async function createPage(t: TestNextly, nodes: Node[]): Promise<string> {
      const created = await t.nextly.create({
        collection: "pages",
        data: { title: "Home", slug: "home", content: pageOf(nodes) },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    function save(t: TestNextly, id: string, nodes: Node[]) {
      return t.nextly.update({
        collection: "pages",
        id,
        data: { content: pageOf(nodes), _overwrite: true },
        overrideAccess: true,
      });
    }

    it("refuses a style or a hide brought under it, and saves the breakpoints that remain", async () => {
      const t = await boot();
      const id = await createPage(t, [heading("a")]);
      await storeBreakpoints(t, [TABLET]);

      await expect(
        save(t, id, [heading("a", colourAt("mobile"))])
      ).rejects.toMatchObject(REFUSED);
      await expect(
        save(t, id, [
          heading("a", { visibility: { devices: { mobile: false } } }),
        ])
      ).rejects.toMatchObject(REFUSED);

      // Nothing of either was stored.
      const stored = await t.nextly.findByID({
        collection: "pages",
        id,
        depth: 0,
        overrideAccess: true,
      });
      expect(JSON.stringify(stored.content)).not.toContain("mobile");

      const saved = await save(t, id, [heading("a", colourAt("tablet"))]);
      expect(JSON.stringify(saved.item.content)).toContain("tablet");
    });

    it("keeps saving a page that already held the removed breakpoint", async () => {
      // Styled at Mobile before it was removed: the page's own to keep, and
      // still savable, a copy of the style onto another block included.
      const t = await boot();
      const id = await createPage(t, [heading("a", colourAt("mobile"))]);
      await storeBreakpoints(t, [TABLET]);

      const saved = await save(t, id, [
        heading("a", colourAt("mobile")),
        heading("b", colourAt("mobile")),
      ]);
      expect(saved.item).toMatchObject({ id: expect.anything() });
    });

    it("lets the page save at it again once the site defines it again", async () => {
      // Read per write: the set the save is judged against is the stored one
      // at that moment, not one read when the site booted.
      const t = await boot();
      const id = await createPage(t, [heading("a")]);
      await storeBreakpoints(t, [TABLET]);
      await expect(
        save(t, id, [heading("a", colourAt("mobile"))])
      ).rejects.toMatchObject(REFUSED);

      await storeBreakpoints(t, [TABLET, MOBILE]);
      const saved = await save(t, id, [heading("a", colourAt("mobile"))]);
      expect(JSON.stringify(saved.item.content)).toContain("mobile");
    });
  }
);
