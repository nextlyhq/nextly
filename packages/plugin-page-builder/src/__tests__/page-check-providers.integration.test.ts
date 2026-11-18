/**
 * Other plugins' page checks, end to end on a real server: a plugin
 * registers a provider through the page builder's `pageChecks` service from
 * its own `init`, before or after the page builder's, and the provided-checks
 * route runs it as the person asking, who must be signed in.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import type {
  PageCheckProvider,
  PageCheckProviderService,
} from "@nextlyhq/plugin-sdk/blocks";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { PROVIDED_CHECKS_ROUTE_PATH } from "../page-checks-provided-contract";
import { pageBuilder } from "../plugin";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

/** The fixture's check: a block saying "Fixture problem" is listed. */
const FIXTURE_PROVIDER: PageCheckProvider = {
  id: "fixture",
  group: "publishing",
  check: page => {
    const nodes = (page.document as { nodes?: unknown[] } | null)?.nodes ?? [];
    return Promise.resolve(
      nodes.flatMap(node => {
        const { id, props } = node as {
          id: string;
          props?: { text?: unknown };
        };
        return props?.text === "Fixture problem"
          ? [
              {
                nodeId: id,
                what: "Fixture problem found",
                why: "The fixture says so.",
                todo: "Change the words.",
                fix: { tab: "content" as const, id: "text" },
              },
            ]
          : [];
      })
    );
  },
};

/** A plugin registering the fixture's provider from its own `init`. */
function fixturePlugin(): PluginDefinition {
  return definePlugin({
    name: "@test/page-check-fixture",
    version: "1.0.0",
    nextly: ">=0.0.0",
    init(ctx) {
      const service = ctx.services.plugins[PAGE_BUILDER_PLUGIN_NAME]
        ?.pageChecks as PageCheckProviderService | undefined;
      service?.register(FIXTURE_PROVIDER);
    },
  });
}

const PAGE = {
  collection: "pages",
  entryId: null,
  document: {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "h",
        type: "core/heading",
        version: 1,
        props: { text: "Fixture problem", level: "h1" },
      },
    ],
  },
};

describe.each(getConfiguredTestDialects())(
  "other plugins' page checks (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly | undefined;

    afterEach(async () => {
      await t?.destroy();
      t = undefined;
    });

    async function boot(plugins: PluginDefinition[]): Promise<string> {
      t = await createTestNextly({ dialect, plugins, seedPublic: true });
      // The first user holds every permission.
      const owner = await t.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      const token = await signAccessToken(
        buildClaims({
          userId: owner.item.id,
          email: "owner@example.com",
          name: "Owner",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    async function ask(cookie: string | undefined) {
      const params = [
        "plugins",
        ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
        ...PROVIDED_CHECKS_ROUTE_PATH.split("/").filter(Boolean),
      ];
      const response = await createDynamicHandlers().POST(
        new Request(`${ORIGIN}/api/${params.join("/")}`, {
          method: "POST",
          headers: {
            ...(cookie === undefined
              ? {}
              : { cookie: `${cookie}; nextly_csrf=${CSRF}` }),
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify(PAGE),
        }),
        { params: Promise.resolve({ params }) }
      );
      return {
        status: response.status,
        body: (await response.json()) as unknown,
      };
    }

    const expected = {
      items: [
        {
          provider: "fixture",
          group: "publishing",
          ran: true,
          findings: [
            {
              nodeId: "h",
              what: "Fixture problem found",
              why: "The fixture says so.",
              todo: "Change the words.",
              fix: { tab: "content", id: "text" },
            },
          ],
        },
      ],
    };

    it.each([
      ["after the page builder's init", () => [pageBuilder(), fixturePlugin()]],
      [
        "before the page builder's init",
        () => [fixturePlugin(), pageBuilder()],
      ],
    ])("runs a provider registered %s", async (_order, plugins) => {
      const cookie = await boot(plugins());
      const answer = await ask(cookie);
      expect(answer.status).toBe(200);
      expect(answer.body).toMatchObject(expected);
    });

    it("refuses someone not signed in", async () => {
      await boot([pageBuilder(), fixturePlugin()]);
      const answer = await ask(undefined);
      expect([401, 403]).toContain(answer.status);
    });
  }
);
