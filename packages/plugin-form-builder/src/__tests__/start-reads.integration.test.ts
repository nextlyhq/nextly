/**
 * What the plugin's start costs the database, on every dialect, and that what
 * it no longer reads there is still answered.
 *
 * A start used to read the forms, only to warn about a bot check missing its
 * keys, and each redirect target's registry row, only for its `localized`
 * setting, which the configuration already declares. Here the plugin is
 * started again against a database it has already started on, with every
 * statement the driver is handed recorded, and then each answer those reads
 * gave is asked for where it is now made: the warning when a form names such
 * a check and when a submission is accepted unchecked, and the redirect for a
 * localized and a plain target.
 */
import type { PluginContext, PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createPluginContext } from "nextly";
import { defineCollection, text } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { submitForm } from "../handlers/submit-form";
import { formBuilder } from "../plugin";

import { statementsOf, writesAmong } from "./count-statements";

/** The services the harness does not register; see `redirect-to-page`. */
const RAW_DB_HANDLES = new Set(["db", "relations"]);

/**
 * How long the registry keeps a row it read (`COLLECTION_ROW_LIFETIME_MS` in
 * core), and a little over: a start made sooner would be answered from the
 * row the boot read, and send no statement whether or not it asks.
 */
const REGISTRY_ROW_LIFETIME_MS = 1_100;

/** Every collection the forms redirect to, one localized and one not. */
const targets = [
  defineCollection({
    slug: "pages",
    localized: true,
    status: true,
    fields: [text({ name: "title" }), text({ name: "slug", localized: true })],
  }),
  defineCollection({
    slug: "articles",
    status: true,
    fields: [text({ name: "title" }), text({ name: "slug" })],
  }),
];

/** The site's statements, quoted however the dialect quotes them. */
function naming(statements: readonly string[], table: string): string[] {
  const quoted = new RegExp(`["\`]${table}["\`]`);
  return statements.filter(statement => quoted.test(statement));
}

/**
 * `ctx` with a registry that refuses every collection lookup, so an answer
 * the plugin still gives cannot have come from the registry.
 */
function withRefusingRegistry(ctx: PluginContext): PluginContext {
  const refuse = async () => {
    throw new Error("the registry was asked");
  };
  return new Proxy(ctx, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (key !== "services") return value;
      return new Proxy(value as object, {
        get(services, name, servicesReceiver) {
          const service: unknown = Reflect.get(
            services,
            name,
            servicesReceiver
          );
          if (name !== "collections") return service;
          return new Proxy(service as object, {
            get(collections, method, collectionsReceiver) {
              return method === "getCollection"
                ? refuse
                : Reflect.get(collections, method, collectionsReceiver);
            },
          });
        },
      });
    },
  });
}

describe.each(getConfiguredTestDialects())(
  "the plugin's start (%s)",
  dialect => {
    let current: TestNextly | undefined;
    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /**
     * A site with a form whose bot check names Turnstile, which has no keys,
     * and both redirect targets, with each warning the plugin logs recorded.
     */
    async function boot(
      options: {
        wrap?: (plugin: PluginDefinition) => PluginDefinition;
        spamProtection?: Record<string, unknown>;
      } = {}
    ) {
      const fb = formBuilder({
        redirectRelationships: { pages: "/{slug}", articles: "/a/{slug}" },
        spamProtection: { honeypot: false, ...options.spamProtection },
      });
      const warn = vi.fn();
      current = await createTestNextly({
        dialect,
        plugins: [options.wrap ? options.wrap(fb.plugin) : fb.plugin],
        collections: targets,
        localization: { locales: ["en", "fr"], defaultLocale: "en" },
        seedPublic: true,
        logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
      });
      return { fb, warn, harness: current };
    }

    /** The warnings logged about a bot check missing its keys. */
    const keyWarnings = (warn: ReturnType<typeof vi.fn>) =>
      warn.mock.calls.filter(([message]) =>
        /bot check is in use without both of its keys/.test(String(message))
      );

    /** A form, published, as the forms collection saves one. */
    const saveForm = (
      harness: TestNextly,
      slug: string,
      settings: Record<string, unknown>
    ) =>
      harness.nextly.create({
        collection: "forms",
        data: {
          name: slug,
          slug,
          status: "published",
          fields: [{ type: "text", name: "message", label: "Message" }],
          settings: { honeypotEnabled: false, ...settings },
        },
      });

    /** A plugin context of the plugin's own, as a fresh start builds one. */
    const contextOf = (harness: TestNextly, plugin: PluginDefinition) => {
      const getService = ((name: string) =>
        RAW_DB_HANDLES.has(name)
          ? {}
          : harness.getService(name as never)) as never;
      return createPluginContext(
        getService,
        harness.hooks as never,
        plugin as never
      ) as PluginContext;
    };

    it("reads no form and no redirect target's registry row, and writes nothing", async () => {
      const { fb, harness } = await boot();
      await saveForm(harness, "contact", { botCheck: "turnstile" });
      await new Promise(resolve =>
        setTimeout(resolve, REGISTRY_ROW_LIFETIME_MS)
      );

      const ctx = contextOf(harness, fb.plugin);
      const statements = await statementsOf(dialect, async () => {
        await fb.plugin.init?.(ctx as never);
        // Work the start sets off without waiting for it is a start's cost too.
        await new Promise(resolve => setTimeout(resolve, 300));
      });

      // The control: the recorder sees the start, which reads its digest key.
      expect(naming(statements, "nextly_meta")).not.toEqual([]);
      expect(naming(statements, "dc_forms")).toEqual([]);
      expect(naming(statements, "dynamic_collections")).toEqual([]);
      expect(writesAmong(statements)).toEqual([]);
    });

    it("says at start, from the options, that the site default has no keys", async () => {
      const { warn } = await boot({
        spamProtection: { recaptcha: { enabled: true } },
      });

      const said = keyWarnings(warn);
      expect(said).toHaveLength(1);
      expect(String(said[0]?.[0])).toMatch(
        /spamProtection\.recaptcha\.secretKey/
      );
      expect(said[0]?.[1]).toMatchObject({ provider: "recaptcha" });
    });

    it("warns when a form is saved naming a check that has no keys", async () => {
      const { warn, harness } = await boot();
      expect(keyWarnings(warn)).toEqual([]);

      await saveForm(harness, "contact", { botCheck: "turnstile" });

      const said = keyWarnings(warn);
      expect(said).toHaveLength(1);
      expect(String(said[0]?.[0])).toMatch(
        /spamProtection\.turnstile\.secretKey/
      );
      expect(said[0]?.[1]).toMatchObject({
        provider: "turnstile",
        form: "contact",
      });
    });

    it("does not warn for a form whose check is off or ready", async () => {
      const { warn, harness } = await boot({
        spamProtection: {
          turnstile: { enabled: false, siteKey: "site", secretKey: "secret" },
        },
      });

      await saveForm(harness, "off", { botCheck: "off" });
      await saveForm(harness, "ready", { botCheck: "turnstile" });

      expect(keyWarnings(warn)).toEqual([]);
    });

    it("warns once when a submission is accepted unchecked for want of keys", async () => {
      const { warn, harness } = await boot();
      await saveForm(harness, "contact", { botCheck: "turnstile" });
      warn.mockClear();

      const handlers = createDynamicHandlers();
      const post = async () =>
        (
          await handlers.POST(
            new Request("http://localhost/api/forms/contact/submit", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ data: { message: "hello" } }),
            }),
            {
              params: Promise.resolve({
                params: ["forms", "contact", "submit"],
              }),
            }
          )
        ).status;

      expect(await post()).toBe(201);
      const said = keyWarnings(warn);
      expect(said).toHaveLength(1);
      expect(said[0]?.[1]).toMatchObject({
        provider: "turnstile",
        form: "contact",
      });

      // Said once for the process, not once per submission.
      expect(await post()).toBe(201);
      expect(keyWarnings(warn)).toHaveLength(1);
    });

    it("resolves each redirect from the target's declared setting, without the registry", async () => {
      // The plugin's start is handed a registry that refuses every lookup, so
      // the redirects below can only be right if the configuration answered.
      const { fb, harness } = await boot({
        wrap: plugin => ({
          ...plugin,
          init: ctx => plugin.init?.(withRefusingRegistry(ctx)),
        }),
      });
      const target = async (collection: string, slug: string) => {
        const made = await harness.nextly.create({
          collection,
          data: { title: slug, slug, status: "published" },
        });
        const id = (made as { item: { id: string } }).item.id;
        await saveForm(harness, `to-${collection}`, {
          confirmationType: "relationship",
          redirectPage: { relationTo: collection, value: id },
        });
        // Unpublished after the form was saved: its main row now reads draft.
        await harness.nextly.update({
          collection,
          id,
          data: { status: "draft", _overwrite: true },
        });
      };
      await target("pages", "localized-page");
      await target("articles", "plain-article");

      const ctx = contextOf(harness, fb.plugin);
      const submit = (formSlug: string) =>
        submitForm(
          { formSlug, data: { message: "hello" } },
          { pluginContext: ctx, pluginConfig: fb.config }
        );

      // A localized target's main row does not answer for its translations, so
      // the redirect stands; a plain target's does, so it is dropped.
      const toPage = await submit("to-pages");
      expect(toPage.success).toBe(true);
      expect(toPage.redirect).toBe("/localized-page");
      const toArticle = await submit("to-articles");
      expect(toArticle.success).toBe(true);
      expect(toArticle.redirect).toBeUndefined();
      expect(fb.config.redirectTargetLocalization).toEqual({
        pages: true,
        articles: false,
      });
    });
  }
);
