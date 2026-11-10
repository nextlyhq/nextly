/**
 * The canvas's reader: the public reader's query, read as the person editing,
 * drafts included.
 *
 * What separates it from a plausible wrong one: every read names the person
 * and `overrideAccess: false` (a reader that forgot either would read as the
 * server, trusted, or as no one); it reads every state (one left at the
 * public default would hide the author's drafts); it keeps the public
 * reader's refusals and limits (a looser reader would let the canvas draw a
 * list the published page refuses); and it does not strip a field the public
 * may not read from the rows (the person may read it; the canvas marks it).
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../errors/nextly-error";
import {
  createEditorReader,
  toEditorFind,
  type EditorReaderPerson,
} from "../editor-reader";
import type {
  PublicReaderDeclarations,
  PublicReaderSource,
} from "../public-reader";

const person: EditorReaderPerson = {
  user: { id: "u1", email: "editor@example.com" } as EditorReaderPerson["user"],
};

const declarations: PublicReaderDeclarations = {
  hiddenFields: () => ["internalNote"],
};

function source() {
  const find = vi.fn(async () => ({
    items: [{ id: "1", title: "Draft post", internalNote: "for the team" }],
    meta: { total: 7 },
  }));
  return { find, reader: { find } as unknown as PublicReaderSource };
}

const isRefusal = (error: unknown) => NextlyError.is(error);

describe("the canvas's reader", () => {
  it("reads as the person editing, never trusted, every state included", async () => {
    const { find, reader } = source();
    await createEditorReader(reader, person, { declarations }).find({
      collection: "posts",
      limit: 5,
    });
    expect(find).toHaveBeenCalledTimes(1);
    expect(find.mock.calls[0]?.[0]).toMatchObject({
      collection: "posts",
      overrideAccess: false,
      user: person.user,
      status: "all",
      limit: 5,
      depth: 0,
    });
  });

  it("carries an API key's own scope with the person", () => {
    const actor = { kind: "api-key" } as unknown as EditorReaderPerson["actor"];
    expect(
      toEditorFind({ collection: "posts" }, { user: person.user, actor })
    ).toMatchObject({ actor, user: person.user, overrideAccess: false });
  });

  it("keeps the rows' fields the public may not read, for the person who may", async () => {
    const { reader } = source();
    const result = await createEditorReader(reader, person, {
      declarations,
    }).find({ collection: "posts" });
    expect(result.items[0]).toEqual({
      id: "1",
      title: "Draft post",
      internalNote: "for the team",
    });
  });

  it("refuses a filter or sort the published page refuses, reading nothing", async () => {
    const { find, reader } = source();
    const editor = createEditorReader(reader, person, { declarations });
    for (const read of [
      () =>
        editor.find({
          collection: "posts",
          filters: [{ field: "internalNote", op: "equals", value: "x" }],
        }),
      () => editor.find({ collection: "posts", sort: "-internalNote" }),
      () =>
        editor.count({
          collection: "posts",
          filters: [{ field: "internalNote", op: "exists", value: true }],
        }),
    ]) {
      await expect(read()).rejects.toSatisfy(isRefusal);
    }
    // Refused before the read: no row is read and no read hook runs for a
    // query the published page would refuse.
    expect(find).not.toHaveBeenCalled();
  });

  it("judges the fields by the reader's own declarations, never another instance's", async () => {
    // No Nextly is registered in this process: a check that reached for the
    // process's instance would fail rather than read.
    const { find, reader } = source();
    await expect(
      createEditorReader(reader, person, { declarations }).find({
        collection: "posts",
        filters: [{ field: "title", op: "contains", value: "Draft" }],
        sort: "-title",
      })
    ).resolves.toMatchObject({ meta: { total: 7 } });
    // Asked of the same source first, as the published page's reader asks
    // it: anonymous, published, one id. Its own field rules refuse there
    // what declarations cannot say. Then read as the person.
    expect(find).toHaveBeenCalledTimes(2);
    expect(find.mock.calls[0]?.[0]).toMatchObject({
      overrideAccess: false,
      user: undefined,
      status: "published",
      limit: 1,
      select: { id: true },
    });
    expect(find.mock.calls[1]?.[0]).toMatchObject({
      user: person.user,
      status: "all",
    });
  });

  it("refuses a field the source's own rules deny the visitor, never reading as the person", async () => {
    // The source refuses the anonymous read, as core refuses a filter on a
    // field the caller may not read.
    const refusal = NextlyError.validation({
      errors: [
        { path: "where.memo", code: "FIELD_NOT_READABLE", message: "No." },
      ],
    });
    const find = vi.fn(async (args: { user?: unknown }) => {
      if (args.user === undefined) throw refusal;
      return { items: [], meta: { total: 0 } };
    });
    const reader = { find } as unknown as PublicReaderSource;
    await expect(
      createEditorReader(reader, person, { declarations }).find({
        collection: "posts",
        filters: [{ field: "memo", op: "equals", value: "x" }],
      })
    ).rejects.toBe(refusal);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it("refuses a malformed query by its shape before judging its fields", async () => {
    const { find, reader } = source();
    const editor = createEditorReader(reader, person, { declarations });
    for (const query of [
      null,
      { collection: "posts", filters: "x" },
      { collection: "posts", sort: 5 },
    ]) {
      await expect(
        editor.find(query as unknown as Parameters<typeof editor.find>[0])
      ).rejects.toSatisfy(isRefusal);
    }
    expect(find).not.toHaveBeenCalled();
  });

  it("takes only the public reader's keys and limits", async () => {
    const { find, reader } = source();
    const editor = createEditorReader(reader, person, { declarations });
    // A status or a raw where is not a key a list can send, and a window
    // past the public maximum is refused, both before anything is read.
    for (const query of [
      { collection: "posts", status: "draft" },
      { collection: "posts", where: { title: { equals: "x" } } },
      { collection: "posts", limit: 1000 },
    ]) {
      await expect(
        editor.find(query as unknown as Parameters<typeof editor.find>[0])
      ).rejects.toSatisfy(isRefusal);
    }
    expect(find).not.toHaveBeenCalled();
  });

  it("counts as the person, reading one id", async () => {
    const { find, reader } = source();
    await expect(
      createEditorReader(reader, person, { declarations }).count({
        collection: "posts",
      })
    ).resolves.toBe(7);
    expect(find.mock.calls[0]?.[0]).toMatchObject({
      limit: 1,
      select: { id: true },
      overrideAccess: false,
      user: person.user,
      status: "all",
    });
  });
});
