/**
 * Leaving a document view for the document's own edit address.
 *
 * The way back keeps the language and drops only the view's own keys. A way
 * back that kept `section` would carry a key the form never reads onto its
 * address, and the leave guard, which treats the key as the view's, would then
 * count the next move between the two as staying where it was asked to leave.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearDocumentViews,
  registerDocumentViews,
} from "@admin/lib/plugins/document-view-registry";

import { documentViewMount } from "../document-view-mount";

beforeEach(() => {
  registerDocumentViews([
    { fieldType: "blocks", path: "builder", component: "@acme/pb#View" },
  ]);
});
afterEach(() => {
  clearDocumentViews();
});

describe("documentViewMount", () => {
  it("leaves for the edit address in the same language, without the view's own keys", () => {
    window.history.pushState(
      null,
      "",
      "/admin/collections/pages/1/builder?field=body&section=hero-1&locale=de"
    );
    const mount = documentViewMount(
      "collection",
      "pages",
      "builder",
      "/admin/collections/pages/1"
    );
    if (mount === undefined) throw new Error("the builder view is registered");

    mount.onExit();

    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/admin/collections/pages/1?locale=de"
    );
  });
});
