/**
 * The transactional writes carry field groups like the ordinary ones.
 *
 * `createEntryWrite` and `updateEntryWrite` are the bodies behind
 * `createMany`, `updateEntries`, and every `*InTransaction` method. Each is a
 * separate implementation of its ordinary sibling, and the two had drifted at
 * the same seam: the ordinary create and update lift a field group's value out
 * of the payload and write it to the component's own table after the row; the
 * transactional ones left it on the payload. Measured before the fix: a bulk
 * create of a collection with a `fieldGroup` field failed every row with
 * `table dc_pages has no column named seo`, and a transactional update of the
 * same field reported success while the component table kept its old value.
 * Declared defaults are NOT carried across the same seam, on purpose:
 * `field-defaults-tx.integration.test.ts` holds that boundary and says why.
 *
 * Asserted end to end through a booted instance and read back through
 * `getEntry`, because the failure was in what reached the tables, not in what
 * any service was handed.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { resetHookRegistry } from "../../../hooks/hook-registry";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  resetHookRegistry();
});

/** The two service surfaces these cases drive, narrowed to the calls involved. */
interface Handler {
  createEntry: (
    ctx: Record<string, unknown>,
    data: Record<string, unknown>
  ) => Promise<{ success: boolean; data: Record<string, unknown> | null }>;
  getEntry: (
    ctx: Record<string, unknown>
  ) => Promise<{ success: boolean; data: Record<string, unknown> | null }>;
}
interface Service {
  createMany: (
    slug: string,
    rows: Record<string, unknown>[],
    ctx: Record<string, unknown>
  ) => Promise<{
    successful: number;
    failed: number;
    ids: string[];
    errors: { index: number; error: string }[];
  }>;
  withTransaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  // Returns the written document, not a result envelope; a refused write throws.
  updateEntryInTransaction: (
    tx: unknown,
    slug: string,
    id: string,
    data: Record<string, unknown>,
    ctx: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
}

async function boot(options: { drafts?: boolean } = {}) {
  const fired: string[] = [];
  const record =
    (name: string) =>
    ({ value }: { value: unknown }) => {
      fired.push(name);
      return value;
    };
  const instance = await createTestNextly({
    fieldGroups: [
      defineFieldGroup({ slug: "seo", fields: [text({ name: "metaTitle" })] }),
    ],
    collections: [
      defineCollection({
        slug: "pages",
        ...(options.drafts ? { status: true, versions: { drafts: true } } : {}),
        fields: [
          text({ name: "title" }),
          fieldGroup({
            name: "seo",
            component: "seo",
            hooks: { beforeChange: [record("seo:beforeChange")] },
          }),
        ],
      }),
    ],
  });
  return {
    instance,
    fired,
    handler: instance.getService("collectionsHandler") as unknown as Handler,
    service: instance.getService("collectionService") as unknown as Service,
  };
}

const seo = (doc: Record<string, unknown> | null) =>
  (doc?.seo as { metaTitle?: string } | undefined)?.metaTitle;

describe("transactional writes carry field groups (integration)", () => {
  it("createMany writes a field group to its own table", async () => {
    const booted = await boot();
    current = booted.instance;

    const result = await booted.service.createMany(
      "pages",
      [{ title: "Home", seo: { metaTitle: "home meta" } }],
      { overrideAccess: true }
    );

    // The failure was per row and loud: `no column named seo`. A partial
    // result with one error is what it produced, so the count is asserted
    // rather than only the absence of an error message.
    expect(result.errors).toEqual([]);
    expect(result.successful).toBe(1);
    const read = await booted.handler.getEntry({
      collectionName: "pages",
      entryId: result.ids[0],
      overrideAccess: true,
    });
    expect(seo(read.data)).toBe("home meta");
    // The field group's own pre-write hook ran on the way, as it does on the
    // ordinary create.
    expect(booted.fired).toContain("seo:beforeChange");
  });

  it("updateEntryInTransaction persists a field-group value", async () => {
    const booted = await boot();
    current = booted.instance;
    const created = await booted.handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Home", seo: { metaTitle: "before" } }
    );
    const id = created.data?.id as string;

    const updated = await booted.service.withTransaction(tx =>
      booted.service.updateEntryInTransaction(
        tx,
        "pages",
        id,
        { title: "Home 2", seo: { metaTitle: "after" } },
        { overrideAccess: true }
      )
    );
    expect(updated.title).toBe("Home 2");

    // Read back rather than trusting the response: the failure reported
    // success and returned a row while the component table kept `before`.
    const read = await booted.handler.getEntry({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });
    expect(read.data?.title).toBe("Home 2");
    expect(seo(read.data)).toBe("after");
  });

  it("a transactional update held as a working draft keeps the field group in the draft", async () => {
    const booted = await boot({ drafts: true });
    current = booted.instance;
    const created = await booted.handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "Home", status: "published", seo: { metaTitle: "live" } }
    );
    const id = created.data?.id as string;

    // A status-less update to a published entry is held, not applied.
    const held = await booted.service.withTransaction(tx =>
      booted.service.updateEntryInTransaction(
        tx,
        "pages",
        id,
        { title: "Draft title", seo: { metaTitle: "draft" } },
        { overrideAccess: true }
      )
    );
    // The pending document, not the live row (this path does not mark it
    // `_isWorkingDraft` the way the ordinary update does; the content says
    // which it is). The draft carries the component, where before it carried
    // `{}` for it.
    expect(held.title).toBe("Draft title");
    expect(seo(held)).toBe("draft");

    // Live content is untouched: the row and the component table both.
    const live = await booted.handler.getEntry({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });
    expect(live.data?.title).toBe("Home");
    expect(seo(live.data)).toBe("live");
  });
});
