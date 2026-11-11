/**
 * A deploy that moves a published page's address, found by the catch-up at
 * the next start, leaves a permanent redirect from the old address, as a
 * save would. The route has already moved, so a redirect that cannot be
 * saved does not keep the old address: it is listed as a broken link. A page
 * left without an address by a clash gets no redirect to the address it lost.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { definePlugin, type PluginContext } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { defineCollection, text } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { catchUp, lastCatchUp } from "../../address-record/catch-up";
import { ADDRESS_RECORD_SLUG } from "../../address-record/collection";
import { claimKey } from "../../address-record/participant";
import { NOT_FOUND_SLUG } from "../../not-found/collection";
import { seoPlugin } from "../../plugin";
import { REDIRECTS_SLUG } from "../collection";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const faults = { failRedirects: false };

async function boot(dialect: TestDialect) {
  faults.failRedirects = false;
  current = await createTestNextly({
    dialect,
    plugins: [
      seoPlugin({ collections: ["pages", "posts"] }),
      definePlugin({
        name: "@test/redirect-faults",
        version: "1.0.0",
        nextly: ">=0.0.0",
        init(ctx: PluginContext) {
          ctx.hooks.on("beforeCreate", REDIRECTS_SLUG, () => {
            if (faults.failRedirects)
              throw new Error("the redirect store is down");
          });
        },
      }),
    ],
    collections: ["pages", "posts"].map(slug =>
      defineCollection({
        slug,
        status: true,
        fields: [text({ name: "title" }), text({ name: "slug" })],
        publicAddress: "/{slug}",
      })
    ),
  });
  return current;
}

async function publish(t: TestNextly, collection: string, slug: string) {
  const created = await t.nextly.create({
    collection,
    data: { title: slug, slug, status: "published" },
  });
  return String(created.item.id);
}

async function rows(t: TestNextly) {
  const { items } = await t.nextly.find({
    collection: ADDRESS_RECORD_SLUG,
    limit: 500,
  });
  return items as Record<string, unknown>[];
}

/**
 * Make the record say `holder` holds `path`, as it did before a deploy moved
 * the page, and forget the fingerprint, as the changed template would.
 */
async function heldBeforeTheDeploy(
  t: TestNextly,
  holder: { collection: string; id: string },
  path: string
) {
  for (const row of await rows(t)) {
    if (
      row.holderCollection === holder.collection &&
      row.holderId === holder.id
    ) {
      await t.nextly.update({
        collection: ADDRESS_RECORD_SLUG,
        id: String(row.id),
        data: {
          path,
          claimKey: claimKey("address", "en", path),
          _overwrite: true,
        },
      });
    }
    if (row.kind === "meta" && !String(row.path).startsWith("[")) {
      await t.nextly.delete({
        collection: ADDRESS_RECORD_SLUG,
        id: String(row.id),
      });
    }
  }
}

/** Run the catch-up again, as the next start would. */
async function restart() {
  if (lastCatchUp() === undefined) throw new Error("no catch-up ever started");
  return catchUp();
}

async function redirects(t: TestNextly) {
  const { items } = await t.nextly.find({
    collection: REDIRECTS_SLUG,
    limit: 500,
  });
  return Object.fromEntries(
    (items as Record<string, unknown>[]).map(row => [
      `${row.locale}|${row.source}`,
      `${row.target} ${row.permanent ? "permanent" : "temporary"} ${row.origin}`,
    ])
  );
}

async function notFound(t: TestNextly) {
  const { items } = await t.nextly.find({
    collection: NOT_FOUND_SLUG,
    limit: 500,
  });
  return (items as Record<string, unknown>[]).map(
    row => `${row.path} ${row.kind}`
  );
}

async function held(t: TestNextly) {
  return Object.fromEntries(
    (await rows(t))
      .filter(row => row.kind === "address")
      .map(row => [`${row.locale}|${row.path}`, String(row.holderCollection)])
  );
}

describe.each(getConfiguredTestDialects())("a deploy's moves (%s)", dialect => {
  it("leave a permanent redirect from the address a page held before", async () => {
    const t = await boot(dialect);
    const page = await publish(t, "pages", "new");
    await restart();
    await heldBeforeTheDeploy(t, { collection: "pages", id: page }, "/old");

    await restart();

    expect(await redirects(t)).toEqual({
      "en|/old": "/new permanent automatic",
    });
    expect(await held(t)).toEqual({
      "en|/new": "pages",
      "en|/old": REDIRECTS_SLUG,
    });
  });

  it("send a page's old address to that page, when another page moves on from its new one", async () => {
    const t = await boot(dialect);
    // After the deploy, A is at `/b`, and B, which was at `/b`, is at `/c`.
    const a = await publish(t, "pages", "b");
    const b = await publish(t, "posts", "c");
    await restart();
    await heldBeforeTheDeploy(t, { collection: "pages", id: a }, "/a");
    await heldBeforeTheDeploy(t, { collection: "posts", id: b }, "/b");

    await restart();

    expect(await redirects(t)).toEqual({ "en|/a": "/b permanent automatic" });
    expect(await held(t)).toEqual({
      "en|/a": REDIRECTS_SLUG,
      "en|/b": "pages",
      "en|/c": "posts",
    });
  });

  it("list the old address as a broken link where its redirect cannot be saved", async () => {
    const t = await boot(dialect);
    const page = await publish(t, "pages", "new");
    await restart();
    await heldBeforeTheDeploy(t, { collection: "pages", id: page }, "/old");
    faults.failRedirects = true;

    await restart();

    expect(await redirects(t)).toEqual({});
    expect(await held(t)).toEqual({ "en|/new": "pages" });
    expect(await notFound(t)).toEqual(["/old moved"]);
  });

  it("leave no redirect to an address the page then lost to the page already holding it", async () => {
    const t = await boot(dialect);
    const holder = await publish(t, "pages", "new");
    await restart();
    // Made where a save could not refuse it: the record forgets the page
    // holding `/new` while a second page is published there.
    for (const row of await rows(t)) {
      await t.nextly.delete({
        collection: ADDRESS_RECORD_SLUG,
        id: String(row.id),
      });
    }
    const loser = await publish(t, "posts", "new");
    await heldBeforeTheDeploy(t, { collection: "posts", id: loser }, "/old");
    await t.nextly.create({
      collection: ADDRESS_RECORD_SLUG,
      data: {
        claimKey: claimKey("address", "en", "/new"),
        kind: "address",
        locale: "en",
        path: "/new",
        holderCollection: "pages",
        holderId: holder,
      },
    });

    const report = await restart();

    expect(report.lost.map(lost => lost.holder.id)).toEqual([loser]);
    expect(await redirects(t)).toEqual({});
    expect(await held(t)).toEqual({ "en|/new": "pages" });
  });
});
