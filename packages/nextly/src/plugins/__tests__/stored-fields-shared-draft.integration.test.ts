/**
 * Under per-language storage, a plugin's stored-value read and conditional
 * write see a document's shared draft, in whichever language they ask in.
 *
 * A shared field's held edit lives in the document's shared draft, not in the
 * language's own draft (`part-drafts`). A `draft` read that looked only for the
 * language's draft would hand the plugin the live value as though nothing were
 * pending, and a conditional write that asks for no pending draft would go
 * through over an edit the author is still holding.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import { storedValueHash } from "../../domains/collections/services/stored-field-read";
import type { CollectionsHandler } from "../../services/collections-handler";
import { NextlyError } from "../../errors";
import type { PluginStoredValue } from "../contributions";
import { definePlugin } from "../plugin-context";
import type { PluginRouteIdentity } from "../routes/route-types";
import { readStoredFields, updateIfUnchanged } from "../stored-fields";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../test-nextly";

const SLUG = "sharedocs";

/** A plugin field type stored as JSON: a shared field, kept on the main row. */
const DOC_TYPE = {
  type: "doc",
  storage: "json",
  component: "@test/doc/admin#Doc",
} as const;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(
  dialect: TestDialect
): Promise<{ t: TestNextly; owner: PluginRouteIdentity }> {
  const plugin = definePlugin({
    name: "@test/stored-shared-draft",
    version: "1.0.0",
    nextly: ">=0.0.0",
    contributes: { fieldTypes: [DOC_TYPE] },
  });
  current = await createTestNextly({
    dialect,
    perLanguageStorage: true,
    plugins: [plugin],
    collections: [
      {
        slug: SLUG,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          { name: "title", type: "text" },
          { name: "body", type: "doc" },
        ],
      } as unknown as CollectionConfig,
    ],
    localization: { locales: ["en", "es"], defaultLocale: "en" },
  });
  const users = current.nextly as unknown as {
    users: {
      create(a: {
        email: string;
        password: string;
        data: Record<string, unknown>;
      }): Promise<{ item: { id: string } }>;
    };
  };
  // The install's first account holds super-admin.
  const ownerId = (
    await users.users.create({
      email: "owner@example.com",
      password: "Password123!",
      data: { name: "owner", isActive: true },
    })
  ).item.id;
  return { t: current, owner: { user: { id: ownerId } } };
}

/** A published entry whose shared `body` holds a pending edit made in Spanish. */
async function heldSharedEdit(t: TestNextly): Promise<string> {
  const entries = (
    t.getService("collectionsHandler") as CollectionsHandler
  ).getEntryService();
  const created = await entries.createEntry(
    { collectionName: SLUG, overrideAccess: true, locale: "en" },
    { title: "en title", body: { v: "live" }, status: "published" }
  );
  expect(created.success, JSON.stringify(created)).toBe(true);
  const id = (created.data as { id: string }).id;
  const held = await entries.updateEntry(
    { collectionName: SLUG, entryId: id, overrideAccess: true, locale: "es" },
    { body: { v: "held" }, _overwrite: true }
  );
  expect(held.success, JSON.stringify(held)).toBe(true);
  return id;
}

async function bodyAs(
  owner: PluginRouteIdentity,
  id: string,
  form: "published" | "draft"
): Promise<PluginStoredValue> {
  const read = await readStoredFields(owner, {
    collection: SLUG,
    id,
    fields: ["body"],
    form,
    locale: "es",
  });
  if (read.kind !== "found") throw new Error("expected a stored entry");
  const value = read.values.body;
  if (value === undefined) throw new Error("no value for body");
  return value;
}

describe.each(getConfiguredTestDialects())(
  "a plugin's stored read of a shared draft (integration, %s)",
  dialect => {
    it("reads the pending shared edit as `draft`, and the live value as `published`", async () => {
      const { t, owner } = await boot(dialect);
      const id = await heldSharedEdit(t);

      expect(await bodyAs(owner, id, "draft")).toEqual({
        kind: "value",
        value: { v: "held" },
      });
      // The control: the live value is still the published one.
      expect(await bodyAs(owner, id, "published")).toEqual({
        kind: "value",
        value: { v: "live" },
      });
    }, 90_000);

    it("refuses a conditional publish that asks for no pending draft while the shared draft is held", async () => {
      const { t, owner } = await boot(dialect);
      const id = await heldSharedEdit(t);
      const hash = await storedValueHash(await bodyAs(owner, id, "published"));

      let refusal: unknown;
      await updateIfUnchanged(owner, {
        collection: SLUG,
        id,
        locale: "es",
        data: { body: { v: "plugin" }, status: "published" },
        expect: {
          field: "body",
          form: "published",
          hash,
          noPendingDraft: true,
        },
      }).catch((error: unknown) => {
        refusal = error;
      });

      expect(NextlyError.isCode(refusal, "CONFLICT")).toBe(true);
      expect(await bodyAs(owner, id, "published")).toEqual({
        kind: "value",
        value: { v: "live" },
      });
    }, 90_000);
  }
);
