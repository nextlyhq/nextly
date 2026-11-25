/**
 * A plugin's real records follow its collection when the host renames it: the
 * loader still names the collection as the plugin declared it, and the access
 * check asks about the collection as it is called on this site, rules and
 * all.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readAccessCaller } from "../../../auth/entity-read-access";
import { defineCollection, text } from "../../../config";
import { seedAllPermissions } from "../../../init/seed-permissions";
import type { PluginEmailTemplate } from "../../../plugins/contributions";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { ServiceContainer } from "../../../services/index";
import { listSampleRecords, type SampleRecordCaller } from "../sample-records";
import type { EmailTemplateService } from "../services/email-template-service";
import { ownershipFromConfig } from "../template-ownership";

const DECLARED = "renshop_orders";
const RENAMED = "renshop_purchases";
const SLUG = "renshop-order-shipped";
const KEPT = "renshop_kept";
const KEPT_RENAMED = "renshop_hidden";
const KEPT_SLUG = "renshop-kept-shipped";

let listed = 0;

/** A template whose real records are read from `collection`. */
const templateOf = (slug: string, collection: string): PluginEmailTemplate => ({
  slug,
  name: "Order shipped",
  subject: "Order {{ orderNumber }}",
  htmlContent: "<p>{{ orderNumber }}</p>",
  variables: [{ name: "orderNumber" }],
  sampleRecords: {
    label: "A real order",
    reads: { collection },
    list: () => {
      listed++;
      return Promise.resolve([{ id: "1", label: "Order 1" }]);
    },
    load: () => Promise.resolve({ orderNumber: "1" }),
  },
});

/** A loader with no `load`, which is malformed and offers nothing. */
const malformed = {
  ...templateOf("renshop-malformed", DECLARED),
  sampleRecords: {
    label: "A real order",
    reads: { collection: DECLARED },
    list: () => Promise.resolve([]),
  },
} as unknown as PluginEmailTemplate;

const shop = definePlugin({
  name: "renshop",
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    collections: [
      defineCollection({ slug: DECLARED, fields: [text({ name: "number" })] }),
      defineCollection({
        slug: KEPT,
        fields: [text({ name: "number" })],
        access: { read: () => false },
      }),
    ],
    emailTemplates: [
      templateOf(SLUG, DECLARED),
      templateOf(KEPT_SLUG, KEPT),
      malformed,
    ],
  },
});

async function permissionIds(t: TestNextly, slugs: string[]) {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const found = await t.nextly.permissions.find({ limit: 100, page });
    ids.push(
      ...found.items.filter(p => slugs.includes(p.slug)).map(p => String(p.id))
    );
    if (!found.meta.hasNext) return ids;
  }
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`real records of a renamed collection — ${dialect}`, () => {
    let t: TestNextly;
    let templates: EmailTemplateService;
    let reader: SampleRecordCaller;
    let stranger: SampleRecordCaller;

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        plugins: [shop.rename!({ [DECLARED]: RENAMED, [KEPT]: KEPT_RENAMED })],
      });
      try {
        templates = t.getService(
          "emailTemplateService"
        ) as unknown as EmailTemplateService;
        // Ownership as every boot reads it: from the configuration it keeps.
        templates.configureOwnership(
          ownershipFromConfig(t.getService("config"))
        );
        const services = new ServiceContainer(t.adapter);
        await seedAllPermissions();
        const person = async (name: string): Promise<SampleRecordCaller> => {
          const made = await t.nextly.users.create({
            email: `${name}@renamed.test`,
            password: "Password123!",
            data: { name, isActive: true },
          });
          const id = String((made.item as { id: string | number }).id);
          return {
            readCaller: readAccessCaller({ user: { id } }),
            userId: id,
          };
        };
        // The install's first account, which core makes super-admin, so the
        // people asking are judged by what they hold.
        await person("owner");
        reader = await person("reader");
        stranger = await person("stranger");
        const granted = await permissionIds(t, [
          `read-${RENAMED}`,
          `read-${KEPT_RENAMED}`,
        ]);
        expect(granted).toHaveLength(2);
        const role = await t.nextly.roles.create({
          data: { name: "reader", slug: "ren-reader", permissionIds: granted },
        });
        await services.userRoles.assignRoleToUser(
          reader.userId ?? "",
          String(role.item.id)
        );
      } catch (error) {
        await t.destroy();
        throw error;
      }
    }, 120_000);

    afterAll(async () => {
      await t?.destroy();
    });

    /** Whether `caller` is offered a template's records, or how refused. */
    async function offered(slug: string, caller: SampleRecordCaller) {
      return listSampleRecords(
        templates.ownerSampleRecords(slug)?.source,
        caller
      ).then(
        () => "offered",
        (error: { code?: string }) => error.code ?? "no code"
      );
    }

    it("are read from the collection under the name the host gave it", async () => {
      listed = 0;
      expect(templates.ownerSampleRecords(SLUG)?.source.reads).toEqual({
        collection: RENAMED,
      });
      expect(await offered(SLUG, reader)).toBe("offered");
      expect(listed).toBe(1);
    });

    it("are refused where the renamed collection's read rule refuses, and to a person holding no read of it", async () => {
      listed = 0;
      expect(templates.ownerSampleRecords(KEPT_SLUG)?.source.reads).toEqual({
        collection: KEPT_RENAMED,
      });
      // Holds the permission, which the collection's own rule narrows to none.
      expect(await offered(KEPT_SLUG, reader)).toBe("FORBIDDEN");
      expect(await offered(SLUG, stranger)).toBe("FORBIDDEN");
      expect(listed).toBe(0);
    });

    it("are not offered from a malformed loader, renamed or not", () => {
      expect(templates.ownerSampleRecords("renshop-malformed")).toBeUndefined();
    });
  });
}
