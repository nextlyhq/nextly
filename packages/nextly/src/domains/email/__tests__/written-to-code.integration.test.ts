/**
 * A written template converted to code, on every configured dialect.
 *
 * Converting is a save of `format: "code"` through the template's ordinary
 * update (the PATCH route), and only one way: the template keeps exactly the
 * Liquid its blocks compiled to, chips, conditions and lists included, so it
 * sends the same email it did, and from then on it is edited as code. A site
 * that hasn't recorded its switch to Liquid yet renders it as Liquid too.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { dispatchEmailTemplates } from "../../../dispatcher/handlers/email-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { parseRestRoute } from "../../../route-handler/route-parser";
import type { EmailTemplateService } from "../services/email-template-service";
import { compileWrittenHtml, compileWrittenText } from "../written/compile";
import type { WrittenDocument } from "../written/document";
import { WRITTEN_SAMPLE_DATASETS, WRITTEN_SAMPLES } from "../written/samples";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const templates = (t: TestNextly) =>
  t.getService("emailTemplateService") as unknown as EmailTemplateService;

/** Every block the written format has, chips, conditions and a list among them. */
const EVERYTHING: WrittenDocument = {
  version: 1,
  blocks: Object.values(WRITTEN_SAMPLES),
};

/** A PATCH of the template, through the route the admin saves with. */
async function patch(id: string, body: Record<string, unknown>) {
  const route = parseRestRoute(["email-templates", id], "PATCH");
  return dispatchEmailTemplates(
    route.method as string,
    route.routeParams ?? {},
    body
  );
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`a written template converted to code — ${dialect}`, () => {
    async function writtenOrder(t: TestNextly) {
      return templates(t).createTemplate({
        name: "Order",
        slug: "order",
        subject: "Order {{ order.number }}",
        htmlContent: "",
        format: "written",
        blocks: EVERYTHING,
      });
    }

    for (const switchRecorded of [true, false]) {
      it(`sends exactly what it sent, under every kind of data (switch to Liquid ${switchRecorded ? "recorded" : "not recorded yet"})`, async () => {
        current = await createTestNextly({ dialect });
        const service = templates(current);
        if (!switchRecorded) {
          // As the first boot on Liquid, before its switch is recorded: the
          // written template is saved, and converted, in that window.
          await (
            service as unknown as {
              meta: { delete(key: string): Promise<void> };
            }
          ).meta.delete("email.templates.liquid.adoptedAt");
        }
        const created = await writtenOrder(current);
        const before: Record<string, unknown> = {};
        for (const [set, data] of Object.entries(WRITTEN_SAMPLE_DATASETS)) {
          before[set] = await service.renderStored(created, data);
        }

        await patch(created.id, { format: "code" });
        // The next boot records the switch, keeping every template the old
        // engine reads differently (as compiled Liquid is) unless it was
        // saved as Liquid.
        if (!switchRecorded) await service.ensureBuiltInTemplates();

        const converted = await service.getTemplate(created.id);
        expect(converted).toMatchObject({ format: "code", blocks: null });
        expect((await service.oldEngineStatus(created.id)).kept).toBe(false);
        for (const [set, data] of Object.entries(WRITTEN_SAMPLE_DATASETS)) {
          expect(await service.renderStored(converted, data)).toEqual(
            before[set]
          );
        }
        // The control: the comparison above rendered the blocks' chips,
        // conditions and list items.
        const typical = JSON.stringify(before.typical);
        expect(typical).toContain("Priya");
        expect(typical).toContain("Cake");
      });
    }

    it("is coded afterwards: its Liquid is what the blocks compiled to, edited as code, never written again", async () => {
      current = await createTestNextly({ dialect });
      const service = templates(current);
      const created = await writtenOrder(current);

      await patch(created.id, { format: "code" });

      const converted = await service.getTemplate(created.id);
      expect(converted.htmlContent).toBe(compileWrittenHtml(EVERYTHING));
      expect(converted.plainTextContent).toBe(compileWrittenText(EVERYTHING));

      await patch(created.id, { htmlContent: "<p>Hi {{ name }}</p>" });
      expect(
        (
          await service.renderStored(await service.getTemplate(created.id), {
            name: "Sam",
          })
        ).html
      ).toContain("Hi Sam");

      await expect(
        patch(created.id, { format: "written", blocks: EVERYTHING })
      ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
    });

    it("refuses blocks sent with the conversion, and leaves the template written", async () => {
      current = await createTestNextly({ dialect });
      const service = templates(current);
      const created = await writtenOrder(current);

      await expect(
        patch(created.id, { format: "code", blocks: EVERYTHING })
      ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });

      expect(await service.getTemplate(created.id)).toMatchObject({
        format: "written",
        blocks: EVERYTHING,
      });
    });
  });
}
