/**
 * The words the history list says, each phrased once.
 */
import { describe, expect, it } from "vitest";

import type { DocumentEvent } from "@admin/services/versionApi";

import { SHARED_PART } from "../history-story";
import {
  changeSummary,
  dayHeading,
  eventActor,
  eventSentence,
  fieldLabels,
  partsText,
  removedCount,
  retentionLine,
} from "../history-story-text";

const names: Record<string, string> = { en: "English", es: "Spanish" };
const languageName = (code: string) => names[code] ?? code;
const partsLabel = (parts: readonly string[]) => partsText(parts, languageName);

function event(overrides: Partial<DocumentEvent>): DocumentEvent {
  return {
    id: "e1",
    kind: "published",
    actorKind: "person",
    actorId: "u1",
    actorName: "Ana",
    occurredAt: "2026-10-14T09:00:00.000Z",
    fromState: null,
    toState: null,
    note: null,
    versionNo: null,
    payload: null,
    parts: [],
    ...overrides,
  };
}

describe("partsText", () => {
  it("names languages, then the shared fields, joined as a sentence", () => {
    expect(partsText(["es"], languageName)).toBe("Spanish");
    expect(partsText(["en", "es"], languageName)).toBe("English and Spanish");
    expect(partsText([SHARED_PART, "en", "es"], languageName)).toBe(
      "English, Spanish and shared fields"
    );
    expect(partsText([SHARED_PART], languageName)).toBe("Shared fields");
  });
});

describe("changeSummary", () => {
  it("names up to three fields, then two and a count", () => {
    expect(changeSummary([])).toBe("No fields changed");
    expect(changeSummary(["Title"])).toBe("Title");
    expect(changeSummary(["Title", "Body"])).toBe("Title and Body");
    expect(changeSummary(["Title", "Body", "Slug"])).toBe(
      "Title, Body and Slug"
    );
    expect(changeSummary(["Title", "Body", "Slug", "Hero"])).toBe(
      "Title, Body and 2 more"
    );
  });
});

describe("eventSentence", () => {
  it("says what each kind of event did, and to what", () => {
    expect(
      eventSentence(event({ kind: "unpublished", parts: ["en"] }), partsLabel)
    ).toBe("Unpublished English");
    expect(
      eventSentence(
        event({ kind: "published", parts: ["en", "es"] }),
        partsLabel
      )
    ).toBe("Published English and Spanish");
    expect(eventSentence(event({ kind: "draft-discarded" }), partsLabel)).toBe(
      "Discarded the draft"
    );
    expect(
      eventSentence(
        event({ kind: "sent-for-review", parts: ["es"] }),
        partsLabel
      )
    ).toBe("Sent for review · Spanish");
  });
});

describe("eventActor", () => {
  it("names the system, and says when no one was recorded", () => {
    expect(eventActor(event({ actorKind: "system", actorName: null }))).toEqual(
      { kind: "system", name: "System" }
    );
    expect(eventActor(event({ actorName: null }))).toEqual({
      kind: "person",
      name: "Not recorded",
    });
  });
});

describe("removedCount", () => {
  it("reads the count from a removal, and nothing from anything else", () => {
    expect(
      removedCount(event({ kind: "versions-removed", payload: { count: 4 } }))
    ).toBe(4);
    expect(removedCount(event({ kind: "versions-removed" }))).toBeNull();
    expect(removedCount(event({ kind: "published" }))).toBeNull();
  });
});

describe("retentionLine", () => {
  it("states the limit, or that every version is kept", () => {
    expect(retentionLine(false)).toBe("Every version is kept.");
    expect(retentionLine(50)).toMatch(/^The newest 50 versions are kept/);
  });
});

describe("dayHeading", () => {
  const now = new Date(2026, 9, 20, 12, 0);
  it("says today and yesterday, and dates the rest", () => {
    expect(dayHeading("2026-10-20", now)).toBe("Today");
    expect(dayHeading("2026-10-19", now)).toBe("Yesterday");
    expect(dayHeading("2026-10-14", now)).not.toMatch(/Today|Yesterday|2026/);
    expect(dayHeading("2025-10-14", now)).toMatch(/2025/);
  });
});

describe("fieldLabels", () => {
  it("names the fields an editor wrote, by label, and leaves the system's columns out", () => {
    expect(
      fieldLabels([
        { name: "summary", label: "Summary", kind: "text" },
        { name: "firstPublishedAt", kind: "unknown", reason: "system" },
        { name: "oldField", kind: "unknown", reason: "removed" },
      ])
    ).toEqual(["Summary", "oldField"]);
  });
});
