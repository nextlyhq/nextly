/**
 * Adding a collection adds no widget, on every configured dialect.
 *
 * A card about one collection is a core widget (`core/count`,
 * `core/breakdown`, `core/over-time`, `core/recent-entries`) set to it, so the
 * install's widget ids do not depend on its content. Asserted on the two
 * answers every dashboard surface reads: the registry's canonical set
 * (`allWidgets`), and what one reader's audience is told (`widgetAudience`),
 * before and after a collection is created at runtime through the Schema
 * Builder's own path -- the case a card minted per collection existed for.
 *
 * The collection's widget SOURCE is the positive control: it appears after the
 * create, so the refresh did see the new collection, and the unchanged ids
 * are not a refresh that read nothing.
 */
import { afterEach, beforeEach, expect, it } from "vitest";

import { readAccessCaller } from "../../../api/authenticated-read";
import { defineCollection, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { allWidgets } from "../canonical";
import { refreshContentSources } from "../content-sources";
import { clearSources, listSources } from "../sources";
import { widgetAudience } from "../visibility";

/** Prefixed for this file: on PostgreSQL and MySQL the tables outlive a run on a reused database. */
const PRESENT = "nwc_present";
const ADDED = "nwc_added";

describeEachDialect("adding a collection adds no widget", dialect => {
  let handle: TestNextly | undefined;
  let owner: ReadCaller;
  // The Schema Builder's create runs its migration only in development, so
  // the new collection's table, and with it its widget source, exist only
  // there.
  let previousNodeEnv: string | undefined;

  beforeEach(async () => {
    previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    handle = await createTestNextly({
      dialect,
      collections: [
        defineCollection({ slug: PRESENT, fields: [text({ name: "title" })] }),
      ],
    });
    owner = await firstUser(handle);
    // A cold process: the sources below are the refresh's own work.
    clearSources();
  });

  afterEach(async () => {
    clearSources();
    await handle?.destroy();
    handle = undefined;
    process.env.NODE_ENV = previousNodeEnv;
  });

  /** The widget ids the registry has, and the ones this reader is told about. */
  async function widgetIds() {
    await refreshContentSources();
    const audience = await widgetAudience(readAccessCaller(owner));
    return {
      registry: allWidgets().map(widget => widget.id),
      visible: audience.visible.map(widget => widget.id),
      declared: [...audience.declared],
      collections: [...audience.readableCollections].sort(),
    };
  }

  it("leaves the registry's widget ids and the reader's audience as they were", async () => {
    const before = await widgetIds();
    // The population: the reader is told about core's widgets, so the
    // comparison below is between two non-empty answers.
    expect(before.visible).toEqual(expect.arrayContaining(["core/count"]));
    expect(before.collections).toEqual([PRESENT]);

    const handler = handle!.getService("collectionsHandler") as unknown as {
      createCollection: (
        data: Record<string, unknown>
      ) => Promise<{ success: boolean }>;
    };
    const created = await handler.createCollection({
      name: ADDED,
      label: "Added",
      fields: [{ name: "title", type: "text" }],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);

    const after = await widgetIds();
    // The control: the new collection reached the refresh, as a source a card
    // may be set to.
    expect(
      listSources().some(source => source.id === `collection:${ADDED}`)
    ).toBe(true);
    expect(after.collections).toEqual([ADDED, PRESENT].sort());
    // 🔴 And no widget id came with it, on either answer.
    expect(after.registry).toEqual(before.registry);
    expect(after.visible).toEqual(before.visible);
    expect(after.declared).toEqual(before.declared);
    expect(
      after.registry.filter(
        id => id.startsWith("collection/") || id.startsWith("single/")
      )
    ).toEqual([]);
  });
});

/** The install's first account, which core makes its super-admin. */
async function firstUser(handle: TestNextly): Promise<ReadCaller> {
  const nextly = handle.nextly as unknown as {
    users: {
      create: (a: { data: Record<string, unknown> }) => Promise<{
        item: { id: string };
      }>;
    };
  };
  const created = await nextly.users.create({
    data: {
      email: "owner@example.com",
      password: "Password123!",
      name: "Owner",
      isActive: true,
    },
  });
  return { user: { id: created.item.id, roles: ["super-admin"] } };
}
