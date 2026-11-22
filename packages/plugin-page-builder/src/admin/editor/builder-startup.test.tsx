// @vitest-environment jsdom

/**
 * The editor sends the builder's start-up read once as it opens, naming each
 * read by the path its own hook asks, and sends it again only for another
 * person; signing out or closing the editor drops what was read.
 *
 * @module admin/editor/builder-startup.test
 */
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const who = vi.hoisted(() => ({
  userId: "ada" as string | null,
  locale: null as { code: string } | null,
  kind: "collection" as string,
}));

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useCurrentUserId: () => who.userId,
  useDocumentLocale: () => who.locale,
  useDocumentIdentity: () => ({
    kind: who.kind,
    slug: "pages",
    documentId: "p1",
  }),
}));

const store = vi.hoisted(() => ({
  sent: [] as Array<[string | null, string[]]>,
  held: 0,
  let: 0,
}));
vi.mock("../startup-reads", () => ({
  startBuilderReads: (userId: string | null, reads: string[]) => {
    store.sent.push([userId, reads]);
  },
  holdStartedReads: () => {
    store.held += 1;
    return () => {
      store.let += 1;
    };
  },
}));

import { BuilderStartup } from "./builder-startup";

afterEach(() => {
  cleanup();
  store.sent.length = 0;
  store.held = 0;
  store.let = 0;
  who.userId = "ada";
  who.locale = null;
  who.kind = "collection";
});

describe("the builder's start-up read, sent as the editor opens", () => {
  it("names each read by the path its own hook asks", () => {
    who.locale = { code: "fr" };
    render(<BuilderStartup />);
    expect(store.sent).toEqual([
      [
        "ada",
        [
          "/loop-collections?locale=fr",
          "/named-queries?locale=fr",
          "/capability",
          "/site/style",
          "/layouts/page-collection",
        ],
      ],
    ]);
  });

  it("leaves out the pages collection where the document is a Single", () => {
    who.kind = "single";
    render(<BuilderStartup />);
    expect(store.sent[0]?.[1]).not.toContain("/layouts/page-collection");
  });

  it("sends once however often the editor renders", () => {
    const view = render(<BuilderStartup />);
    view.rerender(<BuilderStartup />);
    view.rerender(<BuilderStartup />);
    expect(store.sent).toHaveLength(1);
  });

  it("sends again for another person, and none for nobody", () => {
    const view = render(<BuilderStartup />);
    who.userId = "grace";
    view.rerender(<BuilderStartup />);
    who.userId = null;
    view.rerender(<BuilderStartup />);
    expect(store.sent.map(([userId]) => userId)).toEqual([
      "ada",
      "grace",
      null,
    ]);
  });

  it("holds what it read while the editor is open, and lets it go on closing", () => {
    const view = render(<BuilderStartup />);
    expect([store.held, store.let]).toEqual([1, 0]);
    view.unmount();
    expect([store.held, store.let]).toEqual([1, 1]);
  });
});
