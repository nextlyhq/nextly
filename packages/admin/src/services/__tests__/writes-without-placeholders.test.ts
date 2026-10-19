// Every write the editor makes sends a link it cannot see as the reference it
// is, never as the placeholder the form holds it in.
//
// The server reduces a related object to its id at the top level only, so a
// placeholder inside a group or a repeater would be stored as an object. Each
// write path is asserted with one nested in both, and with a multi-collection
// pair, which must keep its collection.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { patch, put } = vi.hoisted(() => ({
  patch: vi.fn(async (_url: string, _body: unknown) => ({
    message: "ok",
    item: { id: "e1" },
  })),
  put: vi.fn(async (_url: string, _body: unknown) => ({})),
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { patch, put },
}));

import { RESTRICTED_REFERENCE } from "@admin/lib/form/stored-references";

import { entryApi } from "../entryApi";
import { singleApi } from "../singleApi";
import { versionApi } from "../versionApi";

const hidden = (id: string) => ({ id, [RESTRICTED_REFERENCE]: true });
const hiddenPair = (relationTo: string, value: string) => ({
  relationTo,
  value,
  [RESTRICTED_REFERENCE]: true,
});
const published = new Date("2026-10-19T00:00:00.000Z");

/** Form values holding placeholders at the top level and nested. */
const values = () => ({
  title: "T",
  publishedAt: published,
  tags: [{ id: "a", title: "A" }, hidden("b")],
  image: hidden("m1"),
  related: [hiddenPair("notes", "n1")],
  box: { logo: hidden("m2") },
  lines: [{ gallery: ["m3", hidden("m4")] }],
});

/** What reaches the server for those values. */
const sent = {
  title: "T",
  publishedAt: published,
  tags: [{ id: "a", title: "A" }, "b"],
  image: "m1",
  related: [{ relationTo: "notes", value: "n1" }],
  box: { logo: "m2" },
  lines: [{ gallery: ["m3", "m4"] }],
};

describe("writes send placeholders as the references they hold", () => {
  beforeEach(() => {
    patch.mockClear();
    put.mockClear();
  });

  it("on an entry save", async () => {
    // Form values are wider than the entry payload type, as the form's are.
    await entryApi.update("posts", "e1", values() as never);
    expect(patch.mock.calls[0]?.[1]).toEqual(sent);
  });

  it("on a Single save", async () => {
    await singleApi.updateDocument("settings", values());
    expect(patch.mock.calls[0]?.[1]).toEqual(sent);
  });

  it("on a recovery point", async () => {
    await versionApi.saveAutosave(
      { kind: "collection", slug: "posts", entryId: "e1" },
      values()
    );
    expect(put.mock.calls[0]?.[1]).toEqual(sent);
  });

  it("keeps a date a date", async () => {
    await entryApi.update("posts", "e1", values() as never);
    const body = patch.mock.calls[0]?.[1] as { publishedAt: unknown };
    expect(body.publishedAt).toBeInstanceOf(Date);
  });
});
