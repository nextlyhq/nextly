/**
 * What a step putting several documents into a release will write, decided
 * before anything is read: the refusals a request earns on its own face, and
 * the release scheduling a document makes on each of its three paths.
 *
 * @module domains/releases/__tests__/release-batch-plan.test
 */
import { describe, expect, it } from "vitest";

import { RELEASE_MEMBER_LIMIT } from "../../../schemas/releases/types";
import {
  planDocumentSchedule,
  planMemberBatch,
  type BatchMember,
  type ScheduleDocumentInput,
} from "../release-batch-plan";

const AT = new Date("2099-01-10T09:00:00Z");

function post(entryId: string, action: BatchMember["action"] = "publish") {
  return {
    scopeKind: "collection" as const,
    scopeSlug: "posts",
    entryId,
    action,
  };
}

function refusalOf(run: () => unknown): { code?: string; message?: string } {
  try {
    run();
  } catch (error) {
    return error as { code?: string; message?: string };
  }
  throw new Error("expected a refusal");
}

describe("planMemberBatch", () => {
  it("keeps the documents in the order given", () => {
    expect(
      planMemberBatch([post("c"), post("a", "unpublish"), post("b")]).map(
        member => [member.entryId, member.action]
      )
    ).toEqual([
      ["c", "publish"],
      ["a", "unpublish"],
      ["b", "publish"],
    ]);
  });

  it("refuses an empty batch, and one that is not a list", () => {
    expect(refusalOf(() => planMemberBatch([]))).toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(
      refusalOf(() => planMemberBatch(undefined as unknown as BatchMember[]))
    ).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("refuses a document whose kind, collection, id, language or action is not one, naming its place", () => {
    // A JavaScript caller of the Direct API can send any of these. A kind
    // that is neither `collection` nor `single` would be stored as given and
    // then read back as no document at all.
    const malformed: unknown[] = [
      { ...post("e1"), scopeKind: "page" },
      { ...post("e1"), scopeKind: undefined },
      { ...post("e1"), scopeSlug: "" },
      { ...post("e1"), scopeSlug: 3 },
      { ...post("e1"), entryId: "" },
      { ...post("e1"), entryId: undefined },
      { ...post("e1"), locale: 7 },
      { ...post("e1"), action: "go" },
    ];
    for (const member of malformed) {
      const refusal = refusalOf(() =>
        planMemberBatch([post("e0"), member] as BatchMember[])
      );
      expect(refusal, JSON.stringify(member)).toMatchObject({
        code: "INVALID_INPUT",
      });
      expect(refusal.message, JSON.stringify(member)).toContain("members[1]");
    }
    // A language given as text or null, or left out, is a document.
    expect(
      planMemberBatch([
        { ...post("a"), locale: "fr" },
        { ...post("b"), locale: null },
        post("c"),
      ])
    ).toHaveLength(3);
  });

  it("takes as many documents as a release holds, and refuses one more", () => {
    const full = Array.from({ length: RELEASE_MEMBER_LIMIT }, (_, i) =>
      post(`e${i}`)
    );
    expect(planMemberBatch(full)).toHaveLength(RELEASE_MEMBER_LIMIT);
    expect(
      refusalOf(() => planMemberBatch([...full, post("one-more")]))
    ).toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining(String(RELEASE_MEMBER_LIMIT)),
    });
  });

  it("refuses a document named twice, whatever the two actions", () => {
    expect(
      refusalOf(() => planMemberBatch([post("a"), post("a", "unpublish")]))
    ).toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringMatching(/members\[1\].*members\[0\]/),
    });
  });

  it("tells documents of two collections apart by their collection", () => {
    // The control for the case above: the same id in another collection is
    // another document.
    expect(
      planMemberBatch([post("a"), { ...post("a"), scopeSlug: "pages" }])
    ).toHaveLength(2);
  });

  it("names a Single by its slug, whatever id is sent", () => {
    const single = (entryId: string) => ({
      scopeKind: "single" as const,
      scopeSlug: "homepage",
      entryId,
      action: "publish" as const,
    });
    expect(
      refusalOf(() => planMemberBatch([single("x"), single("y")]))
    ).toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("planDocumentSchedule", () => {
  const own = (
    linked?: ScheduleDocumentInput["linked"],
    action: BatchMember["action"] = "publish"
  ): Extract<ScheduleDocumentInput, { into: "own" }> => ({
    into: "own",
    document: post("doc", action),
    linked,
    title: "Hello world",
    at: AT,
    timezone: "Europe/Berlin",
  });

  it("schedules a document on its own as a single-document release", () => {
    expect(planDocumentSchedule(own())).toEqual({
      members: [{ ...post("doc"), locale: null }],
      release: {
        create: { title: "Hello world", description: null, kind: "single" },
        schedule: { at: AT, timezone: "Europe/Berlin" },
      },
    });
  });

  it("refuses an instant that is not a date, or a zone that is not text, as invalid input", () => {
    // A JavaScript caller of the Direct API can send either; neither may reach
    // the schedule's own checks, which read them as a Date and a string.
    const malformed: unknown[] = [
      { ...own(), at: "2099-01-10T09:00:00Z" },
      { ...own(), at: new Date("not a date") },
      { ...own(), at: undefined },
      { ...own(), timezone: undefined },
      { ...own(), timezone: 3 },
      // Text, but no zone: stored, it would fail every read that shows it.
      { ...own(), timezone: "Europe/Berln" },
    ];
    for (const input of malformed) {
      expect(
        () => planDocumentSchedule(input as ScheduleDocumentInput),
        JSON.stringify(input)
      ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
    }
  });

  it("makes it an ordinary release holding all of them when linked documents go with it", () => {
    const plan = planDocumentSchedule(
      own([
        { scopeKind: "collection", scopeSlug: "authors", entryId: "a1" },
        { scopeKind: "collection", scopeSlug: "categories", entryId: "c1" },
      ])
    );
    expect(plan.release).toMatchObject({
      create: { kind: "release", title: "Hello world" },
      schedule: { at: AT },
    });
    // The document first, then each linked document, every one going live.
    expect(
      plan.members.map(m => [m.scopeSlug, m.entryId, m.action, m.locale])
    ).toEqual([
      ["posts", "doc", "publish", null],
      ["authors", "a1", "publish", null],
      ["categories", "c1", "publish", null],
    ]);
  });

  it("keeps a single-document release when the linked list is empty", () => {
    expect(planDocumentSchedule(own([])).release).toMatchObject({
      create: { kind: "single" },
    });
  });

  it("refuses linked documents with a document coming down", () => {
    expect(
      refusalOf(() =>
        planDocumentSchedule(
          own(
            [{ scopeKind: "collection", scopeSlug: "authors", entryId: "a1" }],
            "unpublish"
          )
        )
      )
    ).toMatchObject({ code: "INVALID_INPUT" });
    // And takes the document coming down on its own.
    expect(planDocumentSchedule(own(undefined, "unpublish")).members).toEqual([
      { ...post("doc", "unpublish"), locale: null },
    ]);
  });

  it("refuses a linked document that is the document itself", () => {
    expect(
      refusalOf(() =>
        planDocumentSchedule(
          own([{ scopeKind: "collection", scopeSlug: "posts", entryId: "doc" }])
        )
      )
    ).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("adds to an existing release, creating none", () => {
    expect(
      planDocumentSchedule({
        into: "existing",
        document: post("doc"),
        releaseId: "r1",
      })
    ).toEqual({
      members: [{ ...post("doc"), locale: null }],
      release: { existing: "r1" },
    });
  });

  it("makes a new release a draft, with no schedule", () => {
    expect(
      planDocumentSchedule({
        into: "new",
        document: post("doc"),
        title: "Spring",
        description: "The spring launch",
      }).release
    ).toEqual({
      create: {
        title: "Spring",
        description: "The spring launch",
        kind: "release",
      },
    });
  });

  it("refuses a path that is not one of the three, a missing title or release", () => {
    expect(
      refusalOf(() =>
        planDocumentSchedule({
          into: "later",
          document: post("doc"),
        } as unknown as ScheduleDocumentInput)
      )
    ).toMatchObject({ code: "INVALID_INPUT" });
    expect(
      refusalOf(() => planDocumentSchedule({ ...own(), title: "  " }))
    ).toMatchObject({ code: "INVALID_INPUT" });
    expect(
      refusalOf(() =>
        planDocumentSchedule({
          into: "existing",
          document: post("doc"),
          releaseId: "",
        })
      )
    ).toMatchObject({ code: "INVALID_INPUT" });
  });
});
