/**
 * An older spelling of a configured language (`pt_BR` for `pt-BR`) is accepted for one release,
 * and answered for under the code the rows are stored under. Used as sent, it would query rows
 * nobody stores under it: every document would read as untranslated, and a translated one as
 * missing from the translated list.
 *
 * The plausible broken worklist: one that checks the older spelling is accepted and then queries
 * with it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Authentication is not what this case is about; the identity is stubbed and every
// authorization decision is the real one, as in the worklist's other route tests.
vi.mock("../../auth/middleware", async importActual => {
  const actual = await importActual<typeof import("../../auth/middleware")>();
  return {
    ...actual,
    requireAuthentication: vi.fn(async () => ({
      userId: "u1",
      userEmail: "u@x.test",
      userName: "U",
      authMethod: "session" as const,
      permissions: [] as string[],
      claims: {},
    })),
  };
});

import { userWhoMay } from "../../__tests__/fixtures/permission-holders";
import { defineCollection, text } from "../../config";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("the worklist asked in an older spelling of a language", () => {
  it("lists what is translated into that language under its configured code", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          localized: true,
          access: { read: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
      localization: { locales: ["en", "pt-BR"], defaultLocale: "en" },
    });
    await userWhoMay(current, "u1", "read", ["pages"]);
    const created = await current.nextly.create({
      collection: "pages",
      data: { title: "Hello" },
    });
    const id = (created.item as { id: string }).id;
    await current.nextly.update({
      collection: "pages",
      id,
      locale: "pt-BR",
      data: { title: "Olá", _overwrite: true },
    });
    const { getTranslationWorklist } = await import("../translations");
    const listed = async (locale: string) => {
      const res = await getTranslationWorklist(
        new Request(
          `http://t/api/translations?locale=${locale}&state=translated`
        )
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { id: string }[] };
      return body.items.map(item => item.id);
    };

    // The control: the configured code lists it.
    expect(await listed("pt-BR")).toEqual([id]);
    expect(await listed("pt_BR")).toEqual([id]);
  });
});
