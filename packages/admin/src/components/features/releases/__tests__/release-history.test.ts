/**
 * What a release's history says about each of its events, and who it names
 * as the release's owner.
 *
 * @module components/features/releases/__tests__/release-history.test
 */
import { describe, expect, it } from "vitest";

import type { DocumentEvent } from "@admin/services/versionApi";

import {
  ownerFromHistory,
  releaseHistoryLine,
  releaseHistoryRows,
  type ReleaseHistoryContext,
} from "../release-history";

const CONTEXT: ReleaseHistoryContext = {
  titleOf: document => (document.entryId === "e1" ? "Launch post" : null),
  pluralOf: slug => (slug === "posts" ? "Posts" : slug),
  readerZone: "Asia/Karachi",
  now: Date.parse("2026-10-14T04:00:00.000Z"),
  viewerId: "u-me",
};

function event(
  kind: string,
  payload: Record<string, unknown> | null = null,
  actor: Partial<DocumentEvent> = {}
): DocumentEvent {
  return {
    id: `${kind}-${String(payload?.entryId ?? "")}`,
    kind,
    actorKind: "person",
    actorId: "u1",
    actorName: "Aqib Khan",
    occurredAt: "2026-10-13T06:02:00.000Z",
    fromState: null,
    toState: null,
    note: null,
    versionNo: null,
    payload,
    parts: [],
    ...actor,
  };
}

const document = (entryId: string, action = "publish") => ({
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId,
  locale: null,
  action,
});

describe("releaseHistoryLine", () => {
  it("names a document by title where the reader can see it, and by collection otherwise", () => {
    expect(
      releaseHistoryLine(
        event("release-document-added", document("e1", "unpublish")),
        CONTEXT
      ).text
    ).toBe("added “Launch post” · comes down");
    expect(
      releaseHistoryLine(
        event("release-document-removed", document("e9")),
        CONTEXT
      ).text
    ).toBe("removed a document in Posts");
  });

  it("says a scheduled time in the reader's zone", () => {
    const line = releaseHistoryLine(
      event("release-scheduled", {
        at: "2026-10-17T14:00:00.000Z",
        timezone: "America/New_York",
      }),
      CONTEXT
    );
    expect(line.text.replace(/ /g, " ")).toBe(
      "scheduled it for Sat, Oct 17, 2026 7:00 PM"
    );
    expect(line.actor).toEqual({ kind: "person", name: "Aqib Khan" });
  });

  it("says what the runner did as what happened, with no one named", () => {
    expect(
      releaseHistoryLine(
        event(
          "release-stopped",
          { scheduledAt: "2026-10-13T06:00:00.000Z" },
          {
            actorKind: "system",
            actorId: null,
            actorName: null,
          }
        ),
        CONTEXT
      )
    ).toMatchObject({ actor: null, text: expect.stringMatching(/^Stopped/) });
  });

  it("says a kind it has no sentence for in that kind's own words", () => {
    expect(releaseHistoryLine(event("approval-granted"), CONTEXT).text).toBe(
      "Approval granted"
    );
  });
});

describe("who the history names", () => {
  it("names the reader You, and everyone else by name", () => {
    expect(
      releaseHistoryLine(
        event("release-created", null, {
          actorId: "u-me",
          actorName: "Mobeen",
        }),
        CONTEXT
      ).actor
    ).toEqual({ kind: "person", name: "You" });
    expect(releaseHistoryLine(event("release-created"), CONTEXT).actor).toEqual(
      { kind: "person", name: "Aqib Khan" }
    );
  });
});

describe("releaseHistoryRows", () => {
  it("gathers one person's run of additions, and keeps other events apart", () => {
    const rows = releaseHistoryRows(
      [
        event("release-renamed", { from: "A", to: "B" }),
        event("release-document-added", document("e1")),
        event("release-document-added", document("e2")),
        event("release-document-added", document("e3"), {
          actorId: "u2",
          actorName: "Sara Ahmed",
        }),
        event("release-created"),
      ],
      CONTEXT
    );
    expect(rows.map(row => row.text)).toEqual([
      "renamed it “B”",
      "added 2 documents",
      "added a document in Posts · goes live",
      "created the release",
    ]);
    expect(rows[1]?.details).toEqual([
      "“Launch post” · goes live",
      "a document in Posts · goes live",
    ]);
  });
});

describe("ownerFromHistory", () => {
  it("is the person who created the release, by the name recorded then", () => {
    expect(ownerFromHistory(event("release-created"))).toEqual({
      id: "u1",
      name: "Aqib Khan",
    });
  });

  it("is no one for a key's creation, or a history without one", () => {
    expect(
      ownerFromHistory(event("release-created", null, { actorKind: "apiKey" }))
    ).toBeNull();
    expect(ownerFromHistory(undefined)).toBeNull();
  });
});
