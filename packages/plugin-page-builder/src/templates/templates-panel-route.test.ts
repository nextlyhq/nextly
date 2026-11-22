/**
 * The Pages panel's templates read: each collection template the caller may
 * see, of a collection they may read, with its collection's name, its
 * published document for its picture, and the entries it draws: the
 * collection's entries less those with a design of their own.
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import {
  readTemplatesPanel,
  type TemplatesPanelReads,
} from "./templates-panel-route";

const doc = (id: string): BlockDocument =>
  ({
    formatVersion: 1,
    kind: "template",
    nodes: [{ id, type: "core/heading", version: 1, props: {} }],
  }) as unknown as BlockDocument;

function reads(over: Partial<TemplatesPanelReads> = {}): TemplatesPanelReads {
  return {
    templatesCollection: "templates",
    collections: vi.fn(async () => [
      { slug: "posts", label: "Blog posts" },
      { slug: "events", label: "Events" },
    ]),
    templates: vi.fn(async () => [
      {
        id: "t1",
        title: "Blog post",
        collection: "posts",
        status: "published",
      },
      { id: "t2", title: "Event", collection: "events", status: "draft" },
    ]),
    publishedDocuments: vi.fn(async () => new Map([["t1", doc("n1")]])),
    entryCount: vi.fn(async (slug: string) => (slug === "posts" ? 12 : 3)),
    ownDesignCount: vi.fn(async (slug: string) => (slug === "posts" ? 2 : 0)),
    definitions: vi.fn(async () => ({ logo: doc("l") })),
    mayCreateTemplates: vi.fn(async () => true),
    ...over,
  };
}

describe("the Pages panel's templates read", () => {
  it("lists each template with its collection's name, its published document and the entries it draws", async () => {
    const answer = await readTemplatesPanel(reads());
    expect(answer.items).toEqual([
      {
        id: "t1",
        title: "Blog post",
        collection: "posts",
        collectionLabel: "Blog posts",
        published: true,
        document: doc("n1"),
        use: { entries: 10 },
      },
      {
        id: "t2",
        title: "Event",
        collection: "events",
        collectionLabel: "Events",
        published: false,
        document: null,
        use: { entries: 3 },
      },
    ]);
    expect(answer.meta).toEqual({
      templatesCollection: "templates",
      canCreateTemplates: true,
      definitions: { logo: doc("l") },
    });
  });

  it("asks only for templates of the collections the caller may read, and only published documents", async () => {
    const given = reads();
    await readTemplatesPanel(given);
    expect(given.templates).toHaveBeenCalledWith(["posts", "events"]);
    expect(given.publishedDocuments).toHaveBeenCalledWith(["t1"]);
    expect(given.definitions).toHaveBeenCalledWith([doc("n1")]);
  });

  it("reads nothing more when no collection may have a template the caller can see", async () => {
    const given = reads({ collections: vi.fn(async () => []) });
    const answer = await readTemplatesPanel(given);
    expect(answer.items).toEqual([]);
    expect(given.templates).not.toHaveBeenCalled();
  });

  it("never counts fewer than no entries", async () => {
    const answer = await readTemplatesPanel(
      reads({ ownDesignCount: vi.fn(async () => 50) })
    );
    expect(answer.items.map(item => item.use.entries)).toEqual([0, 0]);
  });
});
