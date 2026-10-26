/**
 * The workbench's "Read it as Liquid" act, through its routes.
 *
 * A template stored before Liquid that the new engine would read differently
 * is kept on the old one, rendering exactly as before, until someone changes
 * the text that kept it and confirms. `GET .../engine` says whether it is kept
 * and why; `PATCH .../read-as-liquid` confirms. Run against a real database on
 * every dialect, through the routes' dispatcher, as a signed-in staff user.
 */

process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  asCaller,
  sessionCaller,
} from "../../../dispatcher/__tests__/request-caller";
import { dispatchEmailTemplates } from "../../../dispatcher/handlers/email-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import type { EmailTemplateService } from "../services/email-template-service";
import { interpolateTemplate } from "../services/template-engine";

import { storeAsBefore } from "./stored-before-liquid";

const LITERAL_IF = "<p>Members: {% if vip %}VIP{% endif %} {{name}}</p>";
const DATA = { name: "Priya", vip: true };

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const templates = (t: TestNextly) =>
  t.getService("emailTemplateService") as unknown as EmailTemplateService;

/** A route's dispatcher, called as the staff user; the response body. */
async function asStaff(
  staffId: string,
  method: string,
  templateId: string
): Promise<Record<string, unknown>> {
  const response = await asCaller(sessionCaller({ userId: staffId }), () =>
    dispatchEmailTemplates(method, { templateId }, undefined)
  );
  return (await (response as Response).json()) as Record<string, unknown>;
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`reading a kept template as Liquid — ${dialect}`, () => {
    it("says why it is kept, refuses until the text changes, then reads it as Liquid", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const id = await storeAsBefore(t, dialect, "members", LITERAL_IF);
      // The first boot on Liquid records which stored templates it keeps.
      await templates(t).ensureBuiltInTemplates();
      const staff = await new ServiceContainer(t.adapter).users.createLocalUser(
        {
          email: "staff@example.com",
          name: "Staff",
          password: "Str0ng-P@ssw0rd!",
          isActive: true,
          emailVerification: "admin-vouched",
        }
      );
      const staffId = String(staff.id);

      const engine = await asStaff(staffId, "templateEngine", id);
      expect(engine).toMatchObject({
        kept: true,
        reasons: [expect.objectContaining({ field: "htmlContent" })],
      });

      // Confirming text nobody changed would change the email: refused.
      await expect(asStaff(staffId, "readAsLiquid", id)).rejects.toMatchObject({
        code: "BUSINESS_RULE_VIOLATION",
      });
      expect((await asStaff(staffId, "templateEngine", id)).kept).toBe(true);

      // Changed, then confirmed through the route: Liquid from now on.
      await t.nextly.emailTemplates.update({
        id,
        data: { htmlContent: "<p>Members: {% if vip %}VIP{% endif %}</p>" },
      });
      expect(await asStaff(staffId, "readAsLiquid", id)).toMatchObject({
        message: "This email is now read as Liquid.",
      });
      expect(await asStaff(staffId, "templateEngine", id)).toEqual({
        kept: false,
        reasons: [],
      });
      expect(
        (await t.nextly.emailTemplates.preview({ id, data: DATA })).html
      ).toBe("<p>Members: VIP</p>");
    });

    it("leaves an unconfirmed template rendering exactly as before", async () => {
      const t = (current = await createTestNextly({ dialect }));
      const id = await storeAsBefore(t, dialect, "members", LITERAL_IF);
      await templates(t).ensureBuiltInTemplates();

      expect(
        (await t.nextly.emailTemplates.preview({ id, data: DATA })).html
      ).toBe(interpolateTemplate(LITERAL_IF, DATA));
    });
  });
}
