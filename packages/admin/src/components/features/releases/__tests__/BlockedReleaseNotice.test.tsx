/**
 * What a stopped release tells the person who finds it.
 *
 * The state alone is a dead end — it says a launch will not happen and nothing
 * about which document or why, and waiting does not help because the drain has
 * already stopped retrying. Every case here is about the notice being
 * ACTIONABLE rather than merely present.
 *
 * @module components/features/releases/__tests__/BlockedReleaseNotice.test
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { BlockedReleaseNotice } from "../BlockedReleaseNotice";

const text = () => document.body.textContent ?? "";

describe("it says what to fix", () => {
  it("explains a deleted author, and names the remedy", () => {
    // The commonest way a release becomes unrunnable: somebody left.
    render(
      <BlockedReleaseNotice
        blockers={[{ memberId: "m1", reason: "AUTHOR_GONE" }]}
      />
    );
    expect(text()).toMatch(/deleted or deactivated/i);
    expect(text()).toMatch(/restore that user/i);
  });

  it("explains a member with no author at all", () => {
    render(
      <BlockedReleaseNotice
        blockers={[{ memberId: "m1", reason: "NO_AUTHOR" }]}
      />
    );
    expect(text()).toMatch(/no author was recorded/i);
  });

  it("explains a language-scoped member", () => {
    render(
      <BlockedReleaseNotice
        blockers={[{ memberId: "m1", reason: "LOCALE_SCOPED" }]}
      />
    );
    expect(text()).toMatch(/names a single language/i);
  });

  it("lists every blocker rather than only the first", () => {
    // The fix is per member. Reporting one leaves the operator rescheduling,
    // watching it stop again, and learning the next reason one at a time.
    render(
      <BlockedReleaseNotice
        blockers={[
          { memberId: "m1", reason: "AUTHOR_GONE" },
          { memberId: "m2", reason: "LOCALE_SCOPED" },
        ]}
      />
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("says the release will not run on its own", () => {
    // The consequence, which the word "blocked" does not carry. Someone who
    // assumes it is still retrying will wait instead of acting.
    render(
      <BlockedReleaseNotice
        blockers={[{ memberId: "m1", reason: "AUTHOR_GONE" }]}
      />
    );
    expect(text()).toMatch(/will not run on its own/i);
  });
});

describe("when the cause has already been fixed", () => {
  it("says so instead of showing an empty list", () => {
    // Reachable BECAUSE the reasons are derived rather than stored: an operator
    // who restored the user sees the release still stopped and nothing blocking
    // it, and the only thing left to tell them is to schedule it again. A
    // stored reason would still be naming the missing author here.
    render(<BlockedReleaseNotice blockers={[]} />);
    expect(text()).toMatch(/nothing is blocking it any more/i);
    expect(text()).toMatch(/schedule it again/i);
  });
});
