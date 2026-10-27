/**
 * A Single's preview is granted only while its sharer may still read AND
 * update the Single, judged afresh on every render.
 *
 * The link renders the working draft as the person who shared it. Losing
 * update access already closed the link; losing read access through a custom
 * rule has to close it the same way, since the draft is a view of the
 * document the sharer is no longer allowed to see. The fixture's rules refuse
 * one sharer read and another update, and admit a third, on one document with
 * a published value and a pending draft, so a granted render and a refused
 * one come back different.
 *
 * The read is judged without reading the Single the ordinary way, because
 * that way creates a Single that has no row yet and runs its read hooks, and
 * a render is an anonymous page view. The last case renders a Single that was
 * never created and checks that nothing was written and no hook ran.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import { signPreviewToken } from "../../../auth/preview/preview-token";
import { defineSingle, text } from "../../../config";
import { singleStoredDocumentReadable } from "../../../domains/singles/services/single-document-access";
import type { HookContext } from "../../../hooks/types";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createSingleRoute } from "../../routing/single-route";
import { PREVIEW_SCOPE_COOKIE } from "../preview-route";
import { previewSingleDraftGate } from "../preview-single-draft-gate";

const SECRET = "single-preview-sharer-read-secret-32chars!";
const GENERATION = 1;

/** Who the Single's rules refuse, set once the accounts exist. */
const refused = { read: "", update: "" };

const settings = () =>
  defineSingle({
    slug: "site-settings",
    status: true,
    versions: { drafts: true },
    // Everyone else, the anonymous visitor included, may read and update.
    access: {
      read: ({ user }) => user?.id !== refused.read,
      update: ({ user }) => user?.id !== refused.update,
    },
    fields: [text({ name: "siteName" })],
  });

const hooks = {
  beforeRead: vi.fn(async () => undefined),
  afterRead: vi.fn(async (ctx: HookContext) => ctx.data),
};

/** A Single nothing ever writes, with read hooks that record being run. */
const landing = () =>
  defineSingle({
    slug: "landing",
    status: true,
    versions: { drafts: true },
    access: { read: () => true, update: () => true },
    hooks: {
      beforeRead: [hooks.beforeRead],
      afterRead: [hooks.afterRead],
    },
    fields: [text({ name: "headline", defaultValue: "Welcome" })],
  });

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  refused.read = "";
  refused.update = "";
  for (const hook of Object.values(hooks)) hook.mockClear();
});

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    singles: [settings(), landing()],
  });
  // The install's first account is made its administrator, whom no rule
  // binds. Made first so that none of the sharers below is.
  await account(current, "founder@example.com");
  return current;
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

/**
 * An account that shares links. A link is judged as its sharer for read and
 * update, and a rule only narrows a permission, so the sharer holds both on
 * each Single and the rules alone decide which of them is refused.
 */
async function sharerAccount(t: TestNextly, email: string): Promise<string> {
  const id = await account(t, email);
  for (const action of ["read", "update"]) {
    await grantTo(t, id, action, ["site-settings", "landing"]);
  }
  return id;
}

async function linkFrom(minter: string, single: string): Promise<string> {
  const { token } = await signPreviewToken({ kind: "single", single }, SECRET, {
    generation: GENERATION,
    minter,
  });
  return token;
}

function gate(token: string) {
  return previewSingleDraftGate({
    secret: SECRET,
    generation: GENERATION,
    cookies: async () => ({
      get: (name: string) =>
        name === PREVIEW_SCOPE_COOKIE
          ? { value: encodeURIComponent(token) }
          : undefined,
    }),
  });
}

/** The page a visitor holding `token` is served. */
async function render(t: TestNextly, token: string): Promise<string> {
  const page = (await createSingleRoute({
    slug: "site-settings",
    nextly: t.nextly,
    render: (document: Record<string, unknown>) => document,
    draft: gate(token),
  }).SinglePage()) as Record<string, unknown>;
  return String(page.siteName);
}

/** Published as "Acme", with "Acme (pending)" waiting as the working draft. */
async function seed(t: TestNextly): Promise<void> {
  await t.nextly.updateSingle({
    slug: "site-settings",
    data: { siteName: "Acme", status: "published" },
  });
  await t.nextly.updateSingle({
    slug: "site-settings",
    data: { siteName: "Acme (pending)" },
  });
}

describe.each(getConfiguredTestDialects())(
  "a Single's preview re-checks its sharer (%s)",
  dialect => {
    it("serves the draft to a sharer who may read and update the Single", async () => {
      const t = await boot(dialect);
      await seed(t);
      const editor = await sharerAccount(t, "editor@example.com");

      expect(await render(t, await linkFrom(editor, "site-settings"))).toBe(
        "Acme (pending)"
      );
    });

    it("serves only the published document once the sharer may no longer update it", async () => {
      const t = await boot(dialect);
      await seed(t);
      const sharer = await sharerAccount(t, "lost-update@example.com");
      refused.update = sharer;

      expect(await render(t, await linkFrom(sharer, "site-settings"))).toBe(
        "Acme"
      );
    });

    it("serves only the published document once the sharer may no longer read it", async () => {
      const t = await boot(dialect);
      await seed(t);
      const sharer = await sharerAccount(t, "lost-read@example.com");
      refused.read = sharer;

      expect(await render(t, await linkFrom(sharer, "site-settings"))).toBe(
        "Acme"
      );
    });

    it("creates nothing and runs no hook when the Single was never created", async () => {
      const t = await boot(dialect);
      const editor = await sharerAccount(t, "editor@example.com");
      const registry = t.getService("singleRegistryService") as unknown as {
        getSingleBySlug: (slug: string) => Promise<{ tableName?: string }>;
      };
      const { tableName } = await registry.getSingleBySlug("landing");
      expect(tableName, "the Single must be registered").toBeTruthy();
      // The premise: no row yet, and no history.
      expect(await t.adapter.selectOne(tableName!, {})).toBeNull();
      expect(await t.adapter.select("nextly_versions", {})).toHaveLength(0);

      const granted = await gate(await linkFrom(editor, "landing"))({
        slug: "landing",
      });
      // The read probe on its own as well: the gate asks the editable half
      // first, and a missing row stops it there, so the render alone would
      // pass whatever the read probe did.
      const readable = await singleStoredDocumentReadable("landing", {
        user: { id: editor },
        routeAuthorized: false,
      });

      // Nothing to preview, so nothing is granted…
      expect(granted).toBe(false);
      expect(readable).toBe(false);
      // …and deciding that wrote nothing and ran nothing.
      expect(await t.adapter.selectOne(tableName!, {})).toBeNull();
      expect(await t.adapter.select("nextly_versions", {})).toHaveLength(0);
      expect(hooks.beforeRead).not.toHaveBeenCalled();
      expect(hooks.afterRead).not.toHaveBeenCalled();

      // The control: an ordinary read of the same Single does create it and
      // run those hooks, so the absences above are the probe's doing rather
      // than hooks that never fire or a Single that cannot be created.
      await t.nextly.findSingle({ slug: "landing" });
      expect(await t.adapter.selectOne(tableName!, {})).not.toBeNull();
      expect(hooks.beforeRead).toHaveBeenCalled();
      expect(hooks.afterRead).toHaveBeenCalled();
    });
  }
);
