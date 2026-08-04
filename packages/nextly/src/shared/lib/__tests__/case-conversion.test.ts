// The system timestamps are described in one place because a row reaches the API through several
// paths, and a column handled on some of them and not others gives the same document different
// shapes depending on the operation that returned it. These exercise that list's two consumers
// directly, so a column added to it is carried by both without either being edited.

import { describe, expect, it } from "vitest";

import {
  convertTimestampsToCamelCase,
  rehydrateSystemTimestamps,
  SYSTEM_TIMESTAMP_KEYS,
  TIMESTAMP_COLUMN_NAMES,
} from "../case-conversion";

describe("SYSTEM_TIMESTAMP_KEYS", () => {
  it("carries both spellings of every declared timestamp", () => {
    // The shapers that decide which system keys survive a projection match on whichever spelling
    // reaches them, because they can run either side of the camelCase conversion.
    for (const [column, apiName] of TIMESTAMP_COLUMN_NAMES) {
      expect({ [column]: SYSTEM_TIMESTAMP_KEYS.includes(column) }).toEqual({
        [column]: true,
      });
      expect({ [apiName]: SYSTEM_TIMESTAMP_KEYS.includes(apiName) }).toEqual({
        [apiName]: true,
      });
    }
  });
});

describe("convertTimestampsToCamelCase", () => {
  it("publishes every declared column under its API name and removes the raw one", () => {
    const row: Record<string, unknown> = {};
    for (const [column] of TIMESTAMP_COLUMN_NAMES) {
      row[column] = new Date("2026-02-01T10:00:00Z");
    }

    const converted = convertTimestampsToCamelCase(row);

    for (const [column, apiName] of TIMESTAMP_COLUMN_NAMES) {
      expect({ [apiName]: converted[apiName] }).toEqual({
        [apiName]: new Date("2026-02-01T10:00:00Z"),
      });
      expect({ [column]: column in converted }).toEqual({ [column]: false });
    }
  });

  it("converts a null rather than dropping it", () => {
    // A null first-publication marker means "not known to have been published", which a consumer
    // can only distinguish from "this shape does not report it" if the key is present.
    const converted = convertTimestampsToCamelCase({
      first_published_at: null,
    });

    expect(converted).toEqual({ firstPublishedAt: null });
  });

  it("leaves an absent column absent", () => {
    expect(convertTimestampsToCamelCase({ id: "e1" })).toEqual({ id: "e1" });
  });
});

describe("rehydrateSystemTimestamps", () => {
  it("restores every declared timestamp, under either spelling", () => {
    const document: Record<string, unknown> = {};
    for (const [column, apiName] of TIMESTAMP_COLUMN_NAMES) {
      document[column] = "2026-02-01T10:00:00Z";
      document[apiName] = "2026-03-01T10:00:00Z";
    }

    rehydrateSystemTimestamps(document);

    for (const [column, apiName] of TIMESTAMP_COLUMN_NAMES) {
      expect({ [column]: document[column] }).toEqual({
        [column]: new Date("2026-02-01T10:00:00Z"),
      });
      expect({ [apiName]: document[apiName] }).toEqual({
        [apiName]: new Date("2026-03-01T10:00:00Z"),
      });
    }
  });

  it("leaves a value that is already decoded alone", () => {
    const decoded = new Date("2026-02-01T10:00:00Z");

    const document = rehydrateSystemTimestamps({ createdAt: decoded });

    expect(document.createdAt).toBe(decoded);
  });

  it("leaves a null marker null rather than dating it", () => {
    // `new Date(null)` is the epoch, so a marker that says "never known to be public" would come
    // back claiming a publication in 1970.
    expect(rehydrateSystemTimestamps({ firstPublishedAt: null })).toEqual({
      firstPublishedAt: null,
    });
  });

  it("keeps an unparseable string instead of replacing it with an invalid date", () => {
    expect(rehydrateSystemTimestamps({ updatedAt: "not a date" })).toEqual({
      updatedAt: "not a date",
    });
  });
});
