/**
 * What the seed records about its starter, and when a component still counts
 * as the untouched starter.
 *
 * The fingerprint must ignore what a store changes without anyone editing
 * (node ids, timestamps, key order) and catch any change of content: a
 * fingerprint of the raw JSON passes the second and fails the first, and one
 * of the node types alone passes the first and misses edited text.
 */
import { describe, expect, it } from "vitest";

import { starterDocument } from "./starter-documents";
import {
  decodeStarterRecord,
  encodeStarterRecord,
  starterFingerprint,
  untouchedStarterArea,
  type StarterRecord,
} from "./starter-record";

/** `value` with every node id renamed and its keys in reverse order. */
function restored(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restored);
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value).reverse();
  return Object.fromEntries(
    entries.map(([key, entry]) => [
      key,
      key === "id" ? `new-${String(entry)}` : restored(entry),
    ])
  );
}

const header = starterDocument("header", "pages");

describe("a starter's fingerprint", () => {
  it("is the same for the same content stored again under new ids, timestamps and key order", () => {
    const again = {
      ...(restored(header) as Record<string, unknown>),
      updatedAt: "2026-11-17T00:00:00Z",
    };
    expect(starterFingerprint(again)).toBe(starterFingerprint(header));
  });

  it("changes when any text, link or style changes", () => {
    const text = JSON.parse(
      JSON.stringify(header).replace("Contact us", "Get in touch")
    ) as unknown;
    const link = JSON.parse(
      JSON.stringify(header).replace('"/contact"', '"/about"')
    ) as unknown;
    const colour = JSON.parse(
      JSON.stringify(header).replace('"color.background"', '"color.surface"')
    ) as unknown;
    for (const edited of [text, link, colour]) {
      expect(starterFingerprint(edited)).not.toBe(starterFingerprint(header));
    }
  });

  it("is short enough that the record fits the options table with room to spare", () => {
    const record: StarterRecord = {
      set: "0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5a",
      header: {
        id: "0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
        fingerprint: starterFingerprint(header),
      },
      footer: {
        id: "0196a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c",
        fingerprint: starterFingerprint(starterDocument("footer", "pages")),
      },
    };
    const value = encodeStarterRecord(record);
    expect(value.length).toBeLessThan(200);
    expect(decodeStarterRecord(value)).toEqual(record);
  });
});

describe("the recorded starter", () => {
  const record: StarterRecord = {
    set: "s",
    header: { id: "h", fingerprint: starterFingerprint(header) },
    footer: {
      id: "f",
      fingerprint: starterFingerprint(starterDocument("footer", "pages")),
    },
  };

  it("reads nothing it did not write as a record", () => {
    expect(decodeStarterRecord("")).toBeNull();
    expect(decodeStarterRecord("one two three")).toBeNull();
    // The four words a record had before it named its set.
    expect(decodeStarterRecord("h 1 f 2")).toBeNull();
    expect(decodeStarterRecord("a  b c")).toBeNull();
  });

  it("names the area a component is the untouched starter for, by its id and its published content", () => {
    expect(untouchedStarterArea(record, "h", header)).toBe("header");
    expect(
      untouchedStarterArea(record, "f", starterDocument("footer", "pages"))
    ).toBe("footer");
    // The header's content under the footer's id is not the footer.
    expect(untouchedStarterArea(record, "f", header)).toBeNull();
    // Another component holding the same content is not the starter.
    expect(untouchedStarterArea(record, "other", header)).toBeNull();
    // A component whose published content is not to hand is not judged.
    expect(untouchedStarterArea(record, "h", undefined)).toBeNull();
    expect(untouchedStarterArea(null, "h", header)).toBeNull();
  });
});
