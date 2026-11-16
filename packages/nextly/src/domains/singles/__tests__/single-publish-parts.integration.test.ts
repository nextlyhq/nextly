/**
 * A Single publishes and unpublishes the parts a caller chooses, on every configured dialect: some
 * of its languages, and separately its shared part, all or nothing.
 *
 * A save that carries a status is a door onto the same move: a status saved in one language puts
 * that language live (and the shared part with it on the Single's first publish). The plausible
 * broken implementation writes the status as one more value of the save, which for a language
 * whose pending change holds only translated fields leaves the Single's own row nothing to set.
 */
import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { defineSingle, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { ApiKeyService } from "../../auth/services/api-key-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const app = (): TestNextly => {
  if (!current) throw new Error("not booted");
  return current;
};

const NOTICE = "notice";

/**
 * The Notice Single: translated, with a shared `code`, keeping drafts beside what is live, in
 * English and Spanish.
 */
async function boot(
  dialect: TestDialect,
  options: { perLanguageStorage?: boolean } = {}
): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    // Drafts kept part by part: a language's pending change then holds its translated fields alone.
    perLanguageStorage: options.perLanguageStorage === true,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    singles: [
      defineSingle({
        slug: NOTICE,
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "code", localized: false }),
        ],
      }),
    ],
  });
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

/** Saves `data` to the Notice in `locale`, trusted, over whatever is stored. */
function save(locale: string, data: Record<string, unknown>) {
  return app().nextly.updateSingle({
    slug: NOTICE as never,
    locale,
    data: { ...data, _overwrite: true },
  } as never);
}

/** What a reader of published content is served in `locale`. */
async function published(locale: string): Promise<Record<string, unknown>> {
  return (await app().nextly.findSingle({
    slug: NOTICE as never,
    locale,
    fallbackLocale: false,
  } as never)) as Record<string, unknown>;
}

/** A full-access key of a super-admin, for the REST door. */
async function adminKey(): Promise<string> {
  const admin = await superAdminUser(app(), "user-notice-admin");
  const keys = app().getService("apiKeyService") as unknown as ApiKeyService;
  const { key } = await keys.createApiKey(admin, {
    name: "notice",
    tokenType: "full-access",
    expiresIn: "unlimited",
  });
  return key;
}

/** `PATCH /api/singles/notice?locale=…` with `body`, answering its status and body. */
async function patchSingle(
  key: string,
  locale: string,
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const path = ["singles", NOTICE];
  const response = await createDynamicHandlers().PATCH(
    new Request(`http://localhost/api/${path.join("/")}?locale=${locale}`, {
      method: "PATCH",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return {
    status: response.status,
    json: (await response.json()) as Record<string, unknown>,
  };
}

describe.each(getConfiguredTestDialects())(
  "a Single publishes the parts chosen (%s)",
  dialect => {
    describe("a save that carries a status", () => {
      it("puts a language live whose pending change holds only translated fields", async () => {
        await boot(dialect);
        await save("en", { title: "Hello", code: "N-1", status: "published" });
        // Spanish holds a change of its translated title alone, not yet live.
        await save("es", { title: "Hola" });

        await save("es", { status: "published" });

        expect((await published("es")).title).toBe("Hola");
        expect((await published("en")).title).toBe("Hello");
      });

      it("puts it live where each part keeps its own draft", async () => {
        await boot(dialect, { perLanguageStorage: true });
        const key = await adminKey();
        await save("en", { title: "Hello", code: "N-1", status: "published" });
        await save("es", { title: "Hola" });

        const answer = await patchSingle(key, "es", {
          status: "published",
          _overwrite: true,
        });

        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        expect((await published("es")).title).toBe("Hola");
      });

      it("puts it live through REST as well", async () => {
        await boot(dialect);
        const key = await adminKey();
        await save("en", { title: "Hello", code: "N-1", status: "published" });
        await save("es", { title: "Hola" });

        const answer = await patchSingle(key, "es", {
          status: "published",
          _overwrite: true,
        });

        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        expect((await published("es")).title).toBe("Hola");
      });
    });
  }
);
