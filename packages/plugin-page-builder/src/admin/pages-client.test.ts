// @vitest-environment jsdom
/**
 * What each Pages panel write asks of its route, and what it hands back.
 *
 * The properties that fail quietly are the ADDRESS and the ANSWER: a write
 * sent to a path or verb nothing serves, or an answer read from the wrong
 * place in the envelope, both look to an author like a page that did nothing.
 * The write goes through the SDK's `writePluginRoute`, stood in for here; that
 * the routes serve these paths is the integration suite's.
 *
 * @module admin/pages-client.test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const writePluginRoute = vi.hoisted(() => vi.fn());
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({ writePluginRoute }));

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  createPage,
  deletePage,
  duplicatePage,
  renamePage,
} from "./pages-client";

const item = {
  id: "p/1",
  collection: "pages",
  collectionLabel: "Page",
  field: "content",
  title: "About",
  status: "draft",
};

beforeEach(() => {
  writePluginRoute.mockReset();
  writePluginRoute.mockResolvedValue({ message: "Done.", item });
});

/** What the one write asked for. */
function asked(): Record<string, unknown> {
  expect(writePluginRoute).toHaveBeenCalledTimes(1);
  return writePluginRoute.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe("the Pages panel's writes", () => {
  it("creates by POST to the pages route, answering the page", async () => {
    expect(await createPage({ collection: "pages", title: "About" })).toBe(
      item
    );
    expect(asked()).toEqual({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: "/pages",
      method: "POST",
      body: { collection: "pages", title: "About" },
    });
  });

  it("duplicates by POST to the page's duplicate route, with no body", async () => {
    await duplicatePage({ collection: "pages", id: "p/1" });
    expect(asked()).toEqual({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      // The id is escaped, so one holding a slash stays one segment.
      path: "/pages/pages/p%2F1/duplicate",
      method: "POST",
    });
  });

  it("renames by PATCH with the title alone", async () => {
    await renamePage({ collection: "pages", id: "p1" }, "New");
    expect(asked()).toEqual({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: "/pages/pages/p1",
      method: "PATCH",
      body: { title: "New" },
    });
  });

  it("sends the page's version, as the list read it, with a rename", async () => {
    await renamePage({ collection: "pages", id: "p1", rev: "6" }, "New");
    expect(asked()).toMatchObject({
      method: "PATCH",
      body: { title: "New", rev: "6" },
    });
  });

  it("deletes by DELETE, answering which page it was", async () => {
    writePluginRoute.mockResolvedValue({
      message: "Done.",
      item: { collection: "pages", id: "p1" },
    });
    expect(await deletePage({ collection: "pages", id: "p1" })).toEqual({
      collection: "pages",
      id: "p1",
    });
    expect(asked()).toMatchObject({
      path: "/pages/pages/p1",
      method: "DELETE",
    });
  });

  it("rejects an answer that carries no page, rather than handing back nothing", async () => {
    writePluginRoute.mockResolvedValue(undefined);
    await expect(
      createPage({ collection: "pages", title: "About" })
    ).rejects.toThrow();
  });

  it("passes a refusal on as the SDK rejected it", async () => {
    const refusal = new Error("Forbidden");
    writePluginRoute.mockRejectedValue(refusal);
    await expect(deletePage({ collection: "pages", id: "p1" })).rejects.toBe(
      refusal
    );
  });
});
