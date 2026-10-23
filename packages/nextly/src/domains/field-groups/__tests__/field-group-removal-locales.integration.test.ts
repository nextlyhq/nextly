/**
 * An update that removes a stored field-group instance is judged in every
 * language the instance holds, since removing it removes every translation.
 *
 * The localized field group `lnote` carries `secret`, which no update may
 * change. A value it holds only in Spanish is still a value: an update that
 * clears the instance, made in either language, must keep it. An instance that
 * holds no protected value in any language is removed, as the control.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  group,
  text,
} from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

type Doc = Record<string, unknown>;

describe.each(getConfiguredTestDialects())(
  "a removed field-group instance, in every language (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    /** A caller whose field rules are judged; the collection lets anyone write. */
    let checked: Nextly;

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        // No fallback: a language shows only its own values, so a value held
        // in one language is not seen from another.
        localization: {
          locales: ["en", "es"],
          defaultLocale: "en",
          fallback: false,
        },
        fieldGroups: [
          defineFieldGroup({
            slug: "lnote",
            localized: true,
            fields: [
              text({ name: "heading" }),
              text({ name: "secret", access: { update: false } }),
              // A translated container, held on the companion row and
              // written whole.
              group({
                name: "box",
                localized: true,
                fields: [
                  text({ name: "open" }),
                  text({ name: "kept", access: { update: false } }),
                ],
              }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "lpages",
            access: {
              create: () => true,
              read: () => true,
              update: () => true,
            },
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "one", component: "lnote" }),
            ],
          }),
          // A localized collection whose own translated group carries a field
          // no update may change.
          defineCollection({
            slug: "lcoll",
            localized: true,
            access: {
              create: () => true,
              read: () => true,
              update: () => true,
            },
            fields: [
              text({ name: "title" }),
              group({
                name: "meta",
                localized: true,
                fields: [
                  text({ name: "open" }),
                  text({ name: "kept", access: { update: false } }),
                ],
              }),
            ],
          }),
          // The same, published, whose status-less updates are held as drafts.
          defineCollection({
            slug: "ldrafted",
            status: true,
            versions: { drafts: true },
            access: {
              create: () => true,
              read: () => true,
              update: () => true,
            },
            fields: [
              text({ name: "title" }),
              fieldGroup({
                name: "many",
                component: "lnote",
                repeatable: true,
              }),
            ],
          }),
        ],
      } as never);
      trusted = new Nextly();
      checked = new Nextly({ overrideAccess: false });
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    /** A page whose instance holds `secret` only in Spanish. */
    async function spanishOnlySecret(tag: string): Promise<string> {
      const { item } = await trusted.create({
        collection: "lpages",
        data: { title: tag, one: { heading: `h-${tag}` } },
      } as never);
      const id = String(item.id);
      const one = (
        (await trusted.findByID({
          collection: "lpages",
          id,
          depth: 1,
        } as never)) as Doc
      ).one as Doc;
      await trusted.update({
        collection: "lpages",
        id,
        locale: "es",
        data: {
          one: { id: one.id, heading: `h-${tag}-es`, secret: "es-only" },
        },
      } as never);
      return id;
    }

    async function inSpanish(id: string): Promise<Doc | null> {
      const read = (await trusted.findByID({
        collection: "lpages",
        id,
        depth: 1,
        locale: "es",
      } as never)) as Doc;
      return (read.one as Doc | null | undefined) ?? null;
    }

    it("keeps it when the clear is made in the default language", async () => {
      const id = await spanishOnlySecret("en-clear");
      await checked.update({
        collection: "lpages",
        id,
        data: { one: null },
      } as never);
      expect((await inSpanish(id))?.secret).toBe("es-only");
    });

    it("keeps it when the clear is made in that language", async () => {
      const id = await spanishOnlySecret("es-clear");
      await checked.update({
        collection: "lpages",
        id,
        locale: "es",
        data: { one: null },
      } as never);
      expect((await inSpanish(id))?.secret).toBe("es-only");
    });

    it("keeps a denied child of a translated container at its stored value", async () => {
      const { item } = await trusted.create({
        collection: "lpages",
        data: {
          title: "box",
          one: { heading: "h-box", box: { open: "o", kept: "K" } },
        },
      } as never);
      const id = String(item.id);
      const one = (
        (await trusted.findByID({
          collection: "lpages",
          id,
          depth: 1,
        } as never)) as Doc
      ).one as Doc;
      await checked.update({
        collection: "lpages",
        id,
        data: { one: { id: one.id, box: { open: "o2", kept: "forged" } } },
      } as never);

      const after = (
        (await trusted.findByID({
          collection: "lpages",
          id,
          depth: 1,
        } as never)) as Doc
      ).one as Doc;
      expect(after.box).toEqual({ open: "o2", kept: "K" });
    });

    it("keeps it in a held draft that leaves it out of a list", async () => {
      const { item } = await trusted.create({
        collection: "ldrafted",
        data: {
          title: "d",
          status: "published",
          many: [{ heading: "a" }, { heading: "b" }],
        },
      } as never);
      const id = String(item.id);
      const read = async (args: Doc = {}) =>
        (
          (await trusted.findByID({
            collection: "ldrafted",
            id,
            depth: 1,
            ...args,
          } as never)) as Doc
        ).many as Doc[];
      const [first, second] = await read();
      // Published with it, so the Spanish value is stored rather than held.
      await trusted.update({
        collection: "ldrafted",
        id,
        locale: "es",
        data: {
          status: "published",
          many: [{ id: first.id }, { id: second.id, secret: "es-only" }],
        },
      } as never);
      // Held, since the entry is published: no save judges what it removes.
      await checked.update({
        collection: "ldrafted",
        id,
        data: { many: [{ id: first.id, heading: "a" }] },
      } as never);

      const draft = await read({ draft: true });
      expect(draft.map(instance => instance.id)).toEqual([first.id, second.id]);
    });

    it("keeps a denied child of the collection's own translated group", async () => {
      const { item } = await trusted.create({
        collection: "lcoll",
        data: { title: "c", meta: { open: "o", kept: "K" } },
      } as never);
      const id = String(item.id);
      await checked.update({
        collection: "lcoll",
        id,
        data: { meta: { open: "o2", kept: "forged" } },
      } as never);

      const after = (await trusted.findByID({
        collection: "lcoll",
        id,
      } as never)) as Doc;
      expect(after.meta).toEqual({ open: "o2", kept: "K" });
    });

    it("removes one that holds no protected value in any language", async () => {
      // The control: nothing it holds is beyond the writer, so it goes.
      const { item } = await trusted.create({
        collection: "lpages",
        data: { title: "plain", one: { heading: "h-plain" } },
      } as never);
      const id = String(item.id);
      await checked.update({
        collection: "lpages",
        id,
        data: { one: null },
      } as never);
      expect(await inSpanish(id)).toBeNull();
    });
  }
);
