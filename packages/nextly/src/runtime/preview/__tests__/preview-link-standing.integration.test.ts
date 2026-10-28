/**
 * What a valid preview link shows, judged as its sharer on every open.
 *
 * A link is the one way a visitor sees a draft, and it shows that draft as the
 * person who shared it: never more than they may see now, and never anything
 * of the person opening it. Each case pairs the link's answer with a control,
 * so a refusal for an unrelated reason cannot pass for the rule working:
 *
 * - a document whose rule refuses visitors, and whose Public role holds no
 *   read, is shown with the link and refused without it, for an entry and for
 *   a Single;
 * - a sharer who loses read, or whom the document's rule starts refusing,
 *   after the link was made: the next open is refused;
 * - a field taken out of the sharer's access after the link was made is left
 *   out of the next render;
 * - a signed-in opener with wider access than the sharer sees only the
 *   sharer's redacted draft;
 * - a sharer deactivated after the link was made: the next open is refused;
 * - a link made before links were recorded is judged the same way after the
 *   upgrade;
 * - a related row and an upload the sharer may not read stay withheld, though
 *   the opener and a visitor may read them.
 */
import { afterEach, describe, expect, it } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import {
  documentRevocationMark,
  recordPreviewLink,
} from "../../../auth/preview/preview-link-records";
import {
  signPreviewToken,
  verifyPreviewToken,
} from "../../../auth/preview/preview-token";
import {
  defineCollection,
  defineSingle,
  relationship,
  text,
  upload,
} from "../../../config";
import { getDialectTables } from "../../../database/index";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createContentRoute } from "../../routing/content-route";
import type { ContentEntry } from "../../routing/resolve-content";
import { createSingleRoute } from "../../routing/single-route";
import { previewDraftGate } from "../preview-draft-gate";
import { PREVIEW_SCOPE_COOKIE } from "../preview-route";
import { previewSingleDraftGate } from "../preview-single-draft-gate";

const SECRET = "preview-link-standing-secret-32-characters!";
const GENERATION = 1;
const SESSION_COOKIE = "nextly_session";

/** Whom the rules refuse, by user id, changed by a case after the link exists. */
const refused = { read: "", field: "", target: "" };

const AUTHOR_NAME = "Ada Author";
const COVER_FILE = "cover-art.png";

const access = {
  // A visitor (no user) is refused, and so is a sharer a case has withdrawn.
  read: ({ user }: { user?: { id?: string } | null }) =>
    !!user && user.id !== refused.read,
  update: ({ user }: { user?: { id?: string } | null }) => !!user,
};

/** Readable by everyone a case has not withdrawn it from. */
const guarded = () =>
  text({
    name: "notes",
    access: {
      read: ({ req }) =>
        !!req.user && (req.user as { id?: string }).id !== refused.field,
    },
  });

/**
 * Related rows a visitor may read, as may the administrator, and the sharer
 * only until a case refuses them.
 */
const authors = () =>
  defineCollection({
    slug: "authors",
    access: {
      read: ({ user }: { user?: { id?: string } | null }) =>
        user?.id === undefined || user.id !== refused.target,
    },
    fields: [text({ name: "name" })],
  });

const pages = () =>
  defineCollection({
    slug: "pages",
    status: true,
    versions: { drafts: true },
    access,
    fields: [
      text({ name: "slug" }),
      text({ name: "title" }),
      guarded(),
      relationship({ name: "author", relationTo: "authors" }),
      // Media a visitor may read, and a person only with `read-media`, which
      // the sharer does not hold.
      upload({ name: "cover", relationTo: "media" }),
    ],
  });

const settings = () =>
  defineSingle({
    slug: "site-settings",
    status: true,
    versions: { drafts: true },
    access,
    fields: [
      text({ name: "siteName" }),
      guarded(),
      relationship({ name: "owner", relationTo: "authors" }),
      upload({ name: "logo", relationTo: "media" }),
    ],
  });

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  refused.read = "";
  refused.field = "";
  refused.target = "";
});

interface Install {
  t: TestNextly;
  /** The administrator, whom no rule binds: the opener with wider access. */
  founder: string;
  /** A person the rules admit, who shares the links. */
  sharer: string;
}

async function boot(dialect: TestDialect): Promise<Install> {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    collections: [authors(), pages()],
    singles: [settings()],
  });
  // The install's first account is its administrator. Made first so that the
  // sharer is not.
  const founder = await account(current, "founder@example.com");
  const sharer = await account(current, "sharer@example.com");
  // A preview link is judged as its sharer for read and update, and a rule
  // only narrows a permission, so the sharer holds both on the page and the
  // Single, and read on the authors whose rule withholds them below.
  await grantTo(current, sharer, "read", ["pages", "site-settings", "authors"]);
  await grantTo(current, sharer, "update", ["pages", "site-settings"]);
  return { t: current, founder, sharer };
}

/** An active account, so a link it shares resolves to a live identity. */
async function account(t: TestNextly, email: string): Promise<string> {
  const created = await t.nextly.users.create({
    email,
    password: "PreviewTest123!",
    data: { name: email, isActive: true },
  });
  return String(created.item.id);
}

/** A never-published entry, with a guarded field. */
async function draftEntry(t: TestNextly): Promise<string> {
  const created = await t.nextly.create({
    collection: "pages",
    data: {
      slug: "unreleased",
      title: "Unreleased",
      notes: "pricing-draft",
      status: "draft",
    },
  });
  return String(created.item.id);
}

/** An author and a media row: the targets a draft below points at. */
async function targets(t: TestNextly): Promise<{ authorId: string }> {
  const author = await t.nextly.create({
    collection: "authors",
    data: { name: AUTHOR_NAME },
  });
  const tables = getDialectTables();
  await (
    t.adapter.getDrizzle() as unknown as {
      insert: (table: unknown) => {
        values: (row: unknown) => Promise<unknown>;
      };
    }
  )
    .insert(tables.media)
    .values({
      id: "cover-1",
      filename: COVER_FILE,
      originalFilename: COVER_FILE,
      mimeType: "image/png",
      size: 1,
      url: `/uploads/${COVER_FILE}`,
      uploadedAt: new Date(),
      updatedAt: new Date(),
    });
  return { authorId: String(author.item.id) };
}

/** A never-published entry naming an author and a cover image. */
async function draftEntryWithTargets(t: TestNextly): Promise<string> {
  const { authorId } = await targets(t);
  const created = await t.nextly.create({
    collection: "pages",
    data: {
      slug: "unreleased",
      title: "Unreleased",
      author: authorId,
      cover: "cover-1",
      status: "draft",
    },
  });
  return String(created.item.id);
}

/** The Single's draft naming an owner and a logo, over a published "Acme". */
async function draftSingleWithTargets(t: TestNextly): Promise<void> {
  const { authorId } = await targets(t);
  await t.nextly.updateSingle({
    slug: "site-settings",
    data: { siteName: "Acme", status: "published" },
  });
  await t.nextly.updateSingle({
    slug: "site-settings",
    data: { siteName: "Acme (pending)", owner: authorId, logo: "cover-1" },
  });
}

/** Whether a rendered value carries `text` anywhere, expanded or not. */
const shows = (value: unknown, text: string): boolean =>
  JSON.stringify(value ?? null).includes(text);

/** A Single published as "Acme", with "Acme (pending)" as its working draft. */
async function draftSingle(t: TestNextly): Promise<void> {
  await t.nextly.updateSingle({
    slug: "site-settings",
    data: { siteName: "Acme", notes: "launch-plan", status: "published" },
  });
  await t.nextly.updateSingle({
    slug: "site-settings",
    data: { siteName: "Acme (pending)" },
  });
}

async function entryLink(minter: string, entryId: string): Promise<string> {
  const { token } = await signPreviewToken(
    { collection: "pages", entryId },
    SECRET,
    { generation: GENERATION, minter }
  );
  return token;
}

async function singleLink(minter: string): Promise<string> {
  const { token } = await signPreviewToken(
    { kind: "single", single: "site-settings" },
    SECRET,
    { generation: GENERATION, minter }
  );
  return token;
}

/** The request's cookies: a preview link, a signed-in session, both or none. */
function cookies(jar: { link?: string; session?: string }) {
  return async () => ({
    get: (name: string) => {
      if (name === PREVIEW_SCOPE_COOKIE && jar.link !== undefined) {
        return { value: encodeURIComponent(jar.link) };
      }
      if (name === SESSION_COOKIE && jar.session !== undefined) {
        return { value: jar.session };
      }
      return undefined;
    },
  });
}

/**
 * The upgrade, as an install sees it: links begin to be recorded, with the
 * first recorded link of the entry.
 */
async function recordingBegins(
  t: TestNextly,
  minter: string,
  entryId: string
): Promise<void> {
  const generation = await (
    t.getService("generalSettingsService") as unknown as {
      getPreviewTokenGeneration: () => Promise<number>;
    }
  ).getPreviewTokenGeneration();
  const scope = { collection: "pages", entryId };
  const revocationMark = await documentRevocationMark({
    kind: "entry",
    ...scope,
  });
  const signed = await signPreviewToken(scope, SECRET, {
    generation,
    minter,
    recorded: true,
  });
  await recordPreviewLink({
    id: signed.linkId,
    scope,
    createdBy: minter,
    createdAt: signed.issuedAt,
    expiresAt: signed.expiresAt,
    generation,
    revocationMark,
  });
}

/** A valid admin session for `userId`, as the browser would carry it. */
async function sessionOf(userId: string): Promise<string> {
  return signAccessToken(
    buildClaims({
      userId,
      email: "founder@example.com",
      name: "Founder",
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    SECRET
  );
}

/** The entry page a request with these cookies is served. */
function openEntry(
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
      cookies: cookies(jar),
    }),
  }).ContentPage({ params: { slug: ["unreleased"] } }) as Promise<ContentEntry>;
}

/** The Single page a request with these cookies is served. */
function openSingle(
  t: TestNextly,
  jar: { link?: string; session?: string }
): Promise<Record<string, unknown>> {
  return createSingleRoute({
    slug: "site-settings",
    nextly: t.nextly,
    render: (document: Record<string, unknown>) => document,
    draft: previewSingleDraftGate({
      secret: SECRET,
      generation: GENERATION,
      cookies: cookies(jar),
    }),
  }).SinglePage() as Promise<Record<string, unknown>>;
}

/**
 * Refused as NOT FOUND, rather than by any failure on the way. Next signals
 * the not-found boundary with a string-tagged error, so the tag is matched.
 */
async function expectNotFound(page: Promise<unknown>): Promise<void> {
  await expect(page).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
}

describe.each(getConfiguredTestDialects())(
  "a preview link is judged as its sharer on every open (%s)",
  dialect => {
    describe("a document whose rule refuses visitors", () => {
      it("shows an entry's draft with the link, and refuses it without", async () => {
        const { t, sharer } = await boot(dialect);
        const id = await draftEntry(t);

        const page = await openEntry(t, { link: await entryLink(sharer, id) });
        expect(page.title).toBe("Unreleased");

        await expectNotFound(openEntry(t, {}));
      });

      it("shows a Single's draft with the link, and refuses it without", async () => {
        const { t, sharer } = await boot(dialect);
        await draftSingle(t);

        const page = await openSingle(t, { link: await singleLink(sharer) });
        expect(page.siteName).toBe("Acme (pending)");

        await expectNotFound(openSingle(t, {}));
      });
    });

    describe("a sharer the document's rule starts refusing after the link was made", () => {
      it("refuses the entry on the next open", async () => {
        const { t, sharer } = await boot(dialect);
        const id = await draftEntry(t);
        const link = await entryLink(sharer, id);
        // The control: the link opens while the sharer may read.
        expect((await openEntry(t, { link })).title).toBe("Unreleased");

        refused.read = sharer;

        await expectNotFound(openEntry(t, { link }));
      });

      it("refuses the Single's draft on the next open", async () => {
        const { t, sharer } = await boot(dialect);
        await draftSingle(t);
        const link = await singleLink(sharer);
        expect((await openSingle(t, { link })).siteName).toBe("Acme (pending)");

        refused.read = sharer;

        // Not the draft, and not the published document either: a visitor
        // without a standing link is refused by the rule.
        await expectNotFound(openSingle(t, { link }));
      });
    });

    describe("a field taken out of the sharer's access after the link was made", () => {
      it("is left out of the entry's next render", async () => {
        const { t, sharer } = await boot(dialect);
        const id = await draftEntry(t);
        const link = await entryLink(sharer, id);
        expect((await openEntry(t, { link })).notes).toBe("pricing-draft");

        refused.field = sharer;

        const page = await openEntry(t, { link });
        expect(page.notes).toBeUndefined();
        // Field-scoped: the rest of the draft still renders.
        expect(page.title).toBe("Unreleased");
      });

      it("is left out of the Single's next render", async () => {
        const { t, sharer } = await boot(dialect);
        await draftSingle(t);
        const link = await singleLink(sharer);
        expect((await openSingle(t, { link })).notes).toBe("launch-plan");

        refused.field = sharer;

        const page = await openSingle(t, { link });
        expect(page.notes).toBeUndefined();
        expect(page.siteName).toBe("Acme (pending)");
      });
    });

    describe("an opener signed in with wider access than the sharer", () => {
      it("sees only the sharer's redacted entry draft", async () => {
        const { t, founder, sharer } = await boot(dialect);
        const id = await draftEntry(t);
        refused.field = sharer;
        const link = await entryLink(sharer, id);

        const page = await openEntry(t, {
          link,
          session: await sessionOf(founder),
        });

        expect(page.title).toBe("Unreleased");
        expect(page.notes).toBeUndefined();
        // The control: the same opener's own link shows the field, so the
        // redaction above is the sharer's, not a blanket one.
        const own = await openEntry(t, {
          link: await entryLink(founder, id),
          session: await sessionOf(founder),
        });
        expect(own.notes).toBe("pricing-draft");
      });

      it("sees only the sharer's redacted Single draft", async () => {
        const { t, founder, sharer } = await boot(dialect);
        await draftSingle(t);
        refused.field = sharer;

        const page = await openSingle(t, {
          link: await singleLink(sharer),
          session: await sessionOf(founder),
        });

        expect(page.siteName).toBe("Acme (pending)");
        expect(page.notes).toBeUndefined();
        const own = await openSingle(t, {
          link: await singleLink(founder),
          session: await sessionOf(founder),
        });
        expect(own.notes).toBe("launch-plan");
      });
    });

    describe("a sharer deactivated after the link was made", () => {
      it("is refused the entry on the next open", async () => {
        const { t, sharer } = await boot(dialect);
        const id = await draftEntry(t);
        const link = await entryLink(sharer, id);
        expect((await openEntry(t, { link })).title).toBe("Unreleased");

        await t.nextly.users.update({ id: sharer, data: { isActive: false } });

        await expectNotFound(openEntry(t, { link }));
      });

      it("is refused the Single's draft on the next open", async () => {
        const { t, sharer } = await boot(dialect);
        await draftSingle(t);
        const link = await singleLink(sharer);
        expect((await openSingle(t, { link })).siteName).toBe("Acme (pending)");

        await t.nextly.users.update({ id: sharer, data: { isActive: false } });

        await expectNotFound(openSingle(t, { link }));
      });
    });

    describe("a link made before links were recorded", () => {
      it.each(["deactivated", "refused the entry"] as const)(
        "is refused on the next open once its maker is %s after the upgrade",
        async change => {
          const { t, sharer } = await boot(dialect);
          const id = await draftEntry(t);
          // Made first, and recorded nowhere: it names no row.
          const older = await entryLink(sharer, id);
          const verified = await verifyPreviewToken(older, SECRET, {
            generation: GENERATION,
          });
          expect(verified.valid && verified.linkId).toBeUndefined();
          await recordingBegins(t, sharer, id);
          // The control: after the upgrade it still opens as it did.
          expect((await openEntry(t, { link: older })).title).toBe(
            "Unreleased"
          );

          if (change === "deactivated") {
            await t.nextly.users.update({
              id: sharer,
              data: { isActive: false },
            });
          } else {
            refused.read = sharer;
          }

          await expectNotFound(openEntry(t, { link: older }));
        }
      );
    });

    describe("related rows and uploads the sharer may not read", () => {
      it("stay withheld, though the opener and a visitor may read them", async () => {
        const { t, founder, sharer } = await boot(dialect);
        const id = await draftEntryWithTargets(t);
        refused.target = sharer;
        const session = await sessionOf(founder);

        const page = await openEntry(t, {
          link: await entryLink(sharer, id),
          session,
        });

        // The draft itself renders, so the absences below are the targets'.
        expect(page.title).toBe("Unreleased");
        expect(shows(page.author, AUTHOR_NAME)).toBe(false);
        expect(shows(page.cover, COVER_FILE)).toBe(false);

        // The control: the same draft through the opener's own link expands
        // both, so the route does populate them at this depth.
        const own = await openEntry(t, {
          link: await entryLink(founder, id),
          session,
        });
        expect(shows(own.author, AUTHOR_NAME)).toBe(true);
        expect(shows(own.cover, COVER_FILE)).toBe(true);

        // And a visitor may read both targets directly.
        const visitorAuthor = await t.nextly.find({
          collection: "authors",
          overrideAccess: false,
        });
        expect(shows(visitorAuthor.items, AUTHOR_NAME)).toBe(true);
      });

      it("stay withheld from a Single's draft too", async () => {
        const { t, founder, sharer } = await boot(dialect);
        await draftSingleWithTargets(t);
        refused.target = sharer;
        const session = await sessionOf(founder);

        const page = await openSingle(t, {
          link: await singleLink(sharer),
          session,
        });

        expect(page.siteName).toBe("Acme (pending)");
        expect(shows(page.owner, AUTHOR_NAME)).toBe(false);
        expect(shows(page.logo, COVER_FILE)).toBe(false);

        const own = await openSingle(t, {
          link: await singleLink(founder),
          session,
        });
        expect(shows(own.owner, AUTHOR_NAME)).toBe(true);
        expect(shows(own.logo, COVER_FILE)).toBe(true);
      });
    });
  }
);
