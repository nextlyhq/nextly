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
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  group,
  text,
} from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

type Doc = Record<string, unknown>;

const ALLOWED = "allowed@example.com";
/** Writable only by the allowed person, so the denial has a control. */
const onlyAllowed = ({ user }: { user: unknown }) =>
  (user as { email?: string } | null)?.email === ALLOWED;

describe.each(getConfiguredTestDialects())(
  "a removed field-group instance, in every language (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    /** A caller whose field rules are judged; the collection lets anyone write. */
    let checked: Nextly;
    /** A signed-in writer's session, for the REST door, which needs one. */
    let writerCookie = "";

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
          // As `lnote`, with a `secret` the allowed person may change.
          defineFieldGroup({
            slug: "lnote2",
            localized: true,
            fields: [
              text({ name: "heading" }),
              text({ name: "secret", access: { update: onlyAllowed } }),
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
          // A localized collection with no field rule of its own, whose
          // translated group holds a field group inline.
          defineCollection({
            slug: "lwrap",
            localized: true,
            access: {
              create: () => true,
              read: () => true,
              update: () => true,
            },
            fields: [
              text({ name: "title" }),
              group({
                name: "wrap",
                localized: true,
                fields: [fieldGroup({ name: "held", component: "lnote2" })],
              }),
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
      const writer = (
        await trusted.users.create({
          email: "writer@example.com",
          password: "Password123!",
          data: { name: "Writer", isActive: true },
        } as never)
      ).item as { id: string };
      const token = await signAccessToken(
        buildClaims({
          userId: String(writer.id),
          email: "writer@example.com",
          name: "Writer",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET!
      );
      writerCookie = `nextly_session=${token}`;
      // A code rule only narrows the permission, so the allowed person holds
      // read and update on lwrap, and its rules decide what they may change.
      await userWhoMay(t, "allowed-user", "update", ["lwrap"]);
      await grantTo(t, "allowed-user", "read", ["lwrap"]);
    }, 180_000);

    afterAll(async () => {
      resetSessionStandingForTests();
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

    /** A PATCH through REST, as the signed-in writer. */
    async function restPatch(path: string[], body: unknown): Promise<number> {
      const handlers = createDynamicHandlers() as unknown as Record<
        string,
        (request: Request, context: unknown) => Promise<Response>
      >;
      const res = await handlers.PATCH!(
        new Request(`http://localhost/api/${path.join("/")}`, {
          method: "PATCH",
          headers: { cookie: writerCookie, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ params: path }) }
      );
      return res.status;
    }

    describe("a held draft that leaves an instance out of a list", () => {
      /**
       * A published `ldrafted` entry with two instances; the second holds
       * `spanish` as its secret in Spanish only, when it is given.
       */
      async function publishedTwo(spanish?: string) {
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
        if (spanish !== undefined) {
          // Published with it, so the Spanish value is stored rather than held.
          await trusted.update({
            collection: "ldrafted",
            id,
            locale: "es",
            data: {
              status: "published",
              many: [{ id: first.id }, { id: second.id, secret: spanish }],
            },
          } as never);
        }
        return { id, first, second, read };
      }

      /** A held save of `data`: the entry is published, so it is held. */
      async function hold(door: "direct" | "rest", id: string, data: Doc) {
        if (door === "rest") {
          expect(
            await restPatch(["collections", "ldrafted", "entries", id], data)
          ).toBe(200);
          return;
        }
        await checked.update({ collection: "ldrafted", id, data } as never);
      }

      it.each(["direct", "rest"] as const)(
        "keeps one holding a protected value only in another language, through %s",
        async door => {
          const { id, first, second, read } = await publishedTwo("es-only");
          // No save judges what a held draft removes.
          await hold(door, id, { many: [{ id: first.id, heading: "a" }] });

          const draft = await read({ draft: true });
          expect(draft.map(instance => instance.id)).toEqual([
            first.id,
            second.id,
          ]);
        }
      );

      it("leaves out one that holds no protected value in any language", async () => {
        // The control: nothing it holds is beyond the writer, so it goes.
        const { id, first, read } = await publishedTwo();
        await hold("direct", id, { many: [{ id: first.id, heading: "a" }] });

        const draft = await read({ draft: true });
        expect(draft.map(instance => instance.id)).toEqual([first.id]);
      });
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

    describe("an inline field group in a localized collection's translated group", () => {
      /** An `lwrap` entry whose inline instance holds `secret`. */
      async function wrapped(tag: string): Promise<string> {
        const { item } = await trusted.create({
          collection: "lwrap",
          data: {
            title: tag,
            wrap: { held: { heading: "h", secret: `S-${tag}` } },
          },
        } as never);
        return String(item.id);
      }
      const innerOf = async (id: string) =>
        (
          (
            (await trusted.findByID({
              collection: "lwrap",
              id,
            } as never)) as Doc
          ).wrap as Doc
        ).held as Doc;
      const change = (tag: string) => ({
        wrap: { held: { heading: `h-${tag}`, secret: "forged" } },
      });

      it.each(["direct", "rest"] as const)(
        "keeps the child its update rule denies, through %s",
        async door => {
          const id = await wrapped(`w-${door}`);
          if (door === "rest") {
            expect(
              await restPatch(
                ["collections", "lwrap", "entries", id],
                change(door)
              )
            ).toBe(200);
          } else {
            await checked.update({
              collection: "lwrap",
              id,
              data: change(door),
            } as never);
          }

          const inner = await innerOf(id);
          expect([inner.heading, inner.secret]).toEqual([
            `h-${door}`,
            `S-w-${door}`,
          ]);
        }
      );

      it("lets the allowed person change it", async () => {
        // The control: the rule allows this caller, so the value changes.
        const id = await wrapped("w-ok");
        await new Nextly({
          overrideAccess: false,
          user: { id: "allowed-user", email: ALLOWED },
        }).update({ collection: "lwrap", id, data: change("ok") } as never);

        expect((await innerOf(id)).secret).toBe("forged");
      });
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
