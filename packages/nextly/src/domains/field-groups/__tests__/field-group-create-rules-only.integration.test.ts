/**
 * A field group's create rule holds on an update that adds an instance, where
 * no field group declares an update rule at all.
 *
 * The field group `cnote` carries `secret`, which no new instance may set, and
 * `cwrap` holds a `cnote` inline, in a group. With no update rule anywhere, an
 * update's own pass has nothing to ask; the instance it adds is created by its
 * save, which judges what that instance holds inline as created with it. A
 * trusted write is the control.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { grantPublic } from "../../../__tests__/helpers/public-role";

type Doc = Record<string, unknown>;

function list(value: unknown): Doc[] {
  return (Array.isArray(value) ? value : value ? [value] : []) as Doc[];
}

/** The secret each `cwrap` instance in `value` holds inline. */
function secrets(value: unknown): unknown[] {
  return list(value).map(
    instance => list(list(instance.box)[0]?.held)[0]?.secret ?? null
  );
}

function wrap(tag: string): Doc {
  return { heading: tag, box: { held: { heading: tag, secret: `s-${tag}` } } };
}

describe.each(getConfiguredTestDialects())(
  "a field group's create rule with no update rule anywhere (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let writerCookie = "";

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        // The boot's seeding, which makes the Public role the checked direct
        // update below, made with no user, is judged by.
        seedPublic: true,
        fieldGroups: [
          defineFieldGroup({
            slug: "cnote",
            fields: [
              text({ name: "heading" }),
              text({ name: "secret", access: { create: false } }),
            ],
          }),
          defineFieldGroup({
            slug: "cwrap",
            fields: [
              text({ name: "heading" }),
              group({
                name: "box",
                fields: [fieldGroup({ name: "held", component: "cnote" })],
              }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "cpages",
            access: {
              create: () => true,
              read: () => true,
              update: () => true,
            },
            fields: [
              text({ name: "title" }),
              fieldGroup({
                name: "deck",
                component: "cwrap",
                repeatable: true,
              }),
            ],
          }),
        ],
      } as never);
      // The collection's rule only narrows the update permission, so Public
      // holds it, as a site admin would grant it: the direct door's visitor
      // then reaches the field group's create rule.
      await grantPublic(t, ["update-cpages"]);
      trusted = new Nextly();
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
    }, 180_000);

    afterAll(async () => {
      resetSessionStandingForTests();
      await t?.destroy();
    });

    async function seeded(tag: string): Promise<{ id: string; first: Doc }> {
      const { item } = await trusted.create({
        collection: "cpages",
        data: { title: tag, deck: [wrap(`${tag}-0`)] },
      } as never);
      const id = String(item.id);
      return { id, first: list((await read(id)).deck)[0]! };
    }

    async function read(id: string): Promise<Doc> {
      return (await trusted.findByID({
        collection: "cpages",
        id,
        depth: 1,
      } as never)) as Doc;
    }

    async function update(door: "direct" | "rest", id: string, data: Doc) {
      if (door === "direct") {
        await new Nextly({ overrideAccess: false }).update({
          collection: "cpages",
          id,
          data,
        } as never);
        return;
      }
      const path = ["collections", "cpages", "entries", id];
      const handlers = createDynamicHandlers() as unknown as Record<
        string,
        (request: Request, context: unknown) => Promise<Response>
      >;
      const res = await handlers.PATCH!(
        new Request(`http://localhost/api/${path.join("/")}`, {
          method: "PATCH",
          headers: { cookie: writerCookie, "content-type": "application/json" },
          body: JSON.stringify(data),
        }),
        { params: Promise.resolve({ params: path }) }
      );
      expect(res.status).toBe(200);
    }

    it.each(["direct", "rest"] as const)(
      "stores no inline secret in an instance an update adds, through %s",
      async door => {
        const { id, first } = await seeded(`u-${door}`);

        await update(door, id, { deck: [first, wrap(`u-${door}-new`)] });

        // The stored instance keeps the secret trusted code set; the added
        // one is created, and its inline secret is not.
        expect(secrets((await read(id)).deck)).toEqual([`s-u-${door}-0`, null]);
      }
    );

    it("lets trusted code set it", async () => {
      const { id, first } = await seeded("t");

      await trusted.update({
        collection: "cpages",
        id,
        data: { deck: [first, wrap("t-new")] },
      } as never);

      expect(secrets((await read(id)).deck)).toEqual(["s-t-0", "s-t-new"]);
    });
  }
);
