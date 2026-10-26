/**
 * A write that changes only an entry's status is a publish or an unpublish,
 * judged by that permission and rule alone; a write that also names a field
 * needs update for it, whatever the value.
 *
 * Each case is asked as a caller who may publish and not update, on every path
 * a status write takes: REST, the Direct API, a plugin's services, a batch, an
 * update by query and a Single. The status alone goes through; the same write
 * naming one field is refused and writes nothing, the status included.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import { defineCollection, defineSingle, text } from "../../../config";
import { Nextly } from "../../../direct-api/nextly";
import { NextlyError } from "../../../errors/nextly-error";
import {
  definePlugin,
  type PluginContext,
} from "../../../plugins/plugin-context";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";

type PluginServices = PluginContext["services"];

const POSTS = "posts";
/** No draft/published lifecycle; its `status` is an ordinary field. */
const NOTES = "notes";
const HOME = "home";
/** May read, publish and unpublish, and not update. */
const PUBLISHER = "publisher-1";
/** May read and update, and not publish. */
const EDITOR = "editor-1";
/** May read, and not update, publish or unpublish. */
const READER = "reader-1";

let current: TestNextly | undefined;
let services: PluginServices | undefined;

afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
  services = undefined;
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  const probe = definePlugin({
    name: "@test/status-write-probe",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init: c => {
      services = c.services;
    },
  });
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: NOTES,
        fields: [text({ name: "title" }), text({ name: "status" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: HOME,
        status: true,
        fields: [text({ name: "headline" })],
      }),
    ],
    plugins: [probe],
  });
  // A code rule only narrows the permission; these callers hold exactly what
  // their names say, so the gates decide.
  await userWhoMay(current, PUBLISHER, "read", [POSTS, NOTES, HOME]);
  await grantTo(current, PUBLISHER, "publish", [POSTS, NOTES, HOME]);
  await grantTo(current, PUBLISHER, "unpublish", [POSTS, NOTES, HOME]);
  await userWhoMay(current, EDITOR, "read", [POSTS]);
  await grantTo(current, EDITOR, "update", [POSTS]);
  return current;
}

const trusted = () => new Nextly();
const as = (id: string) =>
  new Nextly({ overrideAccess: false, user: { id } as never });
const asPlugin = (id: string) =>
  ({ as: "user", user: { id } }) as unknown as Record<string, never>;

function pluginServices(): PluginServices {
  if (!services) {
    throw NextlyError.internal({
      logContext: { reason: "test-plugin-init-did-not-run" },
    });
  }
  return services;
}

async function draft(collection: string, title: string): Promise<string> {
  const { item } = await trusted().create({
    collection,
    data: { title, status: "draft" },
  } as never);
  return String((item as { id: unknown }).id);
}

async function stored(
  collection: string,
  id: string
): Promise<{ title?: unknown; status?: unknown }> {
  return (await trusted().findByID({ collection, id } as never)) as {
    title?: unknown;
    status?: unknown;
  };
}

/** A REST write as `userId`, answered with its response. */
async function restResponse(
  userId: string,
  method: "PATCH",
  path: string[],
  body: unknown
): Promise<Response> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.test`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  const handlers = createDynamicHandlers() as unknown as Record<
    string,
    (request: Request, context: unknown) => Promise<Response>
  >;
  const res = await handlers[method]!(
    new Request(`http://localhost/api/${path.join("/")}`, {
      method,
      headers: {
        cookie: `nextly_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return res;
}

/** A REST write as `userId`, answered with its status. */
async function rest(
  userId: string,
  method: "PATCH",
  path: string[],
  body: unknown
): Promise<number> {
  return (await restResponse(userId, method, path, body)).status;
}

/** A REST write as `userId`, answered with its status and error message. */
async function restRefusal(
  userId: string,
  path: string[],
  body: unknown
): Promise<{ status: number; message: unknown }> {
  const res = await restResponse(userId, "PATCH", path, body);
  const json = (await res.json()) as { error?: { message?: unknown } };
  return { status: res.status, message: json.error?.message };
}

describe.each(getConfiguredTestDialects())(
  "a status-only write is judged by its own permission (%s)",
  dialect => {
    it("publishes over REST, and refuses the same PATCH naming a field", async () => {
      await boot(dialect);
      const id = await draft(POSTS, "t");
      const entry = ["collections", POSTS, "entries", id];

      expect(
        await rest(PUBLISHER, "PATCH", entry, {
          status: "draft",
          title: "edited",
        })
      ).toBe(403);
      expect(await stored(POSTS, id)).toMatchObject({
        title: "t",
        status: "draft",
      });

      expect(
        await rest(PUBLISHER, "PATCH", entry, { status: "published" })
      ).toBe(200);
      expect((await stored(POSTS, id)).status).toBe("published");
    });

    it("publishes through the Direct API, and refuses a write naming a field", async () => {
      await boot(dialect);
      const id = await draft(POSTS, "t");

      await expect(
        as(PUBLISHER).update({
          collection: POSTS,
          id,
          data: { status: "published", title: "edited" },
        } as never)
      ).rejects.toThrow();
      expect(await stored(POSTS, id)).toMatchObject({
        title: "t",
        status: "draft",
      });

      await as(PUBLISHER).update({
        collection: POSTS,
        id,
        data: { status: "published" },
      } as never);
      expect((await stored(POSTS, id)).status).toBe("published");
    });

    it("publishes through a plugin's services, and refuses a write naming a field", async () => {
      await boot(dialect);
      const id = await draft(POSTS, "t");
      const collections = pluginServices().collections;

      await expect(
        collections.updateEntry(
          POSTS,
          id,
          { status: "published", title: "edited" },
          asPlugin(PUBLISHER)
        )
      ).rejects.toThrow();
      expect(await stored(POSTS, id)).toMatchObject({
        title: "t",
        status: "draft",
      });

      await collections.updateEntry(
        POSTS,
        id,
        { status: "published" },
        asPlugin(PUBLISHER)
      );
      expect((await stored(POSTS, id)).status).toBe("published");
    });

    it("judges each row of a batch: the status-only row goes, the edited row writes nothing", async () => {
      await boot(dialect);
      const plain = await draft(POSTS, "plain");
      const edited = await draft(POSTS, "edited-row");

      const result = await pluginServices().collections.updateMany(
        POSTS,
        [
          { id: plain, data: { status: "published" } },
          { id: edited, data: { status: "published", title: "changed" } },
        ],
        asPlugin(PUBLISHER)
      );

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect((await stored(POSTS, plain)).status).toBe("published");
      expect(await stored(POSTS, edited)).toMatchObject({
        title: "edited-row",
        status: "draft",
      });
    });

    it("publishes by query, and refuses an update by query naming a field", async () => {
      await boot(dialect);
      const id = await draft(POSTS, "t");
      const where = { id: { equals: id } };

      await expect(
        as(PUBLISHER).update({
          collection: POSTS,
          where,
          data: { status: "published", title: "edited" },
        } as never)
      ).rejects.toThrow();
      expect(await stored(POSTS, id)).toMatchObject({
        title: "t",
        status: "draft",
      });

      await as(PUBLISHER).update({
        collection: POSTS,
        where,
        data: { status: "published" },
      } as never);
      expect((await stored(POSTS, id)).status).toBe("published");
    });

    it("publishes a Single over REST, and refuses the same PATCH naming a field", async () => {
      await boot(dialect);
      await trusted().updateSingle({
        slug: HOME,
        data: { headline: "h", status: "draft" },
      } as never);
      const single = ["singles", HOME];
      const home = async () =>
        (await trusted().findSingle({ slug: HOME } as never)) as {
          headline?: unknown;
          status?: unknown;
        };

      expect(
        await rest(PUBLISHER, "PATCH", single, {
          status: "published",
          headline: "edited",
        })
      ).toBe(403);
      expect(await home()).toMatchObject({ headline: "h", status: "draft" });

      expect(
        await rest(PUBLISHER, "PATCH", single, { status: "published" })
      ).toBe(200);
      expect((await home()).status).toBe("published");
    });

    it("keeps update on a collection with no lifecycle, whose status is a field", async () => {
      await boot(dialect);
      const { item } = await trusted().create({
        collection: NOTES,
        data: { title: "n", status: "open" },
      } as never);
      const id = String((item as { id: unknown }).id);

      expect(
        await rest(PUBLISHER, "PATCH", ["collections", NOTES, "entries", id], {
          status: "published",
        })
      ).toBe(403);
      expect((await stored(NOTES, id)).status).toBe("open");
    });

    it("asks publish of a status-only write even where the status does not move", async () => {
      await boot(dialect);
      const id = await draft(POSTS, "t");
      await trusted().update({
        collection: POSTS,
        id,
        data: { status: "published" },
      } as never);

      // An editor who may update and not publish names only the status the
      // entry already has: a publish, refused, though nothing would move.
      expect(
        await rest(EDITOR, "PATCH", ["collections", POSTS, "entries", id], {
          status: "published",
        })
      ).toBe(403);
      // The control: the same editor's write naming a field is an update.
      expect(
        await rest(EDITOR, "PATCH", ["collections", POSTS, "entries", id], {
          title: "edited",
        })
      ).toBe(200);
    });

    it("refuses a status-only write over REST in the words of the action it asks", async () => {
      const t = await boot(dialect);
      await userWhoMay(t, READER, "read", [POSTS, NOTES, HOME]);
      const id = await draft(POSTS, "t");
      const entry = ["collections", POSTS, "entries", id];

      // Every gate refuses this caller, so each write is refused; the
      // refusal names the action the body asks, not update.
      expect
        .soft(await restRefusal(READER, entry, { status: "published" }))
        .toEqual({ status: 403, message: "You can't publish this posts." });
      expect
        .soft(
          await restRefusal(READER, ["singles", HOME], { status: "published" })
        )
        .toEqual({ status: 403, message: "You can't publish Home." });
      expect
        .soft(
          await restRefusal(READER, ["collections", POSTS, "entries"], {
            where: { id: { equals: id } },
            data: { status: "published" },
          })
        )
        .toEqual({ status: 403, message: "You can't publish posts." });
      expect((await stored(POSTS, id)).status).toBe("draft");

      await trusted().update({
        collection: POSTS,
        id,
        data: { status: "published" },
      } as never);
      expect
        .soft(await restRefusal(READER, entry, { status: "draft" }))
        .toEqual({
          status: 403,
          message: "You can't unpublish this posts.",
        });
      expect((await stored(POSTS, id)).status).toBe("published");

      // A write naming a field is an edit, refused as one.
      expect
        .soft(
          await restRefusal(READER, entry, { status: "draft", title: "edited" })
        )
        .toEqual({ status: 403, message: "You can't edit this posts." });
      // Where a collection has no lifecycle its status is a field, so a write
      // naming only it is an edit too.
      const { item } = await trusted().create({
        collection: NOTES,
        data: { title: "n", status: "open" },
      } as never);
      expect
        .soft(
          await restRefusal(
            READER,
            [
              "collections",
              NOTES,
              "entries",
              String((item as { id: unknown }).id),
            ],
            { status: "published" }
          )
        )
        .toEqual({ status: 403, message: "You can't edit this notes." });
    });
  }
);
