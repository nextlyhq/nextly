/**
 * A REST write to one language is judged in that language at every gate it
 * meets: the route's and the service's. A publish rule answering by language
 * that allows the request's language allows the write; one that refuses it
 * refuses the write, and nothing changes.
 *
 * The rule here allows only French. A status-only PATCH sent in French is a
 * publish judged by that rule alone, and an edit that also publishes asks it
 * at the transition; each goes through in French and is refused in German.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../__tests__/fixtures/permission-holders";
import { defineCollection, defineSingle, text } from "../../config";
import { Nextly } from "../../direct-api/nextly";
import { resetHookRegistry } from "../../hooks/hook-registry";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../plugins/test-nextly";
import { createDynamicHandlers } from "../../routeHandler";
import { buildClaims } from "../jwt/claims";
import { signAccessToken } from "../jwt/sign";
import { resetSessionStandingForTests } from "../session/session-standing";

const POSTS = "frenchonlyposts";
const HOME = "frenchonlyhome";
/** May read, publish and unpublish, and not update. */
const PUBLISHER = "publisher-1";
/** May read, update, publish and unpublish. */
const MAINTAINER = "maintainer-1";

let current: TestNextly | undefined;
/** The language each ask of a publish rule was told, in order. */
let heard: { locale?: string; locales: readonly string[] }[] = [];

afterEach(async () => {
  resetSessionStandingForTests();
  await current?.destroy();
  current = undefined;
  heard = [];
  // Single hooks register into the global registry.
  resetHookRegistry();
});

async function boot(dialect: TestDialect): Promise<void> {
  const frenchOnly = (language: {
    locale?: string;
    locales: readonly string[];
  }) => {
    heard.push({ locale: language.locale, locales: [...language.locales] });
    return language.locale === "fr";
  };
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    localization: { locales: ["en", "fr", "de"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: POSTS,
        localized: true,
        status: true,
        access: { publish: frenchOnly as never },
        fields: [text({ name: "title", localized: true })],
      }),
    ],
    singles: [
      defineSingle({
        slug: HOME,
        localized: true,
        status: true,
        access: { publish: frenchOnly as never },
        fields: [text({ name: "headline", localized: true })],
      }),
    ],
  });
  const both = [POSTS, HOME];
  await userWhoMay(current, PUBLISHER, "read", both);
  for (const action of ["publish", "unpublish"]) {
    await grantTo(current, PUBLISHER, action, both);
  }
  await userWhoMay(current, MAINTAINER, "read", both);
  for (const action of ["update", "publish", "unpublish"]) {
    await grantTo(current, MAINTAINER, action, both);
  }
}

const trusted = () => new Nextly();

/** A draft entry with a translation in each language. */
async function draft(): Promise<string> {
  const { item } = await trusted().create({
    collection: POSTS,
    locale: "en",
    data: { title: "t", status: "draft" },
  } as never);
  const id = String((item as { id: unknown }).id);
  for (const locale of ["fr", "de"]) {
    await trusted().update({
      collection: POSTS,
      id,
      locale,
      data: { title: `t-${locale}`, status: "draft" },
    } as never);
  }
  return id;
}

/** The Single, a draft with a translation in each language. */
async function draftHome(): Promise<void> {
  for (const locale of ["en", "fr", "de"]) {
    await trusted().updateSingle({
      slug: HOME,
      locale,
      data: { headline: `h-${locale}`, status: "draft" },
    } as never);
  }
}

/** A REST PATCH as `userId` in `locale`, answered with its status. */
async function patch(
  userId: string,
  path: string[],
  locale: string,
  body: unknown
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
  const res = await handlers.PATCH!(
    new Request(`http://localhost/api/${path.join("/")}?locale=${locale}`, {
      method: "PATCH",
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
  "a REST write's rule hears the request's language (%s)",
  dialect => {
    it("publishes an entry in French for a caller who may only publish, and refuses German", async () => {
      await boot(dialect);
      const id = await draft();
      const entry = ["collections", POSTS, "entries", id];

      expect(await patch(PUBLISHER, entry, "de", { status: "published" })).toBe(
        403
      );
      heard = [];

      expect(await patch(PUBLISHER, entry, "fr", { status: "published" })).toBe(
        200
      );
      // Every ask, at the route and in the service, heard French alone.
      expect(heard.length).toBeGreaterThan(0);
      expect(heard).toEqual(
        heard.map(() => ({ locale: "fr", locales: ["fr"] }))
      );
    });

    it("publishes an edit of an entry in French, and refuses it in German", async () => {
      await boot(dialect);
      const id = await draft();
      const entry = ["collections", POSTS, "entries", id];

      expect(
        await patch(MAINTAINER, entry, "de", {
          title: "edited",
          status: "published",
        })
      ).toBe(403);
      heard = [];

      expect(
        await patch(MAINTAINER, entry, "fr", {
          title: "edited",
          status: "published",
        })
      ).toBe(200);
      // Every ask, at the route and in the service, heard French alone.
      expect(heard.length).toBeGreaterThan(0);
      expect(heard).toEqual(
        heard.map(() => ({ locale: "fr", locales: ["fr"] }))
      );
    });

    it("publishes a Single in French for a caller who may only publish, and refuses German", async () => {
      await boot(dialect);
      await draftHome();
      const single = ["singles", HOME];

      expect(
        await patch(PUBLISHER, single, "de", { status: "published" })
      ).toBe(403);
      heard = [];

      expect(
        await patch(PUBLISHER, single, "fr", { status: "published" })
      ).toBe(200);
      // Every ask, at the route and in the service, heard French alone.
      expect(heard.length).toBeGreaterThan(0);
      expect(heard).toEqual(
        heard.map(() => ({ locale: "fr", locales: ["fr"] }))
      );
    });

    it("publishes an edit of a Single in French, and refuses it in German", async () => {
      await boot(dialect);
      await draftHome();
      const single = ["singles", HOME];

      expect(
        await patch(MAINTAINER, single, "de", {
          headline: "edited",
          status: "published",
        })
      ).toBe(403);
      heard = [];

      expect(
        await patch(MAINTAINER, single, "fr", {
          headline: "edited",
          status: "published",
        })
      ).toBe(200);
      // Every ask, at the route and in the service, heard French alone.
      expect(heard.length).toBeGreaterThan(0);
      expect(heard).toEqual(
        heard.map(() => ({ locale: "fr", locales: ["fr"] }))
      );
    });
  }
);
