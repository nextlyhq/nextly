/**
 * A field group placed directly in another is a row under its parent's row, so its identity
 * includes that parent: the same id under another parent names no stored row, and the save creates
 * it there.
 *
 * `idchild` carries `later`, which any update may change and no create may set. A writer's held
 * draft copies a stored child's id into another outer instance, a new one or a different stored
 * one, with `later` set. The draft is judged as its publish will write it: that child is created,
 * so `later` is the create's to judge, and the writer may not set it. Judged as an update of the
 * stored child its id came from, the draft would keep the writer's value, for a later publisher
 * allowed to write it to promote.
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantPublic } from "../../../__tests__/helpers/public-role";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
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

type Doc = Record<string, unknown>;

function list(value: unknown): Doc[] {
  return (Array.isArray(value) ? value : value ? [value] : []) as Doc[];
}

describe.each(getConfiguredTestDialects())(
  "a nested field group's identity includes its parent (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let trusted: Nextly;
    let writerCookie = "";

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        seedPublic: true,
        fieldGroups: [
          defineFieldGroup({
            slug: "idchild",
            fields: [
              text({ name: "heading" }),
              text({ name: "later", access: { create: false } }),
            ],
          }),
          defineFieldGroup({
            slug: "idouter",
            fields: [
              text({ name: "heading" }),
              fieldGroup({ name: "child", component: "idchild" }),
            ],
          }),
        ],
        collections: [
          defineCollection({
            slug: "idpages",
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
                name: "panel",
                component: "idouter",
                repeatable: true,
              }),
            ],
          }),
        ],
      } as never);
      await grantPublic(t, ["update-idpages"]);
      trusted = new Nextly();
      const writer = (
        await trusted.users.create({
          email: "id-writer@example.com",
          password: "Password123!",
          data: { name: "Writer", isActive: true },
        } as never)
      ).item as { id: string };
      const token = await signAccessToken(
        buildClaims({
          userId: String(writer.id),
          email: "id-writer@example.com",
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

    /** A published page holding `panel`, written by trusted code. */
    async function published(panel: Doc[]): Promise<{ id: string; live: Doc }> {
      const { item } = await trusted.create({
        collection: "idpages",
        data: { title: "P", status: "published", panel },
      } as never);
      const id = String(item.id);
      return { id, live: await read(id, false) };
    }

    async function read(id: string, draft: boolean): Promise<Doc> {
      return (await trusted.findByID({
        collection: "idpages",
        id,
        depth: 1,
        ...(draft ? { draft: true } : {}),
      } as never)) as Doc;
    }

    /** The writer's save, held as a draft of the published page. */
    async function writerSaves(id: string, data: Doc): Promise<number> {
      const path = ["collections", "idpages", "entries", id];
      const handlers = createDynamicHandlers() as unknown as Record<
        string,
        (request: Request, context: unknown) => Promise<Response>
      >;
      const res = await handlers.PATCH!(
        new Request(`http://localhost/api/${path.join("/")}`, {
          method: "PATCH",
          headers: { cookie: writerCookie, "content-type": "application/json" },
          body: JSON.stringify({ ...data, _overwrite: true }),
        }),
        { params: Promise.resolve({ params: path }) }
      );
      return res.status;
    }

    /** What `later` each outer instance's child holds in the page's draft. */
    async function draftedLater(id: string): Promise<unknown[]> {
      return list((await read(id, true)).panel).map(
        outer => (outer.child as Doc | null | undefined)?.later ?? null
      );
    }

    it("judges a stored child's id copied under a new outer instance as a create", async () => {
      const { id, live } = await published([
        { heading: "A", child: { heading: "a", later: "trusted" } },
      ]);
      const [a] = list(live.panel);
      const copiedId = (a!.child as Doc).id;

      const status = await writerSaves(id, {
        panel: [
          a,
          {
            heading: "B",
            child: { id: copiedId, heading: "b", later: "writer" },
          },
        ],
      });

      expect(status).toBe(200);
      expect(await draftedLater(id)).toEqual(["trusted", null]);
    });

    it("judges a stored child's id copied under a different stored outer instance as a create", async () => {
      const { id, live } = await published([
        { heading: "A", child: { heading: "a", later: "trusted" } },
        { heading: "B" },
      ]);
      const [a, b] = list(live.panel);
      const copiedId = (a!.child as Doc).id;

      const status = await writerSaves(id, {
        panel: [
          a,
          { ...b, child: { id: copiedId, heading: "b", later: "writer" } },
        ],
      });

      expect(status).toBe(200);
      expect(await draftedLater(id)).toEqual(["trusted", null]);
    });
  }
);
