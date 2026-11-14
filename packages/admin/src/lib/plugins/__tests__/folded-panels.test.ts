/**
 * Which collections' document screens start with the panel folded: read
 * from the admin metadata once it has answered, and before that from what the
 * prebuilt page carries, written from the same declaration.
 */
import { describe, expect, it } from "vitest";

import type { PluginMetadata } from "@admin/types/branding";

import {
  collectionFoldKey,
  collectionFoldsPanel,
  prebuiltFoldedPanels,
} from "../folded-panels";

const plugin = (foldedPanels?: string[]): PluginMetadata => ({
  name: "@acme/forms",
  collections: ["forms"],
  ...(foldedPanels === undefined ? {} : { foldedPanels }),
});

describe("the folded collections the prebuilt page names", () => {
  it("reads them beside the pages' startup reads", () => {
    expect(
      prebuiltFoldedPanels(
        JSON.stringify({ reads: {}, foldedPanels: ["forms", "surveys"] })
      )
    ).toEqual(["forms", "surveys"]);
  });

  it.each([
    ["no element", null],
    ["text that is not JSON", "{nope"],
    ["JSON that is not a map", "[1]"],
    ["no list", JSON.stringify({ reads: {} })],
    ["a list that is not one", JSON.stringify({ foldedPanels: "forms" })],
  ])("names none with %s", (_case, json) => {
    expect(prebuiltFoldedPanels(json)).toEqual([]);
  });

  it("keeps only slugs from a list holding anything else", () => {
    expect(
      prebuiltFoldedPanels(JSON.stringify({ foldedPanels: ["forms", 3, null] }))
    ).toEqual(["forms"]);
  });
});

describe("whether a collection's screens start folded", () => {
  it("follows the admin metadata once it has answered, whatever the page says", () => {
    expect(collectionFoldsPanel([plugin(["forms"])], "forms")).toBe(true);
    expect(collectionFoldsPanel([plugin(["forms"])], "posts")).toBe(false);
    // An answer that names none folds none, as a plugin since disabled.
    expect(collectionFoldsPanel([plugin()], "forms")).toBe(false);
    expect(collectionFoldsPanel([], "forms")).toBe(false);
  });

  it("remembers the reader's choice once per collection", () => {
    expect(collectionFoldKey("forms")).toBe("collections/forms");
    expect(collectionFoldKey("forms")).not.toBe(collectionFoldKey("surveys"));
  });
});
