/**
 * A recovery point from an older version says so, wherever it is offered:
 * restoring it replaces changes made since, which the author must know before
 * choosing. Restore and the dismissal stay, so the work can still be taken.
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import {
  AutosaveRecoveryBanner,
  OLDER_VERSION_WARNING,
} from "../AutosaveRecoveryBanner";

function show(olderVersion: boolean) {
  render(
    <AutosaveRecoveryBanner
      savedAt={new Date(Date.now() - 60 * 60 * 1000)}
      onRestore={() => {}}
      onDismiss={() => {}}
      olderVersion={olderVersion}
    />
  );
}

describe("the recovery offer for an older version", () => {
  it("says restoring replaces changes made since, and keeps Restore and the dismissal", () => {
    show(true);
    expect(screen.getByText(OLDER_VERSION_WARNING)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Dismiss recovery offer" })
    ).toBeTruthy();
  });

  it("says nothing of it for a current point", () => {
    show(false);
    expect(screen.queryByText(OLDER_VERSION_WARNING)).toBeNull();
  });
});
