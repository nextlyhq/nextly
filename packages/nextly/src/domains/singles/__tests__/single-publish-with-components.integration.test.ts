// A Single published by status alone is judged with the components it stores.
//
// A status-only publish with nothing pending puts the stored Single live, and
// the publish judges it whole, as published. Its component values live in
// tables of their own, so a judgement of the main row alone would refuse a
// required component the Single holds, and never see an optional one.

import { afterEach, describe, expect, it } from "vitest";

import {
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const SLUG = "landing";

async function boot(required: boolean): Promise<SingleEntryService> {
  current = await createTestNextly({
    fieldGroups: [
      defineFieldGroup({
        slug: "seo",
        fields: [
          text({
            name: "metaTitle",
            validate: (value: unknown) =>
              value === undefined ||
              value === null ||
              String(value).length <= 10 ||
              "metaTitle is at most 10 characters",
          }),
        ],
      }),
    ],
    singles: [
      defineSingle({
        slug: SLUG,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          fieldGroup({ name: "seo", component: "seo", required }),
        ],
      }),
    ],
  });
  return current.getService("singleEntryService");
}

describe("a status-only publish of a Single with components", () => {
  it("publishes a Single whose required component is stored", async () => {
    const singles = await boot(true);
    const draft = await singles.update(
      SLUG,
      { title: "Home", seo: { metaTitle: "Short" }, status: "draft" },
      { overrideAccess: true }
    );
    expect(draft.success, JSON.stringify(draft)).toBe(true);

    const published = await singles.update(
      SLUG,
      { status: "published" },
      { overrideAccess: true }
    );

    expect(published.success, JSON.stringify(published)).toBe(true);
  });
});
