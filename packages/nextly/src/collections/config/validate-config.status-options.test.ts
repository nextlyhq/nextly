/**
 * A `status` choice longer than a version's status can hold is refused where
 * it is declared, for a collection and a Single alike.
 *
 * Without the Draft/Published lifecycle, a field named `status` is what each
 * version records as its status, and that holds 32 characters. A choice field
 * declares every value it can take, so an option over 32 is refused here
 * rather than shortened in history on every save that picks it. One of 32
 * characters is the boundary, and a free-text status declares nothing to
 * refuse.
 */
import { describe, expect, it } from "vitest";

import { validateSingleConfig } from "../../singles/config/validate-single";
import { radio, select, text } from "../fields/helpers";

import type { CollectionConfig } from "./define-collection";
import { validateCollectionConfig } from "./validate-config";

const LONG = "x".repeat(33);
const EXACT = "y".repeat(32);

function collectionCodes(fields: CollectionConfig["fields"]): string[] {
  return validateCollectionConfig({ slug: "posts", fields }).errors.map(
    e => e.code
  );
}

function singleCodes(fields: unknown[]): string[] {
  return validateSingleConfig({
    slug: "banner",
    fields,
  } as Parameters<typeof validateSingleConfig>[0]).errors.map(e => e.code);
}

const statusSelect = (value: string) =>
  select({
    name: "status",
    options: [
      { label: "Live", value: "live" },
      { label: "Long", value },
    ],
  });

describe("a status choice longer than a version can record", () => {
  it("is refused on a collection, for a select and a radio", () => {
    expect(collectionCodes([statusSelect(LONG)])).toContain(
      "FIELD_STATUS_OPTION_TOO_LONG"
    );
    expect(
      collectionCodes([
        radio({ name: "status", options: [{ label: "Long", value: LONG }] }),
      ])
    ).toContain("FIELD_STATUS_OPTION_TOO_LONG");
  });

  it("is refused on a Single", () => {
    expect(singleCodes([statusSelect(LONG)])).toContain(
      "FIELD_STATUS_OPTION_TOO_LONG"
    );
  });

  it("allows one of exactly 32 characters, another field's long option, and a text status", () => {
    expect(collectionCodes([statusSelect(EXACT)])).toEqual([]);
    expect(singleCodes([statusSelect(EXACT)])).toEqual([]);
    expect(
      collectionCodes([
        select({ name: "kind", options: [{ label: "Long", value: LONG }] }),
      ])
    ).toEqual([]);
    expect(collectionCodes([text({ name: "status" })])).toEqual([]);
  });
});
