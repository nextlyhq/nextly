/**
 * The binding picker's fields, `POST /binding-fields`, read as the person
 * editing reads them.
 *
 * What only a server shows: core's gate and field rules decide what is
 * listed. A Single the author may not read is not listed at all, a field
 * their rules hide is not listed, a field visitors may not read is listed as
 * not public with no value, and a value only a pending draft holds is marked
 * as a draft's rather than shown.
 *
 * @module __tests__/binding-fields-route.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, defineSingle, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import type {
  BindingFieldsResponse,
  PickerField,
} from "../binding-fields-contract";
import { pageBuilder } from "../plugin";

import { holding, person, post } from "./transfer-harness";

const ARTICLES = "bf_articles";
const CONTACT = "bf_contact";
const PAYROLL = "bf_payroll";

describe.each(getConfiguredTestDialects())(
  "the binding picker's fields (%s)",
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
        collections: [
          defineCollection({
            slug: ARTICLES,
            status: true,
            access: { read: () => true },
            fields: [
              text({ name: "title" }),
              // Signed-in people read it; visitors don't.
              text({
                name: "staffNote",
                access: { read: ({ user }: { user: unknown }) => user != null },
              } as never),
              // Nobody reads it through the gate, the author included.
              text({ name: "secret", access: { read: () => false } }),
            ],
          }),
        ],
        singles: [
          defineSingle({
            slug: CONTACT,
            access: { read: () => true },
            fields: [text({ name: "phone" })],
          }),
          // No rule: only a role granted its read may read it.
          defineSingle({ slug: PAYROLL, fields: [text({ name: "account" })] }),
        ],
        seedPublic: true,
      });
      await person(current, "owner");
      return current;
    }

    /** A published article, then a pending draft changing its title. */
    async function article(t: TestNextly): Promise<string> {
      const row = await t.nextly.create({
        collection: ARTICLES,
        data: {
          title: "Live title",
          staffNote: "Check stock first",
          secret: "The staff door code",
          status: "published",
        },
        overrideAccess: true,
      });
      const id = String(row.item.id);
      await t.nextly.update({
        collection: ARTICLES,
        id,
        data: { title: "Draft title", _overwrite: true },
        overrideAccess: true,
      });
      // Written live, so a visitor reads the same value the author does.
      await t.nextly.updateSingle({
        slug: CONTACT as never,
        data: { phone: "+44 20 7946 0000", _overwrite: true } as never,
        overrideAccess: true,
      } as never);
      await t.nextly.updateSingle({
        slug: PAYROLL as never,
        data: {
          account: "GB29 NWBK 6016 1331 9268 19",
          _overwrite: true,
        } as never,
        overrideAccess: true,
      } as never);
      return id;
    }

    const ask = async (cookie: string, id: string) => {
      const answer = await post(cookie, ["binding-fields"], {
        source: { kind: "collection", slug: ARTICLES, id },
      });
      expect(answer.status).toBe(200);
      return answer.body as unknown as BindingFieldsResponse;
    };

    const named = (fields: readonly PickerField[], name: string) =>
      fields.find(field => field.name === name);

    it("lists only what the author may read, marked as visitors would see it", async () => {
      const t = await boot();
      const id = await article(t);
      const { cookie } = await holding(t, [
        `read-${ARTICLES}`,
        `update-${ARTICLES}`,
        `read-${CONTACT}`,
      ]);
      const answer = await ask(cookie, id);

      const entry = answer.sources.find(
        source => source.binding.source === "entry"
      );
      expect(entry).toBeDefined();
      const fields = entry?.fields ?? [];
      // A draft's value is marked, not shown.
      expect(named(fields, "title")).toMatchObject({
        public: true,
        draft: true,
      });
      expect(named(fields, "title")?.preview).toBeUndefined();
      // Readable by the author, not by visitors: listed, with no value.
      expect(named(fields, "staffNote")).toMatchObject({ public: false });
      expect(named(fields, "staffNote")?.preview).toBeUndefined();
      // Hidden from the author too: never listed.
      expect(named(fields, "secret")).toBeUndefined();

      const contact = answer.sources.find(
        source =>
          source.binding.source === "single" &&
          source.binding.sourceKey === CONTACT
      );
      expect(named(contact?.fields ?? [], "phone")).toMatchObject({
        public: true,
        preview: "+44 20 7946 0000",
      });
      // A Single the author may not read: not its name, not its fields.
      const text = JSON.stringify(answer);
      expect(text).not.toContain(PAYROLL);
      expect(text).not.toContain("GB29");
      expect(answer.sources.at(-1)?.binding).toEqual({ source: "site" });
    });

    it("lists no entry the author may not read", async () => {
      const t = await boot();
      const id = await article(t);
      const { cookie } = await holding(t, [`read-${CONTACT}`]);
      const answer = await ask(cookie, id);
      expect(
        answer.sources.some(source => source.binding.source === "entry")
      ).toBe(false);
      expect(JSON.stringify(answer)).not.toContain("Check stock first");
    });
  }
);
