/**
 * A recovery point remembers the version its edits began from, and its offer
 * says when the document changed since: who changed it and when, as a refused
 * save would say it. A point saved before versions existed says its starting
 * version is unknown.
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { AutosaveRecoveryBanner } from "../AutosaveRecoveryBanner";

const savedAt = new Date(Date.now() - 60 * 60 * 1000);

describe("the recovery offer's starting version", () => {
  it("says the edits began from an older version, naming who changed it since and when", () => {
    render(
      <AutosaveRecoveryBanner
        savedAt={savedAt}
        onRestore={() => {}}
        onDismiss={() => {}}
        olderVersion
        changedSince={{
          currentVersion: "8",
          changedBy: { kind: "person", name: "Ana Ruiz" },
          changedAt: "2026-11-05T10:42:00.000Z",
        }}
      />
    );
    const offer = screen.getByRole("status");
    expect(offer).toHaveTextContent(
      /These edits began from an older version\. Ana Ruiz changed the document at .*2026/
    );
    expect(offer).toHaveTextContent(/Restoring them replaces those changes/);
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
  });

  it("says the starting version is unknown for a recovery point saved before versions", () => {
    render(
      <AutosaveRecoveryBanner
        savedAt={savedAt}
        onRestore={() => {}}
        onDismiss={() => {}}
        startingVersionUnknown
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "The version these edits began from is unknown."
    );
  });
});
