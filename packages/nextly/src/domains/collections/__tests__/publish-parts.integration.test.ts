/**
 * Publishing the chosen parts of an entry, its languages and its shared part, as one request,
 * on every dialect.
 *
 * Everything chosen goes live, or nothing does: a refusal in one language leaves every other
 * language as it was, and names every part that refuses, not the first. What a request says it
 * would do is what it then does. A language may go live before the default one, taking the shared
 * part with it on the entry's first publish. A unique translated field needs its own value in each
 * language that goes live, since it is never filled from another language.
 *
 * The plausible broken implementations publish the languages one at a time, so an earlier one
 * stays live when a later one is refused, stop at the first refusal, never touch the shared part
 * for a language other than the default, or judge a language on its fallback-filled values.
 */
import { afterEach, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { runWithRequestCaller } from "../../../auth/caller-scope";
import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { container } from "../../../di/container";
import type { ServiceContainer } from "../../../services";
import type { PublishGate } from "../services/publish-gate";
import { defineCollection, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

type Doc = Record<string, unknown>;

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

const LOCALES = ["en", "es", "fr"];

describeEachDialect("publishing the chosen parts of an entry", dialect => {
  let t: TestNextly | undefined;
  const q = (name: string) => quote(dialect, name);

  afterEach(async () => {
    await t?.destroy();
    t = undefined;
  });

  async function boot(
    collection: ReturnType<typeof defineCollection>
  ): Promise<TestNextly> {
    t = await createTestNextly({
      dialect,
      collections: [collection],
      localization: { locales: LOCALES, defaultLocale: "en" },
    });
    return t;
  }

  const posts = (extra: Partial<Parameters<typeof defineCollection>[0]> = {}) =>
    defineCollection({
      slug: "posts",
      localized: true,
      status: true,
      fields: [
        text({ name: "title", required: true }),
        text({ name: "tagline", localized: false }),
      ],
      ...extra,
    });

  /** A draft entry written in English, then in each language of `others`. */
  async function entry(others: Record<string, Doc> = {}): Promise<string> {
    const created = (await t!.nextly.create({
      collection: "posts",
      locale: "en",
      data: { title: "Hello", tagline: "Shared" },
    })) as { item: { id: string } };
    const id = created.item.id;
    for (const [locale, data] of Object.entries(others)) {
      await t!.nextly.update({
        collection: "posts",
        id,
        locale,
        data: { ...data, _overwrite: true },
      });
    }
    return id;
  }

  /** The entry's publishing state: the shared part's, then each stored language's. */
  async function states(
    id: string,
    table = "dc_posts"
  ): Promise<Record<string, string>> {
    const [main] = await t!.adapter.executeQuery<{ status: string }>(
      `SELECT ${q("status")} AS status FROM ${q(table)} WHERE ${q("id")} = '${id}'`
    );
    const rows = await t!.adapter.executeQuery<{
      locale: string;
      status: string;
    }>(
      `SELECT ${q("_locale")} AS locale, ${q("_status")} AS status FROM ${q(`${table}_locales`)} WHERE ${q("_parent")} = '${id}' ORDER BY ${q("_locale")}`
    );
    return {
      shared: main?.status ?? "",
      ...Object.fromEntries(rows.map(r => [r.locale, r.status])),
    };
  }

  function refusalOf(promise: Promise<unknown>): Promise<string> {
    return promise.then(
      () => "",
      (error: unknown) =>
        error instanceof Error
          ? `${error.message} ${JSON.stringify((error as { publicData?: unknown }).publicData ?? null)}`
          : String(error)
    );
  }

  it("does what it said it would, language by language", async () => {
    await boot(posts());
    const id = await entry({ es: { title: "Hola" } });

    const described = await t!.nextly.publish({
      collection: "posts",
      id,
      locales: ["es", "fr"],
      shared: true,
      describe: true,
    });
    const applied = await t!.nextly.publish({
      collection: "posts",
      id,
      locales: ["es", "fr"],
      shared: true,
      data: { _overwrite: true },
    });

    expect(described.item.languages.map(l => l.locale)).toEqual(["es", "fr"]);
    expect(applied.item.languages).toEqual(described.item.languages);
  });

  it("publishes no language when chosen languages fail validation, and names every one that fails", async () => {
    await boot(
      posts({
        fields: [
          text({
            name: "title",
            required: true,
            validate: (value: unknown) =>
              value !== "BAD" || "This title is not allowed.",
          }),
          text({ name: "tagline", localized: false }),
        ],
      })
    );
    const id = await entry({ es: { title: "Hola" }, fr: { title: "Salut" } });
    // Both languages hold a value their rule refuses, written as stored content may hold it.
    await t!.adapter.executeQuery(
      `UPDATE ${q("dc_posts_locales")} SET ${q("title")} = 'BAD' WHERE ${q("_locale")} IN ('es', 'fr')`
    );
    const before = await states(id);

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "posts",
        id,
        locales: ["es", "fr"],
        shared: true,
        data: { _overwrite: true },
      })
    );

    // Every language that fails is named, not only the first.
    expect(refusal).toMatch(/\bes\b/);
    expect(refusal).toMatch(/\bfr\b/);
    expect(await states(id)).toEqual(before);
  });

  it("publishes no language when the caller may not publish one of those chosen", async () => {
    await boot(
      posts({
        access: {
          read: () => true,
          update: () => true,
          publish: ({ locale }) => locale !== "es",
        },
      })
    );
    const id = await entry({ es: { title: "Hola" }, fr: { title: "Bonjour" } });
    const publisher = await userWhoMay(t!, "publisher", "publish", ["posts"]);
    const before = await states(id);

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "posts",
        id,
        locales: ["fr", "es"],
        shared: true,
        overrideAccess: false,
        user: { id: publisher, email: "publisher@example.test", roles: [] },
        data: { _overwrite: true },
      })
    );

    expect(refusal).not.toBe("");
    expect(await states(id)).toEqual(before);
  });

  // Both doors, one decision: the Direct API and REST refuse the same unpublish whole.
  it.each(["the Direct API", "REST"])(
    "takes no language down when the caller may not unpublish one of those chosen, through %s",
    async door => {
      await boot(
        posts({
          access: {
            read: () => true,
            update: () => true,
            publish: () => true,
            unpublish: ({ locale }) => locale !== "fr",
          },
        })
      );
      const id = await entry({
        es: { title: "Hola" },
        fr: { title: "Bonjour" },
      });
      await t!.nextly.publish({
        collection: "posts",
        id,
        locales: "all",
        data: { _overwrite: true },
      });
      const editor = await userWhoMay(t!, "editor", "unpublish", ["posts"]);
      await grantTo(t!, editor, "update", ["posts"]);
      await grantTo(t!, editor, "read", ["posts"]);
      const before = await states(id);

      const refusal =
        door === "REST"
          ? await runWithRequestCaller(
              {
                userId: editor,
                actor: { type: "user", id: editor },
                roles: [],
              },
              () =>
                refusalOf(
                  (
                    dispatchCollections(
                      {} as ServiceContainer,
                      "unpublishParts",
                      { collectionName: "posts", entryId: id },
                      { locales: ["es", "fr"], _overwrite: true }
                    ) as Promise<Response>
                  ).then(async response => {
                    // A refusal the dispatcher answers rather than throws.
                    if (response.status >= 400) {
                      throw new Error(
                        `${response.status} ${await response.text()}`
                      );
                    }
                  })
                )
            )
          : await refusalOf(
              t!.nextly.unpublish({
                collection: "posts",
                id,
                locales: ["es", "fr"],
                overrideAccess: false,
                user: { id: editor, email: "editor@example.test", roles: [] },
                data: { _overwrite: true },
              })
            );

      expect(refusal).not.toBe("");
      expect(await states(id)).toEqual(before);
    }
  );

  // Every language is a list of languages like any other: each one's unpublish rule is asked in
  // that language, so a caller who may not take French down cannot do it by naming every language.
  it("asks each language's unpublish rule when every language is unpublished", async () => {
    await boot(
      posts({
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: ({ locale }) => locale !== "fr",
        },
      })
    );
    const id = await entry({ es: { title: "Hola" }, fr: { title: "Bonjour" } });
    await t!.nextly.publish({
      collection: "posts",
      id,
      locales: "all",
      data: { _overwrite: true },
    });
    const editor = await userWhoMay(t!, "editor", "unpublish", ["posts"]);
    await grantTo(t!, editor, "update", ["posts"]);
    await grantTo(t!, editor, "read", ["posts"]);
    const before = await states(id);

    const refusal = await refusalOf(
      t!.nextly.unpublish({
        collection: "posts",
        id,
        locales: "all",
        overrideAccess: false,
        user: { id: editor, email: "editor@example.test", roles: [] },
        data: { _overwrite: true },
      })
    );

    expect(refusal).toMatch(/\bfr\b/);
    expect(await states(id)).toEqual(before);
  });

  // Without per-language storage a language's pending change holds the shared values too, so a
  // publish of that language alone would put its shared edits live. It is refused instead, naming
  // them, and nothing is written; published with the shared part, it goes live.
  it("refuses a languages-only publish whose pending change edits the shared part", async () => {
    await boot(posts({ versions: { drafts: true } }));
    const id = await entry({ es: { title: "Hola" } });
    await t!.nextly.publish({
      collection: "posts",
      id,
      locales: "all",
      data: { _overwrite: true },
    });
    // Held as Spanish's pending change, since the entry is live.
    await t!.nextly.update({
      collection: "posts",
      id,
      locale: "es",
      data: { title: "Hola 2", tagline: "Changed", _overwrite: true },
    });

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "posts",
        id,
        locales: ["es"],
        data: { _overwrite: true },
      })
    );
    const [main] = await t!.adapter.executeQuery<{ tagline: string }>(
      `SELECT ${q("tagline")} AS tagline FROM ${q("dc_posts")} WHERE ${q("id")} = '${id}'`
    );

    expect(refusal).toMatch(/tagline/);
    expect(main?.tagline).toBe("Shared");

    await t!.nextly.publish({
      collection: "posts",
      id,
      locales: ["es"],
      shared: true,
      data: { _overwrite: true },
    });
    const [after] = await t!.adapter.executeQuery<{ tagline: string }>(
      `SELECT ${q("tagline")} AS tagline FROM ${q("dc_posts")} WHERE ${q("id")} = '${id}'`
    );
    expect(after?.tagline).toBe("Changed");
  });

  /** A gate holding back the parts `held` names: a language code, or "shared". */
  function holdBack(held: readonly string[]): void {
    container.registerSingleton<PublishGate>("publishGate", () => ({
      refusals: question =>
        Promise.resolve(
          question.parts
            .filter(part =>
              held.includes(part.kind === "shared" ? "shared" : part.locale)
            )
            .map(part => ({ part, message: "Waiting for approval." }))
        ),
    }));
  }

  it("publishes no language when the gate holds one of those chosen back", async () => {
    await boot(posts());
    const id = await entry({ es: { title: "Hola" }, fr: { title: "Bonjour" } });
    holdBack(["es"]);
    const before = await states(id);

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "posts",
        id,
        locales: ["fr", "es"],
        shared: true,
        data: { _overwrite: true },
      })
    );

    expect(refusal).toMatch(/Waiting for approval/);
    expect(await states(id)).toEqual(before);
  });

  it("asks the gate about the shared part a first publish adds", async () => {
    await boot(posts());
    const id = await entry({ es: { title: "Hola" } });
    holdBack(["shared"]);
    const before = await states(id);

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "posts",
        id,
        locales: ["es"],
        data: { _overwrite: true },
      })
    );

    expect(refusal).toMatch(/Waiting for approval/);
    expect(await states(id)).toEqual(before);
  });

  // The shared part is asked as no one language: a rule that admits only Spanish does not admit
  // the shared values every language shows, which an entry's first publish puts live.
  it("refuses a first publish when the caller may publish the language but not the shared part", async () => {
    await boot(
      posts({
        access: {
          read: () => true,
          update: () => true,
          publish: ({ locale }) => locale === "es",
        },
      })
    );
    const id = await entry({ es: { title: "Hola" } });
    const publisher = await userWhoMay(t!, "publisher", "publish", ["posts"]);
    const before = await states(id);

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "posts",
        id,
        locales: ["es"],
        overrideAccess: false,
        user: { id: publisher, email: "publisher@example.test", roles: [] },
        data: { _overwrite: true },
      })
    );

    expect(refusal).not.toBe("");
    expect(await states(id)).toEqual(before);
  });

  it("refuses to take the shared part down while a language it was not asked about stays live", async () => {
    await boot(posts());
    const id = await entry({ es: { title: "Hola" } });
    await t!.nextly.publish({
      collection: "posts",
      id,
      locales: "all",
      data: { _overwrite: true },
    });
    const before = await states(id);

    const refusal = await refusalOf(
      t!.nextly.unpublish({
        collection: "posts",
        id,
        locales: ["en"],
        shared: true,
        data: { _overwrite: true },
      })
    );

    expect(refusal).toMatch(/es/);
    expect(await states(id)).toEqual(before);
  });

  it("puts Spanish live before English, with the shared part, and says the shared part was added", async () => {
    await boot(posts());
    const id = await entry({ es: { title: "Hola" } });

    const published = await t!.nextly.publish({
      collection: "posts",
      id,
      locales: ["es"],
      data: { _overwrite: true },
    });

    expect(published.item.shared).toEqual({ changes: true, added: true });
    expect(await states(id)).toEqual({
      shared: "published",
      en: "draft",
      es: "published",
    });
  });

  it("refuses a language whose required translated field holds only a fallback, when every language must hold its own", async () => {
    await boot(posts({ requireEveryLanguage: true }));
    // Spanish has a row, and its title falls back to English.
    const id = await entry({ es: { tagline: "Shared" } });
    const before = await states(id);

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "posts",
        id,
        locales: ["es"],
        shared: true,
        data: { _overwrite: true },
      })
    );

    expect(refusal).toMatch(/title/);
    expect(await states(id)).toEqual(before);
  });

  it("refuses a language with no value of its own for a required unique translated field", async () => {
    await boot(
      defineCollection({
        slug: "pages",
        localized: true,
        status: true,
        fields: [
          text({ name: "title" }),
          text({ name: "slug", required: true, unique: true }),
        ],
      })
    );
    const created = (await t!.nextly.create({
      collection: "pages",
      locale: "en",
      data: { title: "Hello", slug: "hola" },
    })) as { item: { id: string } };
    const id = created.item.id;
    await t!.nextly.publish({
      collection: "pages",
      id,
      locales: ["en"],
      shared: true,
      data: { _overwrite: true },
    });
    await t!.nextly.update({
      collection: "pages",
      id,
      locale: "es",
      data: { title: "Hola", _overwrite: true },
    });
    const before = await states(id, "dc_pages");

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "pages",
        id,
        locales: ["es"],
        data: { _overwrite: true },
      })
    );

    expect(refusal).toMatch(/UNIQUE_VALUE_REQUIRED_IN_LANGUAGE/);
    expect(refusal).toMatch(/slug/);
    expect(await states(id, "dc_pages")).toEqual(before);
  });
  it("refuses a request that chooses no part, and moves nothing", async () => {
    await boot(posts());
    const id = await entry({ es: { title: "Hola" } });
    const before = await states(id);

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "posts",
        id,
        locales: [],
        data: { _overwrite: true },
      })
    );

    expect(refusal).toMatch(/NOTHING_CHOSEN/);
    expect(await states(id)).toEqual(before);
  });

  // Judged again under the entry's lock: a language published after the request was judged on the
  // pool keeps its shared part. The transition is called as the service calls it once that judgement
  // has passed.
  it("keeps the shared part live when a language not chosen is live under the lock", async () => {
    await boot(posts());
    const id = await entry({ es: { title: "Hola" } });
    await t!.nextly.publish({
      collection: "posts",
      id,
      locales: "all",
      data: { _overwrite: true },
    });
    const before = await states(id);
    const entries = (
      t!.getService("collectionsHandler") as unknown as {
        getEntryService(): {
          unpublishAllLocales(params: Record<string, unknown>): Promise<{
            success: boolean;
            message?: string;
          }>;
        };
      }
    ).getEntryService();

    const moved = await entries.unpublishAllLocales({
      collectionName: "posts",
      entryId: id,
      overrideAccess: true,
      data: { _overwrite: true },
      parts: { locales: new Set(["en"]), shared: true },
    });

    expect(moved.success).toBe(false);
    expect(moved.message).toMatch(/es/);
    expect(await states(id)).toEqual(before);
  });

  // What a language puts live is its pending change: a unique value the change supplies counts.
  it("publishes a language whose pending change supplies its required unique field", async () => {
    await boot(
      defineCollection({
        slug: "pages",
        localized: true,
        status: true,
        versions: { drafts: true },
        fields: [
          text({ name: "title" }),
          text({ name: "slug", required: true, unique: true }),
        ],
      })
    );
    const created = (await t!.nextly.create({
      collection: "pages",
      locale: "en",
      data: { title: "Hello", slug: "hola", status: "published" },
    })) as { item: { id: string } };
    const id = created.item.id;
    // Held as Spanish's pending change, since the entry is live.
    await t!.nextly.update({
      collection: "pages",
      id,
      locale: "es",
      data: { title: "Hola", slug: "hola-es", _overwrite: true },
    });

    await t!.nextly.publish({
      collection: "pages",
      id,
      locales: ["es"],
      data: { _overwrite: true },
    });

    const read = (await t!.nextly.findByID({
      collection: "pages",
      id,
      locale: "es",
    })) as { slug?: unknown };
    expect(read.slug).toBe("hola-es");
  });

  // A move of languages alone leaves the entry's own status, so its history records no move of it.
  it("records no move of the entry when a language with nothing to take down is unpublished", async () => {
    await boot(posts());
    const id = await entry({ es: { title: "Hola" } });
    await t!.nextly.publish({
      collection: "posts",
      id,
      locales: "all",
      data: { _overwrite: true },
    });
    const unpublishedBefore = await unpublishedEvents(id);

    await t!.nextly.unpublish({
      collection: "posts",
      id,
      locales: ["fr"],
      data: { _overwrite: true },
    });

    expect(await unpublishedEvents(id)).toBe(unpublishedBefore);
    expect((await states(id)).shared).toBe("published");
  });

  async function unpublishedEvents(id: string): Promise<number> {
    const rows = await t!.adapter.executeQuery<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM ${q("nextly_content_events")} WHERE ${q("subject_id")} = '${id}' AND ${q("kind")} = 'unpublished'`
    );
    return Number(rows[0]?.n ?? 0);
  }
});
