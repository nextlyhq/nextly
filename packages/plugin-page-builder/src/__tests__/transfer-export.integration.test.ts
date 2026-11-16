/**
 * Exporting a pattern, a component and a Layout, against a real instance,
 * through Nextly's own request handler with a signed session.
 *
 * What only a server shows: that the file holds the item's whole closure as
 * stored (the components it places and the ones those place, the shared
 * styles, variables and breakpoints its styles and hide settings use, and the
 * image's own bytes) and nothing the item does not use; that the site's
 * default Layout mark never travels; and that the export is refused, naming
 * why, when a part is out of the caller's reach.
 *
 * @module __tests__/transfer-export.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { createHash } from "node:crypto";

import { COMPONENT_INSTANCE_TYPE } from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { pageBuilder } from "../plugin";
import type { TransferFile } from "../transfer/transfer-contract";

import {
  created,
  holding,
  person,
  PNG,
  post,
  READS_EVERYTHING,
  sourceSite,
  unique,
} from "./transfer-harness";

describe.each(getConfiguredTestDialects())(
  "exporting an item with what it depends on (%s)",
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
      // The instance's first user is its super admin, so it is made here and
      // never acts: every author below holds only what it is granted.
      await person(current, "owner");
      return current;
    }

    it("carries a pattern's whole closure, the image's bytes included, and nothing it does not use", async () => {
      const t = await boot();
      const site = await sourceSite(t);
      const { cookie } = await holding(t, READS_EVERYTHING);

      const answer = await post(cookie, [
        "transfer",
        "patterns",
        site.pattern,
        "export",
      ]);

      expect(answer.status).toBe(200);
      const file = answer.body as unknown as TransferFile;
      expect(file.format).toBe("nextly-page-builder-transfer");
      expect(file.formatVersion).toBe(1);
      expect(file.root).toEqual({ kind: "pattern", id: site.pattern });
      expect(file.patterns.map(item => item.id)).toEqual([site.pattern]);
      expect(file.components.map(item => item.id)).toEqual([
        site.outer,
        site.inner,
      ]);
      expect(file.layouts).toEqual([]);
      // The card style, the variable it uses, and the breakpoints its style
      // and the image's hide setting name; the unused ones stay home, and so
      // does the site's edit of the image's own look.
      expect(file.classes.map(entry => entry.id)).toEqual(["c-card"]);
      expect(file.tokens.map(token => token.name)).toEqual(["color.brand"]);
      expect(file.breakpoints).toEqual([
        { id: "tablet", label: "Tablet", axis: "viewport", maxWidth: 991 },
        { id: "phone", label: "Phone", axis: "viewport", maxWidth: 479 },
      ]);
      expect(file.blockTypes).toEqual(["core/heading", "core/image"]);
      expect(file.media).toHaveLength(1);
      const [image] = file.media;
      expect(image?.id).toBe(site.mediaId);
      expect(image?.filename).toBe("dot.png");
      expect(image?.mimeType).toBe("image/png");
      expect(image?.altText).toBe("A dot");
      expect(Buffer.from(image?.data ?? "", "base64").equals(PNG)).toBe(true);
      expect(image?.sha256).toBe(
        createHash("sha256").update(PNG).digest("hex")
      );
      // References stay the source's own ids, resolved inside the file.
      const placed = file.patterns[0]?.content.nodes[0]?.props.componentId;
      expect(placed).toBe(site.outer);
    });

    it("carries a Layout's area components and no default mark", async () => {
      const t = await boot();
      const site = await sourceSite(t);
      const { cookie } = await holding(t, READS_EVERYTHING);

      const answer = await post(cookie, [
        "transfer",
        "layouts",
        site.layout,
        "export",
      ]);

      expect(answer.status).toBe(200);
      const file = answer.body as unknown as TransferFile;
      expect(file.layouts).toHaveLength(1);
      const [layout] = file.layouts;
      expect(Object.keys(layout ?? {}).sort()).toEqual(
        ["areas", "id", "slug", "status", "title"].sort()
      );
      expect(layout?.areas).toEqual([
        { area: "header", component: site.outer },
      ]);
      expect(file.components.map(item => item.id)).toEqual([
        site.outer,
        site.inner,
      ]);
      expect(JSON.stringify(file)).not.toMatch(/default/i);
    });

    it("exports a component never published as its draft, saying so", async () => {
      const t = await boot();
      const draft = await created(t, COMPONENTS_SLUG, {
        title: "Draft",
        slug: unique("draft"),
        status: "draft",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "h",
              type: "core/heading",
              version: 1,
              props: { text: "x", level: "h2" },
            },
          ],
        },
      });
      const { cookie } = await holding(t, READS_EVERYTHING);

      const answer = await post(cookie, [
        "transfer",
        "components",
        draft,
        "export",
      ]);

      expect(answer.status).toBe(200);
      const file = answer.body as unknown as TransferFile;
      expect(file.components.map(item => [item.id, item.status])).toEqual([
        [draft, "draft"],
      ]);
      expect(file.media).toEqual([]);
      expect(file.classes).toEqual([]);
    });

    it("refuses an item showing media the caller may not read", async () => {
      const t = await boot();
      const site = await sourceSite(t);
      const { cookie } = await holding(
        t,
        READS_EVERYTHING.filter(slug => slug !== "read-media")
      );

      const answer = await post(cookie, [
        "transfer",
        "components",
        site.inner,
        "export",
      ]);

      expect(answer.status).toBe(403);
    });

    it("refuses a component placing one that is gone, naming it", async () => {
      const t = await boot();
      const missing = "no-such-component";
      const host = await created(t, COMPONENTS_SLUG, {
        title: "Host",
        slug: unique("host"),
        status: "published",
        content: {
          formatVersion: 1,
          kind: "component",
          nodes: [
            {
              id: "p",
              type: COMPONENT_INSTANCE_TYPE,
              version: 1,
              props: { componentId: missing },
            },
          ],
        },
      });
      const { cookie } = await holding(t, READS_EVERYTHING);

      const answer = await post(cookie, [
        "transfer",
        "components",
        host,
        "export",
      ]);

      expect(answer.status).toBe(422);
      expect(JSON.stringify(answer.body)).toContain(missing);
    });

    it("answers a missing item as not found", async () => {
      const t = await boot();
      const { cookie } = await holding(t, READS_EVERYTHING);

      const answer = await post(cookie, [
        "transfer",
        "patterns",
        "nope",
        "export",
      ]);

      expect(answer.status).toBe(404);
    });
  }
);
