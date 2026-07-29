/**
 * Work already underway resolves against the registry it started with.
 *
 * The live registry belongs to whichever config was loaded last. `db:sync
 * --watch` reloads on every save, and a reload clears and rebuilds that set
 * while the previous sync may still be materializing columns. Resolution
 * happens deep in the schema pipeline, so the operation pins its registry for
 * the length of its run rather than passing one down every frame.
 */
import { afterEach, describe, expect, it } from "vitest";

import type { PluginFieldType } from "../../../../plugins/contributions";
import {
  clearFieldTypes,
  getFieldType,
  registerFieldType,
  runWithFieldTypes,
  snapshotFieldTypes,
} from "../field-type-registry";

const RATING: PluginFieldType = {
  type: "star-rating",
  storage: "number",
  component: "@acme/ratings/admin#StarRating",
};

const SWATCH: PluginFieldType = {
  type: "color-swatch",
  storage: "text",
  component: "@acme/swatch/admin#ColorSwatch",
};

afterEach(() => {
  clearFieldTypes();
});

describe("runWithFieldTypes", () => {
  it("keeps resolving the pinned types after the live set is rebuilt", async () => {
    registerFieldType(RATING);
    const pinned = snapshotFieldTypes();

    let release!: () => void;
    const midRun = new Promise<void>(resolve => {
      release = resolve;
    });

    const sync = runWithFieldTypes(pinned, async () => {
      await midRun;
      // The reload below happened while this was suspended.
      return getFieldType("star-rating");
    });

    // What a save does: the next load clears the live set and registers the
    // types the new config declares.
    clearFieldTypes();
    registerFieldType(SWATCH);
    release();

    expect(await sync).toEqual(RATING);
    // The live set really did move on, so the assertion above is about the
    // pinning and not about the reload having failed to happen.
    expect(getFieldType("star-rating")).toBeUndefined();
    expect(getFieldType("color-swatch")).toEqual(SWATCH);
  });

  it("does not let a pinned run leave its types behind", async () => {
    const pinned = snapshotFieldTypes();
    registerFieldType(SWATCH);

    await runWithFieldTypes(pinned, async () => {
      expect(getFieldType("color-swatch")).toBeUndefined();
    });

    expect(getFieldType("color-swatch")).toEqual(SWATCH);
  });

  it("registers into the live set even when called inside a scope", async () => {
    const pinned = snapshotFieldTypes();

    await runWithFieldTypes(pinned, async () => {
      registerFieldType(RATING);
      // Registration is about the live config, so a scope must not capture it —
      // otherwise a plugin registering during a pinned run would be lost.
      expect(getFieldType("star-rating")).toBeUndefined();
    });

    expect(getFieldType("star-rating")).toEqual(RATING);
  });

  it("falls through to the live set when nothing is pinned", () => {
    registerFieldType(RATING);

    expect(
      runWithFieldTypes(undefined, () => getFieldType("star-rating"))
    ).toEqual(RATING);
  });
});
