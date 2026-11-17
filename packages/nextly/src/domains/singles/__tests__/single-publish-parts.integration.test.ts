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
import { container } from "../../../di/container";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import type { ApiKeyService } from "../../auth/services/api-key-service";
import type {
  PublishGate,
  PublishGateQuestion,
} from "../../collections/services/publish-gate";
import type { PublishPartsRequest } from "../../collections/services/publish-parts";
import type { SingleEntryService } from "../services/single-entry-service";

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

/** `POST /api/singles/notice/{direction}` with `body`, answering its status and body. */
async function postParts(
  key: string,
  direction: "publish" | "unpublish",
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  const path = ["singles", NOTICE, direction];
  const response = await createDynamicHandlers().POST(
    new Request(`http://localhost/api/${path.join("/")}`, {
      method: "POST",
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

/** The Single's service, which the routes call. */
function singles(): SingleEntryService {
  return app().getService("singleEntryService");
}

/** Publishes or unpublishes the Notice's chosen parts, trusted, over whatever is stored. */
function moveParts(request: PublishPartsRequest) {
  return singles().publishParts(
    { slug: NOTICE, overrideAccess: true, data: { _overwrite: true } },
    request
  );
}

/** The publishing state as stored: the Single's own status, and each language's `_status`. */
async function stored(): Promise<{
  main: unknown;
  languages: Record<string, unknown>;
}> {
  const [main] = await app().adapter.select<Record<string, unknown>>(
    `single_${NOTICE}`,
    {}
  );
  const rows = await app().adapter.select<Record<string, unknown>>(
    `single_${NOTICE}_locales`,
    {}
  );
  return {
    main: main?.status,
    languages: Object.fromEntries(
      rows.map(row => [String(row._locale), row._status])
    ),
  };
}

/** The Notice's held working drafts, by slot (`shared` for none). */
async function heldDrafts(): Promise<string[]> {
  const rows = await app().adapter.select<{ locale: string | null }>(
    "nextly_versions",
    {
      where: {
        and: [
          { column: "scopeKind", op: "=", value: "single" },
          { column: "scopeSlug", op: "=", value: NOTICE },
          { column: "isAutosave", op: "=", value: false },
          { column: "versionNo", op: "IS NULL" },
          { column: "status", op: "=", value: "draft" },
        ],
      },
    }
  );
  return rows.map(row => row.locale ?? "shared").sort();
}

/** The validation issue codes a refused answer carries. */
function refusalCodes(answer: {
  errors?: Array<{ code?: string }>;
}): (string | undefined)[] {
  return (answer.errors ?? []).map(issue => issue.code);
}

/** English and Spanish saved, neither ever published. */
async function neverPublished(): Promise<void> {
  await save("en", { title: "Hello", code: "N-1" });
  await save("es", { title: "Hola" });
  // Without this, an assertion that nothing went live is met by a Single with no languages stored.
  expect(await stored()).toEqual({
    main: "draft",
    languages: { en: "draft", es: "draft" },
  });
}

/** English and Spanish both live. */
async function bothLive(): Promise<void> {
  await save("en", { title: "Hello", code: "N-1", status: "published" });
  await save("es", { title: "Hola", status: "published" });
  expect(await stored()).toEqual({
    main: "published",
    languages: { en: "published", es: "published" },
  });
}

/**
 * A gate that holds back the languages `held` names under the move's lock (its early answer holds
 * nothing back), and counts what it was asked.
 */
function gateUnderLock(held: readonly string[] = []): {
  judged: PublishGateQuestion[];
  settled: number;
} {
  const seen = { judged: [] as PublishGateQuestion[], settled: 0 };
  container.registerSingleton<PublishGate>("publishGate", () => ({
    refusals: () => Promise.resolve([]),
    judge: (_tx, question) => {
      seen.judged.push(question);
      return Promise.resolve({
        refusals: question.parts.flatMap(part =>
          part.kind === "language" && held.includes(part.locale)
            ? [{ part, code: "NOT_APPROVED" as const, message: "Held." }]
            : []
        ),
        settle: () => {
          seen.settled += 1;
          return Promise.resolve();
        },
      });
    },
  }));
  return seen;
}

describe.each(getConfiguredTestDialects())(
  "a Single publishes the parts chosen (%s)",
  dialect => {
    describe("publishing chosen languages", () => {
      it("puts Spanish alone live, adding the shared part on the Single's first publish", async () => {
        await boot(dialect);
        await neverPublished();

        const answer = await moveParts({
          direction: "publish",
          locales: ["es"],
        });

        expect(answer.success, JSON.stringify(answer)).toBe(true);
        expect(answer.data?.shared).toEqual({ changes: true, added: true });
        expect(answer.data?.languages.map(l => l.locale)).toEqual(["es"]);
        // English, not chosen, stays a draft; the Single itself goes live with Spanish.
        expect(await stored()).toEqual({
          main: "published",
          languages: { en: "draft", es: "published" },
        });
        expect((await published("es")).title).toBe("Hola");
      });

      it("puts Spanish's pending change live and leaves English's held", async () => {
        await boot(dialect);
        await bothLive();
        await save("es", { title: "Hola 2" });
        await save("en", { title: "Hello 2" });
        expect(await heldDrafts()).toEqual(["en", "es"]);

        const answer = await moveParts({
          direction: "publish",
          locales: ["es"],
        });

        expect(answer.success, JSON.stringify(answer)).toBe(true);
        expect(answer.data?.shared).toEqual({ changes: false, added: false });
        expect((await published("es")).title).toBe("Hola 2");
        // English's change is still held, and its live value is what it was.
        expect((await published("en")).title).toBe("Hello");
        expect(await heldDrafts()).toEqual(["en"]);
      });

      it("says what it would do and changes nothing", async () => {
        await boot(dialect);
        await neverPublished();

        const answer = await moveParts({
          direction: "publish",
          locales: ["es"],
          describe: true,
        });

        expect(answer.success, JSON.stringify(answer)).toBe(true);
        expect(answer.data?.languages).toEqual([
          { locale: "es", outcome: "goes-live" },
        ]);
        expect(answer.data?.shared).toEqual({ changes: true, added: true });
        expect(await stored()).toEqual({
          main: "draft",
          languages: { en: "draft", es: "draft" },
        });
      });

      it("publishes through REST", async () => {
        await boot(dialect);
        const key = await adminKey();
        await neverPublished();

        const answer = await postParts(key, "publish", {
          locales: ["es"],
          _overwrite: true,
        });

        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        expect(await stored()).toEqual({
          main: "published",
          languages: { en: "draft", es: "published" },
        });
        expect((await published("es")).title).toBe("Hola");
      });
    });

    describe("publishing the shared part alone", () => {
      it("puts the shared pending change live and moves no language", async () => {
        await boot(dialect, { perLanguageStorage: true });
        await bothLive();
        // A shared edit, and a Spanish one, each held in a draft of its own.
        await save("es", { code: "N-2" });
        await save("es", { title: "Hola 2" });
        expect(await heldDrafts()).toEqual(["es", "shared"]);

        const answer = await moveParts({
          direction: "publish",
          locales: [],
          shared: true,
        });

        expect(answer.success, JSON.stringify(answer)).toBe(true);
        expect((await published("en")).code).toBe("N-2");
        expect(await published("es")).toMatchObject({
          code: "N-2",
          title: "Hola",
        });
        expect(await heldDrafts()).toEqual(["es"]);
        expect(await stored()).toEqual({
          main: "published",
          languages: { en: "published", es: "published" },
        });
      });
    });

    describe("unpublishing chosen parts", () => {
      it("takes Spanish alone down", async () => {
        await boot(dialect);
        await bothLive();

        const answer = await moveParts({
          direction: "unpublish",
          locales: ["es"],
        });

        expect(answer.success, JSON.stringify(answer)).toBe(true);
        expect(answer.data?.languages).toEqual([
          { locale: "es", outcome: "taken-down" },
        ]);
        expect(await stored()).toEqual({
          main: "published",
          languages: { en: "published", es: "draft" },
        });
        expect((await published("en")).title).toBe("Hello");
      });

      it("refuses to take the shared part down while English stays live, and changes nothing", async () => {
        await boot(dialect);
        await bothLive();

        const answer = await moveParts({
          direction: "unpublish",
          locales: ["es"],
          shared: true,
        });

        expect(answer.success).toBe(false);
        expect(refusalCodes(answer)).toContain("LANGUAGES_STILL_LIVE");
        expect(await stored()).toEqual({
          main: "published",
          languages: { en: "published", es: "published" },
        });
      });

      it("unpublishes through REST", async () => {
        await boot(dialect);
        const key = await adminKey();
        await bothLive();

        const answer = await postParts(key, "unpublish", {
          locales: ["es"],
          _overwrite: true,
        });

        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        expect(await stored()).toEqual({
          main: "published",
          languages: { en: "published", es: "draft" },
        });
      });
    });

    describe("the publish gate, asked under the lock", () => {
      it("refuses a publish its verdict holds back, and nothing goes live", async () => {
        await boot(dialect);
        await neverPublished();
        const gate = gateUnderLock(["es"]);

        const answer = await moveParts({
          direction: "publish",
          locales: ["es"],
        });

        expect(answer.success).toBe(false);
        expect(refusalCodes(answer)).toContain("NOT_APPROVED");
        expect(gate.judged).toHaveLength(1);
        expect(gate.judged[0]).toMatchObject({
          scope: { kind: "single", slug: NOTICE },
          direction: "publish",
          parts: [{ kind: "language", locale: "es" }, { kind: "shared" }],
          live: { languages: [], shared: false },
          caller: { kind: "trusted" },
        });
        expect(gate.settled).toBe(0);
        expect(await stored()).toEqual({
          main: "draft",
          languages: { en: "draft", es: "draft" },
        });
      });

      it("leaves every chosen language as it was when it holds one back", async () => {
        await boot(dialect);
        await neverPublished();
        gateUnderLock(["es"]);

        const answer = await moveParts({
          direction: "publish",
          locales: ["en", "es"],
        });

        expect(answer.success).toBe(false);
        expect(await stored()).toEqual({
          main: "draft",
          languages: { en: "draft", es: "draft" },
        });
      });

      it("settles a publish it lets through once, and is never asked to describe or unpublish", async () => {
        await boot(dialect);
        await neverPublished();
        const gate = gateUnderLock();

        const described = await moveParts({
          direction: "publish",
          locales: ["es"],
          describe: true,
        });
        expect(described.success, JSON.stringify(described)).toBe(true);
        expect(gate.judged).toHaveLength(0);

        const answer = await moveParts({
          direction: "publish",
          locales: ["es"],
        });
        expect(answer.success, JSON.stringify(answer)).toBe(true);
        expect(gate.judged).toHaveLength(1);
        expect(gate.settled).toBe(1);
        expect((await stored()).languages.es).toBe("published");

        const down = await moveParts({
          direction: "unpublish",
          locales: ["es"],
        });
        expect(down.success, JSON.stringify(down)).toBe(true);
        expect((await stored()).languages.es).toBe("draft");
        expect(gate.judged).toHaveLength(1);
        expect(gate.settled).toBe(1);
      });

      it("rolls the publish back when settling fails", async () => {
        await boot(dialect);
        await neverPublished();
        let settles = 0;
        container.registerSingleton<PublishGate>("publishGate", () => ({
          refusals: () => Promise.resolve([]),
          judge: () =>
            Promise.resolve({
              refusals: [],
              settle: () => {
                settles += 1;
                return Promise.reject(new Error("changed since judged"));
              },
            }),
        }));

        const answer = await moveParts({
          direction: "publish",
          locales: ["es"],
        }).catch(() => ({ success: false }));

        // The move reached the settle, after its writes: nothing it wrote is left.
        expect(settles).toBe(1);
        expect(answer.success).toBe(false);
        expect(await stored()).toEqual({
          main: "draft",
          languages: { en: "draft", es: "draft" },
        });
      });
    });

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
