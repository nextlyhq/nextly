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
    const created = await t!.nextly.create({
      collection: "posts",
      locale: "en",
      data: { title: "Hello", tagline: "Shared" },
    });
    const id = String(created.item.id);
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

  it("publishes Spanish from a Spanish read after an unrelated French edit, and refuses once Spanish itself changed", async () => {
    await boot(posts());
    const id = await entry({ es: { title: "Hola" }, fr: { title: "Bonjour" } });
    const readSpanish = async () =>
      (
        (await t!.nextly.findByID({
          collection: "posts",
          id,
          locale: "es",
        })) as { _rev: string }
      )._rev;

    const edit = (locale: string, title: string) =>
      t!.nextly.update({
        collection: "posts",
        id,
        locale,
        data: { title, _overwrite: true },
      });
    const publishSpanish = (rev: string) =>
      t!.nextly.publish({
        collection: "posts",
        id,
        locales: ["es"],
        shared: true,
        data: { _rev: rev },
      });

    // A Spanish edit since the read is a change to what is being published, and is refused.
    const stale = await readSpanish();
    await edit("es", "Hola otra vez");
    const refused = await publishSpanish(stale).then(
      () => null,
      (error: unknown) => (error as { code?: string }).code
    );
    expect(refused).toBe("STALE_VERSION");
    expect(await states(id)).toMatchObject({ es: "draft" });

    // A read of Spanish names only Spanish, so a French edit since says nothing about what it
    // read: publishing Spanish alone is judged on Spanish alone.
    const spanish = await readSpanish();
    await edit("fr", "Salut");
    await publishSpanish(spanish);
    expect(await states(id)).toMatchObject({
      es: "published",
      fr: "draft",
    });
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

  // Every way of publishing a language applies the same value rules: publishing every language
  // through its own door, and a save that carries a published status.
  it("applies requireEveryLanguage to publishing every language and to a save that publishes", async () => {
    await boot(posts({ requireEveryLanguage: true }));
    // Spanish has a row of its own, and its required title is empty.
    const id = await entry({ es: { title: "" } });
    const before = await states(id);
    const handler = t!.getService("collectionsHandler") as unknown as {
      publishAllLocales(params: Record<string, unknown>): Promise<{
        success: boolean;
        message?: string;
      }>;
    };

    const everyLanguage = await handler.publishAllLocales({
      collectionName: "posts",
      entryId: id,
      overrideAccess: true,
      data: { _overwrite: true },
    });
    const saved = await refusalOf(
      t!.nextly.update({
        collection: "posts",
        id,
        locale: "es",
        data: { status: "published", _overwrite: true },
      })
    );

    expect(everyLanguage.success).toBe(false);
    expect(everyLanguage.message).toMatch(/title/);
    expect(saved).toMatch(/REQUIRED_IN_LANGUAGE/);
    expect(await states(id)).toEqual(before);

    // The save's own value counts: with a title, Spanish publishes.
    await t!.nextly.update({
      collection: "posts",
      id,
      locale: "es",
      data: { title: "Hola", status: "published", _overwrite: true },
    });
    expect((await states(id)).es).toBe("published");
  });

  // A caller who may not publish is told so, and learns nothing of what the entry holds: the
  // value rules are not asked for them, so no field or language of the entry is named.
  it("refuses a caller without the publish right before judging what the entry holds", async () => {
    await boot(posts({ requireEveryLanguage: true }));
    const id = await entry({ es: { title: "" } });
    const editor = await userWhoMay(t!, "editor", "update", ["posts"]);
    await grantTo(t!, editor, "read", ["posts"]);
    const handler = t!.getService("collectionsHandler") as unknown as {
      publishAllLocales(params: Record<string, unknown>): Promise<{
        success: boolean;
        statusCode: number;
        message?: string;
      }>;
    };

    const everyLanguage = await handler.publishAllLocales({
      collectionName: "posts",
      entryId: id,
      overrideAccess: false,
      user: { id: editor, email: "editor@example.test", roles: [] },
      data: { _overwrite: true },
    });

    expect(everyLanguage.success).toBe(false);
    expect(JSON.stringify(everyLanguage)).not.toMatch(
      /title|REQUIRED_IN_LANGUAGE/
    );
    expect(everyLanguage.statusCode).toBe(403);
  });

  // The rule is asked of the languages the request takes down, on the pool and again by the
  // transition: a rule that keeps French live does not stop Spanish alone being taken down.
  it("asks the unpublish rule of the chosen languages only, here and under the lock", async () => {
    await boot(
      posts({
        access: {
          read: () => true,
          update: () => true,
          publish: () => true,
          unpublish: ({ locales }) => !locales.includes("fr"),
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

    await t!.nextly.unpublish({
      collection: "posts",
      id,
      locales: ["es"],
      overrideAccess: false,
      user: { id: editor, email: "editor@example.test", roles: [] },
      data: { _overwrite: true },
    });

    expect(await states(id)).toEqual({
      shared: "published",
      en: "published",
      es: "draft",
      fr: "published",
    });
  });

  // Taking one language down leaves the entry live, so its hooks are handed the entry as it is:
  // still published.
  it("hands the hooks the entry still published when one language alone is unpublished", async () => {
    const seen: unknown[] = [];
    await boot(
      posts({
        hooks: {
          afterChange: [
            ({ data }: { data?: Record<string, unknown> }) => {
              seen.push(data?.status);
              return data;
            },
          ],
        },
      } as never)
    );
    const id = await entry({ es: { title: "Hola" } });
    await t!.nextly.publish({
      collection: "posts",
      id,
      locales: "all",
      data: { _overwrite: true },
    });
    seen.length = 0;

    await t!.nextly.unpublish({
      collection: "posts",
      id,
      locales: ["es"],
      data: { _overwrite: true },
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(status => status === "published")).toBe(true);
  });

  // A collection that is not translated has no languages to publish one at a time: a request
  // naming one is refused, never read as a request to publish the whole entry.
  it("refuses a language of a collection that is not translated", async () => {
    await boot(
      defineCollection({
        slug: "notes",
        status: true,
        fields: [text({ name: "title" })],
      })
    );
    const created = await t!.nextly.create({
      collection: "notes",
      data: { title: "Hello" },
    });
    const id = String(created.item.id);

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "notes",
        id,
        locales: ["es"],
        data: { _overwrite: true },
      })
    );
    const [row] = await t!.adapter.executeQuery<{ status: string }>(
      `SELECT ${q("status")} AS status FROM ${q("dc_notes")} WHERE ${q("id")} = '${id}'`
    );

    expect(refusal).toMatch(/NOT_TRANSLATED/);
    expect(row?.status).toBe("draft");
  });

  // Publishing every language asks each language's publish rule before any value rule: a caller
  // refused in one language learns nothing of what the entry holds there.
  it("asks each language's publish rule before judging what publishing every language puts live", async () => {
    await boot(
      posts({
        requireEveryLanguage: true,
        access: {
          read: () => true,
          update: () => true,
          publish: ({ locale }) => locale !== "es",
        },
      })
    );
    const id = await entry({ es: { title: "" } });
    const publisher = await userWhoMay(t!, "publisher", "publish", ["posts"]);
    await grantTo(t!, publisher, "read", ["posts"]);
    await grantTo(t!, publisher, "update", ["posts"]);
    const handler = t!.getService("collectionsHandler") as unknown as {
      publishAllLocales(params: Record<string, unknown>): Promise<{
        success: boolean;
        statusCode: number;
      }>;
    };

    const everyLanguage = await handler.publishAllLocales({
      collectionName: "posts",
      entryId: id,
      overrideAccess: false,
      user: { id: publisher, email: "publisher@example.test", roles: [] },
      data: { _overwrite: true },
    });

    expect(everyLanguage.success).toBe(false);
    expect(JSON.stringify(everyLanguage)).not.toMatch(
      /title|REQUIRED_IN_LANGUAGE/
    );
  });

  // A language the caller may not publish but that this publish does not put live (no row of its
  // own) leaves the value rules standing for the languages it does put live.
  it("keeps the value rules where only a language not going live is refused", async () => {
    await boot(
      posts({
        requireEveryLanguage: true,
        access: {
          read: () => true,
          update: () => true,
          publish: ({ locale }) => locale !== "fr",
        },
      })
    );
    // Spanish has a row whose required title is empty; French has none.
    const id = await entry({ es: { title: "" } });
    const before = await states(id);
    const publisher = await userWhoMay(t!, "publisher", "publish", ["posts"]);
    await grantTo(t!, publisher, "read", ["posts"]);
    await grantTo(t!, publisher, "update", ["posts"]);
    const handler = t!.getService("collectionsHandler") as unknown as {
      publishAllLocales(params: Record<string, unknown>): Promise<{
        success: boolean;
        message?: string;
      }>;
    };

    const everyLanguage = await handler.publishAllLocales({
      collectionName: "posts",
      entryId: id,
      overrideAccess: false,
      user: { id: publisher, email: "publisher@example.test", roles: [] },
      data: { _overwrite: true },
    });

    expect(everyLanguage.success).toBe(false);
    expect(everyLanguage.message).toMatch(/title/);
    expect(await states(id)).toEqual(before);
  });

  // Without per-language storage a language's pending change carries its shared edits, and
  // publishing it with the shared part shows them in every live language: they are validated in
  // each, and asked of each language's field rules, as a shared draft's are.
  const lockedPosts = (fieldAccess?: {
    update: (args: { locale?: string }) => boolean;
  }) =>
    posts({
      versions: { drafts: true },
      fields: [
        text({ name: "title", required: true }),
        text({
          name: "tagline",
          localized: false,
          validate: (
            value: unknown,
            { data }: { data: Record<string, unknown> }
          ) =>
            data.title !== "Locked" ||
            value === "Shared" ||
            "The tagline cannot change while the title is Locked.",
          ...(fieldAccess ? { access: fieldAccess } : {}),
        }),
      ],
    });

  it("validates a language's shared edits in every live language when the shared part moves", async () => {
    await boot(lockedPosts());
    const id = await entry({ es: { title: "Locked" } });
    await t!.nextly.publish({
      collection: "posts",
      id,
      locales: "all",
      data: { _overwrite: true },
    });
    await t!.nextly.update({
      collection: "posts",
      id,
      locale: "en",
      data: { tagline: "Changed", _overwrite: true },
    });

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "posts",
        id,
        locales: ["en"],
        shared: true,
        data: { _overwrite: true },
      })
    );
    const [main] = await t!.adapter.executeQuery<{ tagline: string }>(
      `SELECT ${q("tagline")} AS tagline FROM ${q("dc_posts")} WHERE ${q("id")} = '${id}'`
    );

    expect(refusal).toMatch(/tagline/);
    expect(main?.tagline).toBe("Shared");
  });

  it("asks a language's shared edits of every live language's field rules when the shared part moves", async () => {
    await boot(
      posts({
        versions: { drafts: true },
        access: { read: () => true, update: () => true, publish: () => true },
        fields: [
          text({ name: "title", required: true }),
          text({
            name: "tagline",
            localized: false,
            access: { update: ({ locale }) => locale !== "es" },
          }),
        ],
      })
    );
    const id = await entry({ es: { title: "Hola" } });
    await t!.nextly.publish({
      collection: "posts",
      id,
      locales: "all",
      data: { _overwrite: true },
    });
    await t!.nextly.update({
      collection: "posts",
      id,
      locale: "en",
      data: { tagline: "Changed", _overwrite: true },
    });
    const publisher = await userWhoMay(t!, "publisher", "publish", ["posts"]);
    await grantTo(t!, publisher, "read", ["posts"]);
    await grantTo(t!, publisher, "update", ["posts"]);

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "posts",
        id,
        locales: ["en"],
        shared: true,
        overrideAccess: false,
        user: { id: publisher, email: "publisher@example.test", roles: [] },
        data: { _overwrite: true },
      })
    );
    const [main] = await t!.adapter.executeQuery<{ tagline: string }>(
      `SELECT ${q("tagline")} AS tagline FROM ${q("dc_posts")} WHERE ${q("id")} = '${id}'`
    );

    expect(refusal).toMatch(/tagline/);
    expect(main?.tagline).toBe("Shared");
  });

  // The value rules are judged again on the entry as the publish locks it: a change saved after
  // they were first judged is what goes live, so it is what they judge.
  it("judges the value rules again on the change the lock finds", async () => {
    let onAsk: (() => Promise<void>) | undefined;
    await boot(
      defineCollection({
        slug: "pages",
        localized: true,
        status: true,
        versions: { drafts: true },
        access: {
          read: () => true,
          update: () => true,
          // Asked in Spanish, once: the shared part is asked first, with no language.
          publish: async ({ locale }: { locale?: string }) => {
            if (locale === "es" && onAsk) {
              const once = onAsk;
              onAsk = undefined;
              await once();
            }
            return true;
          },
        },
        fields: [
          text({ name: "title" }),
          text({ name: "slug", required: true, unique: true }),
        ],
      } as never)
    );
    const created = await t!.nextly.create({
      collection: "pages",
      locale: "en",
      data: { title: "Hello", slug: "hola", status: "published" },
    });
    const id = String(created.item.id);
    // Spanish's pending change supplies its own slug, as the value rules first see it.
    await t!.nextly.update({
      collection: "pages",
      id,
      locale: "es",
      data: { title: "Hola", slug: "hola-es", _overwrite: true },
    });
    // While the rule is asked, another writer replaces Spanish's pending change with one that
    // has no slug of its own (an ordinary save keeps the slug a change already holds).
    onAsk = async () => {
      const where = {
        and: [
          { column: "entryId", op: "=" as const, value: id },
          { column: "locale", op: "=" as const, value: "es" },
          { column: "versionNo", op: "IS NULL" as const },
        ],
      };
      const [pending] = await t!.adapter.select<{ snapshot: unknown }>(
        "nextly_versions",
        { where }
      );
      const snapshot =
        typeof pending?.snapshot === "string"
          ? (JSON.parse(pending.snapshot) as Record<string, unknown>)
          : { ...(pending?.snapshot as Record<string, unknown>) };
      await t!.adapter.update(
        "nextly_versions",
        { snapshot: JSON.stringify({ ...snapshot, slug: "" }) },
        where
      );
    };
    const publisher = await userWhoMay(t!, "publisher", "publish", ["pages"]);
    await grantTo(t!, publisher, "read", ["pages"]);
    await grantTo(t!, publisher, "update", ["pages"]);

    const refusal = await refusalOf(
      t!.nextly.publish({
        collection: "pages",
        id,
        locales: ["es"],
        overrideAccess: false,
        user: { id: publisher, email: "publisher@example.test", roles: [] },
        data: { _overwrite: true },
      })
    );

    // The newer change was saved while the rule was asked, so the race happened.
    expect(onAsk).toBeUndefined();
    expect(refusal).toMatch(/UNIQUE_VALUE_REQUIRED_IN_LANGUAGE/);
    expect((await states(id, "dc_pages")).es ?? "none").not.toBe("published");
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

  // A gate decides by who is asking, so it is told: a person, an API key with its own grants,
  // or trusted code. A key is never passed off as the person who owns it.
  it("tells the gate an API key is asking, with the key's own grants", async () => {
    await boot(posts());
    const id = await entry({ es: { title: "Hola" } });
    const owner = await userWhoMay(t!, "owner", "read", ["posts"]);
    const asked: unknown[] = [];
    container.registerSingleton<PublishGate>("publishGate", () => ({
      refusals: question => {
        asked.push(question);
        return Promise.resolve([]);
      },
    }));
    const permissions = ["read-posts", "update-posts", "publish-posts"];
    const handler = t!.getService("collectionsHandler") as unknown as {
      publishParts(
        params: Record<string, unknown>,
        request: Record<string, unknown>
      ): Promise<{ success: boolean }>;
    };

    await handler.publishParts(
      {
        collectionName: "posts",
        entryId: id,
        user: { id: owner, email: "owner@example.test", roles: [] },
        overrideAccess: false,
        authenticatedScope: { actorType: "apiKey", permissions },
        data: { _overwrite: true },
      },
      { direction: "publish", locales: ["es"], describe: true }
    );

    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      caller: { kind: "api-key", userId: owner, scope: { permissions } },
    });
  });

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
    const created = await t!.nextly.create({
      collection: "pages",
      locale: "en",
      data: { title: "Hello", slug: "hola" },
    });
    const id = String(created.item.id);
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
    const created = await t!.nextly.create({
      collection: "pages",
      locale: "en",
      data: { title: "Hello", slug: "hola", status: "published" },
    });
    const id = String(created.item.id);
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
