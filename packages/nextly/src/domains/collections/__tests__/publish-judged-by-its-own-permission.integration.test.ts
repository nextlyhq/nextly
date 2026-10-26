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
import { resetHookRegistry } from "../../../hooks/hook-registry";
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
import type { CollectionsHandler } from "../../../services/collections-handler";

type PluginServices = PluginContext["services"];

const POSTS = "posts";
/** No draft/published lifecycle; its `status` is an ordinary field. */
const NOTES = "notes";
const HOME = "home";
/** Its update rule answers a filter. */
const FILTERED = "filtered";
/** May read, publish and unpublish, and not update. */
const PUBLISHER = "publisher-1";
/** May read and update posts and notes, and not publish. */
const EDITOR = "editor-1";

/** A system column's value no hook should be handed from a status-only body. */
const SENT_SYSTEM_VALUE = "1999-01-01T00:00:00.000Z";

let current: TestNextly | undefined;
let services: PluginServices | undefined;
/** The data each update's hooks were handed, in order. */
let handedToHooks: unknown[] = [];

afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
  services = undefined;
  handedToHooks = [];
  // Single hooks register into the global registry.
  resetHookRegistry();
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
        hooks: {
          beforeOperation: [
            ({ operation, args }) => {
              if (operation === "update") {
                handedToHooks.push((args as { data?: unknown }).data);
              }
              return args;
            },
          ],
        },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: NOTES,
        fields: [text({ name: "title" }), text({ name: "status" })],
      }),
      defineCollection({
        slug: FILTERED,
        status: true,
        // An update rule answering a filter, which no write applies: an edit
        // is refused, whoever asks.
        access: {
          update: (() => ({ title: { equals: "never" } })) as never,
        },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: HOME,
        status: true,
        hooks: {
          beforeChange: [
            context => {
              handedToHooks.push(context.data);
              return context.data;
            },
          ],
        },
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
  await userWhoMay(current, EDITOR, "read", [POSTS, NOTES]);
  await grantTo(current, EDITOR, "update", [POSTS, NOTES]);
  await userWhoMay(current, MAINTAINER, "read", [FILTERED]);
  for (const action of ["update", "publish"]) {
    await grantTo(current, MAINTAINER, action, [FILTERED]);
  }
  return current;
}

/** Localized, with a publish rule refusing anything that involves French. */
const FRENCH_INVOLVED = "frenchinvolved";
const FRENCH_INVOLVED_HOME = "frenchinvolvedhome";
/** May read, update, publish and unpublish. */
const MAINTAINER = "maintainer-1";

/**
 * A site in three languages whose publish rule refuses any publish told it
 * involves French, so a publish of every language with no French going live
 * is allowed and one with French is refused.
 */
async function bootLocalized(dialect: TestDialect): Promise<TestNextly> {
  const frenchRefused = ({ locales }: { locales: readonly string[] }) =>
    !locales.includes("fr");
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    localization: { locales: ["en", "fr", "de"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: FRENCH_INVOLVED,
        localized: true,
        status: true,
        access: { publish: frenchRefused },
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: FRENCH_INVOLVED_HOME,
        localized: true,
        status: true,
        access: { publish: frenchRefused },
        fields: [text({ name: "headline" })],
      }),
    ],
  });
  const both = [FRENCH_INVOLVED, FRENCH_INVOLVED_HOME];
  await userWhoMay(current, PUBLISHER, "read", both);
  await grantTo(current, PUBLISHER, "publish", both);
  await userWhoMay(current, MAINTAINER, "read", both);
  for (const action of ["update", "publish", "unpublish"]) {
    await grantTo(current, MAINTAINER, action, both);
  }
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

/** A REST write as `userId`, answered with its status. */
async function rest(
  userId: string,
  method: "PATCH" | "POST",
  path: string[],
  body: unknown,
  query = ""
): Promise<number> {
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
    new Request(`http://localhost/api/${path.join("/")}${query}`, {
      method,
      headers: {
        cookie: `nextly_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return res.status;
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

    it("asks publish of a status-only row in a batch, for a caller who may update", async () => {
      await boot(dialect);
      const live = await draft(POSTS, "live");
      await trusted().update({
        collection: POSTS,
        id: live,
        data: { status: "published" },
      } as never);
      const other = await draft(POSTS, "other");

      // The editor may update and not publish. A row naming only the status
      // the entry already has is a publish, refused though nothing would
      // move; a row naming a field is an update, allowed.
      const result = await pluginServices().collections.updateMany(
        POSTS,
        [
          { id: live, data: { status: "published" } },
          { id: other, data: { title: "edited" } },
        ],
        asPlugin(EDITOR)
      );

      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect((await stored(POSTS, other)).title).toBe("edited");
    });

    it("hands an entry's hooks a status-only write as the status alone", async () => {
      await boot(dialect);
      const id = await draft(POSTS, "t");
      handedToHooks = [];

      // System columns are never stored from a body, so naming them leaves
      // the write a publish; nor is any hook handed what a caller judged
      // without update sent for them.
      await as(PUBLISHER).update({
        collection: POSTS,
        id,
        data: { status: "published", id, createdAt: SENT_SYSTEM_VALUE },
      } as never);

      expect((await stored(POSTS, id)).status).toBe("published");
      expect(handedToHooks).toEqual([{ status: "published" }]);
    });

    it("hands a Single's hooks a status-only write as the status alone", async () => {
      await boot(dialect);
      await trusted().updateSingle({
        slug: HOME,
        data: { headline: "h", status: "draft" },
      } as never);
      handedToHooks = [];

      expect(
        await rest(PUBLISHER, "PATCH", ["singles", HOME], {
          status: "published",
          updatedAt: SENT_SYSTEM_VALUE,
        })
      ).toBe(200);

      expect(handedToHooks.length).toBeGreaterThan(0);
      for (const data of handedToHooks) {
        expect(JSON.stringify(data)).not.toContain(SENT_SYSTEM_VALUE);
      }
    });

    it("judges a publish that also names a field by update's rule too, its filter included", async () => {
      await boot(dialect);
      const id = await draft(FILTERED, "t");

      // The caller may update and publish. The write names a field, so it is
      // an edit, judged by the update rule, whose filter no write applies.
      await expect(
        as(MAINTAINER).update({
          collection: FILTERED,
          id,
          data: { status: "published", title: "edited" },
        } as never)
      ).rejects.toThrow();
      expect(await stored(FILTERED, id)).toMatchObject({
        title: "t",
        status: "draft",
      });

      // The control: the status alone is a publish, judged by its own rule.
      await as(MAINTAINER).update({
        collection: FILTERED,
        id,
        data: { status: "published" },
      } as never);
      expect((await stored(FILTERED, id)).status).toBe("published");
    });

    it("admits a publish of every language over REST on the grant, asking the rule in each language", async () => {
      await bootLocalized(dialect);
      // English and German drafts, and no French: French does not go live.
      const entryIn = async (title: string) => {
        const id = await draft(FRENCH_INVOLVED, title);
        await trusted().update({
          collection: FRENCH_INVOLVED,
          id,
          locale: "de",
          data: { title: "de" },
        } as never);
        return id;
      };
      const viaRoute = await entryIn("route");
      const viaPatch = await entryIn("patch");
      for (const locale of ["en", "de"]) {
        await trusted().updateSingle({
          slug: FRENCH_INVOLVED_HOME,
          locale,
          data: { headline: locale },
        } as never);
      }
      const entry = (id: string) => [
        "collections",
        FRENCH_INVOLVED,
        "entries",
        id,
      ];

      // Publishing every language, as a caller who may also update.
      expect(
        await rest(MAINTAINER, "POST", [...entry(viaRoute), "publish-all"], {})
      ).toBe(200);
      expect((await stored(FRENCH_INVOLVED, viaRoute)).status).toBe(
        "published"
      );
      expect(
        await rest(
          MAINTAINER,
          "POST",
          ["singles", FRENCH_INVOLVED_HOME, "publish-all"],
          {}
        )
      ).toBe(200);
      // A status-only write to every language, as a caller who may only
      // publish.
      expect(
        await rest(
          PUBLISHER,
          "PATCH",
          entry(viaPatch),
          { status: "published" },
          "?locale=*"
        )
      ).toBe(200);
      expect((await stored(FRENCH_INVOLVED, viaPatch)).status).toBe(
        "published"
      );

      // The control: with a French draft, French goes live and the service
      // refuses it.
      await trusted().update({
        collection: FRENCH_INVOLVED,
        id: viaRoute,
        locale: "fr",
        data: { title: "fr" },
      } as never);
      expect(
        await rest(MAINTAINER, "POST", [...entry(viaRoute), "publish-all"], {})
      ).toBe(403);
    });

    it("admits publishing every language of a collection with no lifecycle over REST on update", async () => {
      await boot(dialect);
      const { item } = await trusted().create({
        collection: NOTES,
        data: { title: "n", status: "open" },
      } as never);
      const id = String((item as { id: unknown }).id);

      // Nothing to publish, which a caller who may update is told, as before.
      expect(
        await rest(
          EDITOR,
          "POST",
          ["collections", NOTES, "entries", id, "publish-all"],
          {}
        )
      ).toBe(200);
      expect((await stored(NOTES, id)).status).toBe("open");
    });

    it("tells only a caller who may update that a collection with no lifecycle has nothing to publish", async () => {
      await boot(dialect);
      const { item } = await trusted().create({
        collection: NOTES,
        data: { title: "n", status: "open" },
      } as never);
      const id = String((item as { id: unknown }).id);
      const publishAll = (userId: string) =>
        (
          current!.getService("collectionsHandler") as CollectionsHandler
        ).publishAllLocales({
          collectionName: NOTES,
          entryId: id,
          overrideAccess: false,
          user: { id: userId } as never,
        });

      // A caller who may not update learns nothing, the publisher included.
      expect((await publishAll(PUBLISHER)).success).toBe(false);
      // The control: one who may update is told nothing moves.
      expect((await publishAll(EDITOR)).success).toBe(true);
      expect((await stored(NOTES, id)).status).toBe("open");
    });
  }
);
