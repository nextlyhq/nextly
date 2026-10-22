/**
 * A preview link opens the preview render and nothing else.
 *
 * The render judges a request that carries a valid link as the person who
 * shared it. Every other way in ignores the link: a REST request and a Direct
 * API call carrying the same valid link are judged as their sender, as they
 * would be without it. Each case first shows the link is one the render
 * honours, so a refusal elsewhere cannot pass for a link that was never valid.
 */

// Set before the harness boots (env validation reads it once), and used for
// the link and the session alike, so REST could verify either if it read them.
const SECRET = "preview-link-ignored-elsewhere-secret-32-chars!";
process.env.NEXTLY_SECRET = SECRET;

import { afterEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { signPreviewToken } from "../../../auth/preview/preview-token";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { createContentRoute } from "../../routing/content-route";
import type { ContentEntry } from "../../routing/resolve-content";
import { previewDraftGate } from "../preview-draft-gate";
import { PREVIEW_SCOPE_COOKIE } from "../preview-route";

const GENERATION = 1;
const ORIGIN = "http://localhost";
const SESSION_COOKIE = "nextly_session";

/** Whom the read rule refuses, by user id, set by a case. */
const refused = { read: "" };

const pages = () =>
  defineCollection({
    slug: "pages",
    status: true,
    versions: { drafts: true },
    access: {
      // A visitor is refused, and so is the person a case names.
      read: ({ user }: { user?: { id?: string } | null }) =>
        !!user && user.id !== refused.read,
      update: ({ user }: { user?: { id?: string } | null }) =>
        !!user && user.id !== refused.read,
    },
    fields: [text({ name: "slug" }), text({ name: "title" })],
  });

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  refused.read = "";
});

interface Install {
  t: TestNextly;
  /** Shares the link, and may read and edit the draft. */
  sharer: string;
  /** Opens the link signed in, and is refused by the read rule. */
  opener: string;
  entryId: string;
  link: string;
}

async function account(t: TestNextly, email: string): Promise<string> {
  const created = await t.nextly.users.create({
    email,
    password: "PreviewTest123!",
    data: { name: email, isActive: true },
  });
  return String(created.item.id);
}

async function install(dialect: TestDialect): Promise<Install> {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    collections: [pages()],
  });
  const sharer = await account(current, "sharer@example.com");
  const opener = await account(current, "opener@example.com");
  const created = await current.nextly.create({
    collection: "pages",
    data: { slug: "unreleased", title: "Unreleased", status: "draft" },
  });
  const entryId = String(created.item.id);
  const { token } = await signPreviewToken(
    { collection: "pages", entryId },
    SECRET,
    { generation: GENERATION, minter: sharer }
  );
  return { t: current, sharer, opener, entryId, link: token };
}

async function sessionOf(userId: string): Promise<string> {
  return signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.com`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    SECRET
  );
}

/** The cookie header a browser carrying a link and a session would send. */
function cookieHeader(jar: { link?: string; session?: string }): string {
  return [
    jar.link === undefined
      ? undefined
      : `${PREVIEW_SCOPE_COOKIE}=${encodeURIComponent(jar.link)}`,
    jar.session === undefined ? undefined : `${SESSION_COOKIE}=${jar.session}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join("; ");
}

/** The preview render, served the request's cookies. */
function render(
  t: TestNextly,
  jar: { link?: string; session?: string }
): Promise<ContentEntry> {
  return createContentRoute({
    collections: ["pages"],
    nextly: t.nextly,
    render: (entry: ContentEntry) => entry,
    draft: previewDraftGate({
      secret: SECRET,
      generation: GENERATION,
      cookies: () => ({
        get: (name: string) =>
          name === PREVIEW_SCOPE_COOKIE && jar.link !== undefined
            ? { value: encodeURIComponent(jar.link) }
            : name === SESSION_COOKIE && jar.session !== undefined
              ? { value: jar.session }
              : undefined,
      }),
    }),
  }).ContentPage({ params: { slug: ["unreleased"] } }) as Promise<ContentEntry>;
}

/** A REST read of the entry, unpublished included, with these cookies. */
async function restRead(
  entryId: string,
  jar: { link?: string; session?: string }
): Promise<number> {
  const segments = ["collections", "pages", "entries", entryId];
  const cookie = cookieHeader(jar);
  const response = await createDynamicHandlers().GET(
    new Request(`${ORIGIN}/api/${segments.join("/")}?status=all`, {
      headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) },
    }),
    { params: Promise.resolve({ params: segments }) }
  );
  return response.status;
}

/** Whether a checked Direct API read of the entry, with these cookies, succeeds. */
async function directRead(
  t: TestNextly,
  entryId: string,
  jar: { link?: string },
  user?: string
): Promise<boolean> {
  const cookie = cookieHeader(jar);
  try {
    await t.nextly.findByID({
      collection: "pages",
      id: entryId,
      overrideAccess: false,
      status: "all",
      ...(user === undefined ? {} : { user: { id: user } }),
      request: new Request(`${ORIGIN}/preview`, {
        headers: cookie ? { cookie } : {},
      }),
    });
    return true;
  } catch {
    return false;
  }
}

describe.each(getConfiguredTestDialects())(
  "a preview link is honoured by the preview render only (%s)",
  dialect => {
    it("is honoured by the render: the control", async () => {
      const { t, link } = await install(dialect);
      const shown = await render(t, { link });
      expect(JSON.stringify(shown)).toContain("Unreleased");
    });

    it("gives a REST request no more than its sender has, signed out", async () => {
      const { entryId, link } = await install(dialect);
      const without = await restRead(entryId, {});
      expect(without).toBeGreaterThanOrEqual(400);
      expect(await restRead(entryId, { link })).toBe(without);
    });

    it("judges a signed-in REST request as its sender, not as the sharer", async () => {
      const { entryId, link, opener, sharer } = await install(dialect);
      refused.read = opener;
      const opened = await sessionOf(opener);
      const without = await restRead(entryId, { session: opened });
      expect(without).toBeGreaterThanOrEqual(400);
      expect(await restRead(entryId, { link, session: opened })).toBe(without);

      // The control: the sharer's own session may read it.
      expect(
        await restRead(entryId, { session: await sessionOf(sharer) })
      ).toBe(200);
    });

    it("gives a Direct API call no more than its caller has", async () => {
      const { t, entryId, link, opener, sharer } = await install(dialect);
      refused.read = opener;
      expect(await directRead(t, entryId, {})).toBe(false);
      expect(await directRead(t, entryId, { link })).toBe(false);
      expect(await directRead(t, entryId, {}, opener)).toBe(false);
      expect(await directRead(t, entryId, { link }, opener)).toBe(false);

      // The control: the sharer, named, may read it.
      expect(await directRead(t, entryId, {}, sharer)).toBe(true);
    });
  }
);
