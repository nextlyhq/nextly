/**
 * The SEO plugin's page checks in the page builder, on a real server with
 * both plugins: the problems the problem list shows on a page, those it
 * finds only by comparing pages among them, are listed by the page builder's
 * provided-checks route under Search, in the list's own words, a fix in the
 * page's SEO tab opening the builder's SEO tab.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { pageBuilder } from "@nextlyhq/plugin-page-builder";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seoPlugin } from "../plugin";
import { PROBLEMS_SLUG } from "../problems/store";
import { PAGE_BUILDER_TAB } from "../template/contributions";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
const ROUTE = [
  "plugins",
  "@nextlyhq",
  "plugin-page-builder",
  "page-checks",
  "provided",
];

describe.each(getConfiguredTestDialects())(
  "the SEO plugin's page checks (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let cookie = "";

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        plugins: [pageBuilder(), seoPlugin({ collections: ["posts"] })],
        collections: [
          defineCollection({
            slug: "posts",
            status: true,
            access: { read: () => true },
            fields: [text({ name: "title" }), text({ name: "slug" })],
            publicAddress: "/blog/{slug}",
          }),
        ],
        // Visitors read published templates, as a site seeds them to.
        seedPublic: true,
      });
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
      cookie = `nextly_session=${token}`;
    });

    afterAll(async () => {
      await t?.destroy();
    });

    /** A published page, once the check its save starts has kept its row. */
    async function publish(title: string, slug: string): Promise<string> {
      const created = await t.nextly.create({
        collection: "posts",
        data: { title, slug, status: "published" },
      });
      const id = String(created.item.id);
      for (let tries = 0; tries < 100; tries++) {
        const { items } = await t.nextly.find({
          collection: PROBLEMS_SLUG,
          where: { holderId: { equals: id } },
          overrideAccess: true,
        });
        if (items.length > 0) return id;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error("the page's check never finished");
    }

    /** The SEO provider's item in the page builder's provided checks for `id`. */
    async function seoChecksOf(id: string) {
      const response = await createDynamicHandlers().POST(
        new Request(`${ORIGIN}/api/${ROUTE.join("/")}`, {
          method: "POST",
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            collection: "posts",
            entryId: id,
            document: { formatVersion: 1, kind: "page", nodes: [] },
          }),
        }),
        { params: Promise.resolve({ params: ROUTE }) }
      );
      expect(response.status).toBe(200);
      const { items } = (await response.json()) as {
        items: {
          provider: string;
          group: string;
          ran: boolean;
          findings: { part: string; fix?: unknown }[];
        }[];
      };
      return items.find(item => item.provider === "seo");
    }

    it("lists the page's problems under Search, those found among pages too", async () => {
      const a = await publish("Harbour", "a");
      await publish("Harbour", "b");
      const seo = await seoChecksOf(a);
      expect(seo).toMatchObject({
        provider: "seo",
        group: "search",
        ran: true,
      });
      const findings = seo?.findings ?? [];
      // Kept with the page's row: a description is set in the page's SEO tab.
      expect(findings).toContainEqual(
        expect.objectContaining({
          part: "noDescription",
          fix: { settingsTab: PAGE_BUILDER_TAB.id },
        })
      );
      // Found only by the list, comparing the page with the other.
      expect(findings.map(each => each.part)).toContain("sharedTitle");
    });

    it("lists what the page's save found, asked for at once after it", async () => {
      const a = await publish("Lighthouse", "c");
      await publish("Lighthouse", "d");
      expect((await seoChecksOf(a))?.findings.map(each => each.part)).toContain(
        "sharedTitle"
      );
      // Saved with a title of its own and asked about straight away, before
      // the check the save started has had time to finish.
      await t.nextly.update({
        collection: "posts",
        id: a,
        data: { title: "Pier", _overwrite: true },
      });
      const parts = (await seoChecksOf(a))?.findings.map(each => each.part);
      expect(parts).not.toContain("sharedTitle");
      expect(parts).toContain("noDescription");
    });
  }
);
