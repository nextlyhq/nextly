/**
 * A plugin's written template on every dialect: stored written, followed,
 * reset, taken over, overridden, and an owner's update to it reviewed as a
 * whole (the site's version or the plugin's).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { PluginEmailTemplate } from "../../../plugins/contributions";
import type { EmailTemplateService } from "../services/email-template-service";
import { WHOLE_TEMPLATE } from "../template-merge";
import { compileWrittenHtml } from "../written/compile";
import type { WrittenDocument } from "../written/document";

import {
  openTemplateStore,
  TEMPLATE_STORE_DIALECTS,
  type TemplateStore,
} from "./template-ownership-fixture";

const ORDERS = "@acme/plugin-orders";

const heading = (text: string): WrittenDocument["blocks"][number] => ({
  type: "heading",
  text: [{ type: "text", text }],
});
const paragraph = (text: string): WrittenDocument["blocks"][number] => ({
  type: "text",
  text: [
    { type: "text", text },
    { type: "chip", variable: "amount", fallback: "your payment" },
    { type: "text", text: "." },
  ],
});

// The plugin's version 1 of its written template, and version 2.
const V1: WrittenDocument = {
  version: 1,
  blocks: [heading("Payment received"), paragraph("We received ")],
};
const V2: WrittenDocument = {
  version: 1,
  blocks: [heading("Thank you"), paragraph("We received ")],
};
// What the site wrote over it.
const MINE: WrittenDocument = {
  version: 1,
  blocks: [heading("Paid, with thanks"), paragraph("Your payment of ")],
};

/**
 * The same blocks with the paragraph's text in two runs: other blocks that
 * compile to exactly the same HTML and plain text.
 */
const splitRuns = (document: WrittenDocument): WrittenDocument => ({
  version: 1,
  blocks: document.blocks.map(block => {
    if (block.type !== "text") return block;
    const [first, ...rest] = block.text;
    if (first?.type !== "text") return block;
    const cut = first.text.indexOf(" ");
    return {
      ...block,
      text: [
        { type: "text", text: first.text.slice(0, cut) },
        { type: "text", text: first.text.slice(cut) },
        ...rest,
      ],
    };
  }),
});

const paid = (blocks: WrittenDocument): PluginEmailTemplate => ({
  slug: "orders-paid",
  name: "Order paid",
  subject: "Thanks for your payment",
  blocks,
});

for (const entry of TEMPLATE_STORE_DIALECTS) {
  const suite = entry.url ? describe : describe.skip;

  suite(`a plugin's written template — ${entry.dialect}`, () => {
    let store: TemplateStore;

    /** A boot with the orders plugin at `blocks`, or without it when null. */
    async function boot(
      blocks: WrittenDocument | null
    ): Promise<EmailTemplateService> {
      const service = store.newService();
      service.configureOwnership({
        plugins:
          blocks === null ? [] : [{ name: ORDERS, templates: [paid(blocks)] }],
      });
      await service.ensureBuiltInTemplates();
      return service;
    }

    async function paidTemplate(service: EmailTemplateService) {
      const template = await service.getTemplateBySlug("orders-paid");
      if (!template) throw new Error("orders-paid is missing");
      return template;
    }

    /** The site's written override of the plugin's version 1. */
    async function overridden(): Promise<string> {
      const first = await boot(V1);
      const { id } = await paidTemplate(first);
      await first.updateTemplate(id, { blocks: MINE });
      return id;
    }

    beforeAll(async () => {
      store = await openTemplateStore(entry);
    }, 60_000);

    afterAll(async () => {
      await store?.close();
    });

    beforeEach(async () => {
      await store.clear();
    });

    it("is stored written, and sends what its blocks say", async () => {
      const service = await boot(V1);
      const template = await paidTemplate(service);
      expect(template).toMatchObject({
        format: "written",
        blocks: V1,
        owner: { kind: "plugin", name: ORDERS },
        overridden: false,
        htmlContent: compileWrittenHtml(V1),
      });
      const sent = await service.renderStored(template, { amount: "$5" });
      expect(sent.html).toContain("Payment received</h1>");
      expect(sent.html).toContain("We received $5.");
    });

    it("follows the plugin's next version while the site leaves it alone", async () => {
      await boot(V1);
      const service = await boot(V2);
      expect(await paidTemplate(service)).toMatchObject({
        format: "written",
        blocks: V2,
        overridden: false,
        ownerChanged: false,
      });
    });

    it("keeps the site's blocks as an override, and offers the plugin's update as a whole", async () => {
      const id = await overridden();
      const unchanged = await boot(V1);
      expect(await unchanged.getTemplate(id)).toMatchObject({
        overridden: true,
        ownerChanged: false,
        blocks: MINE,
      });
      expect((await unchanged.compareTemplate(id)).changes).toEqual([]);

      const service = await boot(V2);
      expect(await service.getTemplate(id)).toMatchObject({
        overridden: true,
        ownerChanged: true,
        blocks: MINE,
      });
      const comparison = await service.compareTemplate(id);
      expect(comparison.changes).toEqual([
        expect.objectContaining({ id: WHOLE_TEMPLATE, conflict: false }),
      ]);
    });

    it("takes the plugin's blocks when the site chooses them, and its own again on undo", async () => {
      const id = await overridden();
      const service = await boot(V2);
      const comparison = await service.compareTemplate(id);

      const { template, undo } = await service.applyOwnerUpdate(
        id,
        { [WHOLE_TEMPLATE]: { use: "theirs" } },
        comparison.review
      );
      expect(template).toMatchObject({
        format: "written",
        blocks: V2,
        overridden: true,
        ownerChanged: false,
      });
      expect((await service.compareTemplate(id)).changes).toEqual([]);

      await service.undoOwnerUpdate(id, undo);
      expect(await service.getTemplate(id)).toMatchObject({
        format: "written",
        blocks: MINE,
        ownerChanged: true,
      });
    });

    it("keeps the site's blocks when it chooses them, and stops offering the update", async () => {
      const id = await overridden();
      const service = await boot(V2);
      const comparison = await service.compareTemplate(id);

      const { template } = await service.applyOwnerUpdate(
        id,
        { [WHOLE_TEMPLATE]: { use: "mine" } },
        comparison.review
      );
      expect(template).toMatchObject({
        blocks: MINE,
        overridden: true,
        ownerChanged: false,
      });
    });

    it("refuses written text for a whole-template change", async () => {
      const id = await overridden();
      const service = await boot(V2);
      const comparison = await service.compareTemplate(id);
      await expect(
        service.applyOwnerUpdate(
          id,
          { [WHOLE_TEMPLATE]: { use: "edited", text: "<p>x</p>" } },
          comparison.review
        )
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await service.getTemplate(id)).toMatchObject({ blocks: MINE });
    });

    it("refuses a choice made before the site rewrote its blocks, even to the same HTML", async () => {
      const id = await overridden();
      const service = await boot(V2);
      const comparison = await service.compareTemplate(id);
      await service.updateTemplate(id, { blocks: splitRuns(MINE) });
      // The control: the rewrite changed the blocks, not the HTML.
      expect((await service.getTemplate(id)).htmlContent).toBe(
        compileWrittenHtml(MINE)
      );

      await expect(
        service.applyOwnerUpdate(
          id,
          { [WHOLE_TEMPLATE]: { use: "theirs" } },
          comparison.review
        )
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await service.getTemplate(id)).toMatchObject({
        blocks: splitRuns(MINE),
      });
    });

    it("refuses to undo once the site rewrote its blocks, even to the same HTML", async () => {
      const id = await overridden();
      const service = await boot(V2);
      const { undo } = await service.applyOwnerUpdate(
        id,
        { [WHOLE_TEMPLATE]: { use: "theirs" } },
        (await service.compareTemplate(id)).review
      );
      await service.updateTemplate(id, { blocks: splitRuns(V2) });

      await expect(service.undoOwnerUpdate(id, undo)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(await service.getTemplate(id)).toMatchObject({
        blocks: splitRuns(V2),
      });
    });

    it("keeps its own blocks, written, when HTML from an earlier Nextly is stored", async () => {
      const id = await overridden();
      // As a row written by a release whose blocks compiled to other markup.
      await store.exec(
        `UPDATE ${store.q("email_templates")} SET ${store.q("html_content")} = '<p>Older markup</p>' WHERE ${store.q("slug")} = 'orders-paid'`
      );
      const service = await boot(V2);

      const { template } = await service.applyOwnerUpdate(
        id,
        { [WHOLE_TEMPLATE]: { use: "mine" } },
        (await service.compareTemplate(id)).review
      );
      expect(template).toMatchObject({
        format: "written",
        blocks: MINE,
        htmlContent: compileWrittenHtml(MINE),
      });
    });

    it("is written again on undo when HTML from an earlier Nextly was stored", async () => {
      const id = await overridden();
      // As a row written by a release whose blocks compiled to other markup.
      await store.exec(
        `UPDATE ${store.q("email_templates")} SET ${store.q("html_content")} = '<p>Older markup</p>' WHERE ${store.q("slug")} = 'orders-paid'`
      );
      const service = await boot(V2);
      const { undo } = await service.applyOwnerUpdate(
        id,
        { [WHOLE_TEMPLATE]: { use: "theirs" } },
        (await service.compareTemplate(id)).review
      );

      await service.undoOwnerUpdate(id, undo);

      expect(await service.getTemplate(id)).toMatchObject({
        format: "written",
        blocks: MINE,
        htmlContent: compileWrittenHtml(MINE),
      });
    });

    it("is the site's once it rewrites the blocks, even to the same HTML, and the next boot keeps them", async () => {
      const first = await boot(V1);
      const { id } = await paidTemplate(first);
      await first.updateTemplate(id, { blocks: splitRuns(V1) });
      expect(await first.getTemplate(id)).toMatchObject({
        overridden: true,
        // The control: the rewrite changed the blocks, not the HTML.
        htmlContent: compileWrittenHtml(V1),
      });

      const next = await boot(V1);
      expect(await next.getTemplate(id)).toMatchObject({
        blocks: splitRuns(V1),
        overridden: true,
      });
    });

    it("refuses to keep its blocks over a save made since the review was checked", async () => {
      // Every write in the same second, as on MySQL and SQLite.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
      try {
        const id = await overridden();
        const service = await boot(V2);
        const comparison = await service.compareTemplate(id);
        const rows = service as unknown as {
          getRow(id: string): Promise<unknown>;
        };
        const stale = await rows.getRow(id);
        await service.updateTemplate(id, { blocks: splitRuns(MINE) });
        // As if the review was checked just before that save.
        vi.spyOn(rows, "getRow").mockResolvedValueOnce(stale);

        await expect(
          service.applyOwnerUpdate(
            id,
            { [WHOLE_TEMPLATE]: { use: "mine" } },
            comparison.review
          )
        ).rejects.toMatchObject({ code: "CONFLICT" });
        expect(await service.getTemplate(id)).toMatchObject({
          blocks: splitRuns(MINE),
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("is based on the version it started from again on undo, so a plugin rolled back to it offers nothing", async () => {
      const id = await overridden();
      const service = await boot(V2);
      const { undo } = await service.applyOwnerUpdate(
        id,
        { [WHOLE_TEMPLATE]: { use: "theirs" } },
        (await service.compareTemplate(id)).review
      );
      await service.undoOwnerUpdate(id, undo);

      const rolledBack = await boot(V1);
      expect(await rolledBack.getTemplate(id)).toMatchObject({
        blocks: MINE,
        overridden: true,
        ownerChanged: false,
      });
    });

    it("is the plugin's blocks again on Reset", async () => {
      const id = await overridden();
      const service = await boot(V2);
      await service.resetTemplate(id);
      expect(await service.getTemplate(id)).toMatchObject({
        format: "written",
        blocks: V2,
        overridden: false,
      });
    });

    it("stays coded after the site converts it to code, past the next boot", async () => {
      const first = await boot(V1);
      const { id } = await paidTemplate(first);
      await first.updateTemplate(id, { format: "code" });
      expect(await first.getTemplate(id)).toMatchObject({
        format: "code",
        overridden: true,
      });

      const next = await boot(V1);
      expect(await next.getTemplate(id)).toMatchObject({
        format: "code",
        blocks: null,
        overridden: true,
        htmlContent: compileWrittenHtml(V1),
      });
    });

    it("takes over a site's template holding exactly its blocks, and keeps one with other blocks", async () => {
      const site = await boot(null);
      const same = await site.createTemplate({
        name: "Paid",
        slug: "orders-paid",
        subject: "Thanks for your payment",
        htmlContent: "",
        format: "written",
        blocks: V1,
      });
      const service = await boot(V1);
      expect(await service.getTemplate(same.id)).toMatchObject({
        owner: { kind: "plugin", name: ORDERS },
        overridden: false,
        blocks: V1,
      });

      await store.clear();
      const again = await boot(null);
      const other = await again.createTemplate({
        name: "Paid",
        slug: "orders-paid",
        subject: "Thanks for your payment",
        htmlContent: "",
        format: "written",
        blocks: MINE,
      });
      const claimed = await boot(V1);
      expect(await claimed.getTemplate(other.id)).toMatchObject({
        owner: { kind: "plugin", name: ORDERS },
        overridden: true,
        blocks: MINE,
      });
    });
  });
}
