/**
 * The form receiver as a visitor reaches it: a post through core's own
 * request handler to the plugin's public route, read against documents
 * stored and published on every configured dialect, with core's own limiter.
 *
 * What is held here and only here: the route is public and reached; the form
 * is found in each kind of document that can define one, as PUBLISHED, so a
 * form only a draft holds is refused; a provider another plugin registers
 * from its `init` is the one handed the post; the eleventh send in a minute
 * is refused by core's limiter; and no answer reaches a log.
 *
 * The rest of the receiver's rules are held by `forms/receiver.test.ts`.
 *
 * @module __tests__/form-receiver.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { BlockNode } from "@nextlyhq/blocks-engine";
import { definePlugin } from "@nextlyhq/plugin-sdk";
import type {
  FormPost,
  FormProvider,
  FormProviderService,
} from "@nextlyhq/plugin-sdk/blocks";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly/config";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { TEMPLATES_SLUG } from "../collections/templates";
import { FORM_SERVICE } from "../forms/providers";
import { FORM_RECEIVER_PATH } from "../forms/route";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

/** What the test provider was handed, post by post. */
const accepted: { ref: string; answers: [string, readonly string[]][] }[] = [];

/** A provider with any form, taking an email, as another plugin registers it. */
const acme: FormProvider = {
  id: "acme",
  label: "Acme forms",
  list: async () => [],
  describe: async ref => ({
    ref,
    title: ref,
    fields: [{ name: "email", label: "Email", kind: "email" }],
    submitText: "Send",
    afterSending: { kind: "message", message: "Thanks." },
    encoding: "urlencoded",
  }),
  accept: async (ref: string, post: FormPost) => {
    accepted.push({ ref, answers: [...post.answers] });
    return { kind: "sent" };
  },
};

const acmePlugin = definePlugin({
  name: "@test/acme-forms",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init: ctx => {
    const service = ctx.services.plugins[PAGE_BUILDER_PLUGIN_NAME]?.[
      FORM_SERVICE
    ] as FormProviderService;
    service.register(acme);
  },
} as never);

/** A form node picking the test provider's form `ref`. */
const picked = (id: string, ref: string): BlockNode => ({
  id,
  type: "core/form",
  version: 1,
  props: { form: { provider: "acme", ref } },
});

/** A blocks document of `kind` holding `nodes`. */
const documentOf = (kind: string, nodes: BlockNode[]) => ({
  formatVersion: 1,
  kind,
  nodes,
});

/** The route's own path segments under the dispatcher. */
const SEGMENTS = [
  "plugins",
  ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
  ...FORM_RECEIVER_PATH.slice(1).split("/"),
];

/** One visitor's post, through core's request handler. */
async function send(fields: Record<string, string>): Promise<Response> {
  const request = new Request(`http://localhost/api/${SEGMENTS.join("/")}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ _return: "/contact", _hp: "", ...fields }),
  });
  return createDynamicHandlers().POST(request, {
    params: Promise.resolve({ params: SEGMENTS }),
  });
}

/** Where a post sent the visitor. */
function landed(response: Response): string | null {
  expect(response.status).toBe(303);
  return response.headers.get("location");
}

/** A created document's id, from the mutation envelope `{ message, item }`. */
const idOf = (created: unknown): string =>
  String((created as { item: { id: string | number } }).item.id);

let current: TestNextly | undefined;
const servers: Server[] = [];

afterEach(async () => {
  accepted.length = 0;
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

describe.each(getConfiguredTestDialects())(
  "the form receiver (%s)",
  (dialect: TestDialect) => {
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), acmePlugin],
        collections: [
          defineCollection({
            slug: "articles",
            fields: [text({ name: "title" })],
          }),
        ],
        seedPublic: true,
      });
      return current;
    }

    it("finds the form in each kind of published document, and only as published", async () => {
      const t = await boot();
      // A server on the loopback, which the simple form below names: the
      // guard must refuse it before anything connects.
      let reached = 0;
      const server = createServer((_, response) => {
        reached += 1;
        response.end();
      });
      servers.push(server);
      await new Promise<void>(resolve =>
        server.listen(0, "127.0.0.1", resolve)
      );
      const { port } = server.address() as AddressInfo;

      const pageId = idOf(
        await t.nextly.create({
          collection: "pages",
          data: {
            title: "Contact",
            slug: "contact",
            content: documentOf("page", [
              {
                id: "box",
                type: "core/section",
                version: 1,
                props: {},
                slots: { children: [picked("on-page", "page-form")] },
              },
              {
                id: "simple",
                type: "core/form",
                version: 1,
                props: {
                  action: `https://127.0.0.1:${port}/hook`,
                  fields: [{ name: "email", type: "email" }],
                },
              },
            ]),
            status: "published",
          },
          overrideAccess: true,
        })
      );
      // A working draft adds a form the published page does not have.
      await t.nextly.update({
        collection: "pages",
        id: pageId,
        data: {
          content: documentOf("page", [
            picked("on-page", "page-form"),
            picked("draft-only", "draft-form"),
          ]),
          _overwrite: true,
        },
        draft: true,
        overrideAccess: true,
      });
      const draft = (await t.nextly.findByID({
        collection: "pages",
        id: pageId,
        status: "all",
        draft: true,
        depth: 0,
        overrideAccess: true,
      })) as unknown as { content: { nodes: BlockNode[] } };
      // The control: the draft really holds the draft-only form.
      expect(draft.content.nodes.map(node => node.id)).toContain("draft-only");

      const componentId = idOf(
        await t.nextly.create({
          collection: COMPONENTS_SLUG,
          data: {
            title: "Signup",
            slug: "signup",
            content: documentOf("component", [
              picked("in-component", "component-form"),
            ]),
            status: "published",
          },
          overrideAccess: true,
        })
      );
      const layoutId = idOf(
        await t.nextly.create({
          collection: LAYOUTS_SLUG,
          data: {
            title: "Main",
            slug: "main",
            areas: [{ area: "header", component: componentId }],
            status: "published",
          },
          overrideAccess: true,
        })
      );
      const templateId = idOf(
        await t.nextly.create({
          collection: TEMPLATES_SLUG,
          data: {
            title: "Article page",
            collection: "articles",
            content: documentOf("template", [
              picked("in-template", "template-form"),
            ]),
            status: "published",
          },
          overrideAccess: true,
        })
      );

      const said: string[] = [];
      for (const method of ["log", "info", "warn", "error", "debug"] as const) {
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          said.push(args.map(String).join(" "));
        });
      }
      const answer = { email: "unique-7f3c@example.com", extra: "dropped" };
      const cases: [string, string, string][] = [
        [`page:${pageId}`, "on-page", "page-form"],
        [`template:${templateId}`, "in-template", "template-form"],
        [`component:${componentId}`, "in-component", "component-form"],
        [`layout:${layoutId}:header`, "in-component", "component-form"],
      ];
      for (const [document, node, ref] of cases) {
        const response = await send({
          ...answer,
          _form: document,
          _node: node,
        });
        expect(landed(response), document).toBe(`/contact#form-${node}-sent`);
        expect(accepted.at(-1), document).toEqual({
          ref,
          answers: [["email", ["unique-7f3c@example.com"]]],
        });
      }
      expect(accepted.length).toBe(cases.length);

      // Only in the draft: refused, and the provider is asked nothing.
      expect(
        landed(
          await send({
            ...answer,
            _form: `page:${pageId}`,
            _node: "draft-only",
          })
        )
      ).toBe("/contact#form-draft-only-error");
      // A node the page does not hold at all.
      expect(
        landed(
          await send({ ...answer, _form: `page:${pageId}`, _node: "nowhere" })
        )
      ).toBe("/contact#form-nowhere-error");
      // A filled trap: answered as sent, handed to nobody.
      expect(
        landed(
          await send({
            ...answer,
            _form: `page:${pageId}`,
            _node: "on-page",
            _hp: "x",
          })
        )
      ).toBe("/contact#form-on-page-sent");
      expect(accepted.length).toBe(cases.length);

      // A simple form whose address is the loopback: refused, never reached.
      expect(
        landed(
          await send({ ...answer, _form: `page:${pageId}`, _node: "simple" })
        )
      ).toBe("/contact#form-simple-error");
      expect(reached).toBe(0);

      expect(said.join("\n")).not.toContain("unique-7f3c");
    });

    it("refuses the eleventh send in a minute", async () => {
      const t = await boot();
      const pageId = idOf(
        await t.nextly.create({
          collection: "pages",
          data: {
            title: "Contact",
            slug: "contact",
            content: documentOf("page", [picked("f", "contact")]),
            status: "published",
          },
          overrideAccess: true,
        })
      );
      const post = { _form: `page:${pageId}`, _node: "f", email: "a@b.co" };
      for (let count = 1; count <= 10; count += 1) {
        expect(landed(await send(post)), `send ${count}`).toBe(
          "/contact#form-f-sent"
        );
      }
      const eleventh = await send(post);

      expect(landed(eleventh)).toBe("/contact#form-f-error");
      expect(Number(eleventh.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(accepted.length).toBe(10);
    });
  }
);
