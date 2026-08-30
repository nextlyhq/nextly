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
import type { ReleaseBlocker } from "@admin/types/releases";

import { BlockedReleaseNotice } from "../BlockedReleaseNotice";

const text = () => document.body.textContent ?? "";

/** A blocker with everything the notice renders, so a case names only its subject. */
function blocker(over: Partial<ReleaseBlocker> = {}): ReleaseBlocker {
  return {
    memberId: "m1",
    reason: "AUTHOR_GONE",
    action: "publish",
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: "e1",
    ...over,
  };
}

describe("it says what to fix", () => {
  it("explains a deleted author, and names the remedy", () => {
    // The commonest way a release becomes unrunnable: somebody left.
    render(
      <BlockedReleaseNotice
        blockers={[blocker({ memberId: "m1", reason: "AUTHOR_GONE" })]}
      />
    );
    expect(text()).toMatch(/deleted or deactivated/i);
    expect(text()).toMatch(/restore that user/i);
  });

  it("explains a member with no author at all", () => {
    render(
      <BlockedReleaseNotice
        blockers={[blocker({ memberId: "m1", reason: "NO_AUTHOR" })]}
      />
    );
    expect(text()).toMatch(/no author was recorded/i);
  });

  it("explains a language-scoped member", () => {
    render(
      <BlockedReleaseNotice
        blockers={[blocker({ memberId: "m1", reason: "LOCALE_SCOPED" })]}
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
          blocker({ memberId: "m1", reason: "AUTHOR_GONE" }),
          blocker({ memberId: "m2", reason: "LOCALE_SCOPED" }),
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
        blockers={[blocker({ memberId: "m1", reason: "AUTHOR_GONE" })]}
      />
    );
    expect(text()).toMatch(/will not run on its own/i);
  });
});

describe("it does not assume the member was going to be published", () => {
  it("says a blocked TAKEDOWN could not be taken down", () => {
    // The wording used to assume a publish, which states the opposite of the
    // truth here: an operator reading "could not be published" about a document
    // scheduled to come down learns exactly the wrong thing.
    render(
      <BlockedReleaseNotice blockers={[blocker({ action: "unpublish" })]} />
    );
    expect(text()).toMatch(/could not be taken down/i);
    expect(text()).not.toMatch(/could not be published/i);
  });

  it("still says a blocked publish could not be published", () => {
    // The control: without it the case above passes against wording that never
    // mentions publishing at all.
    render(
      <BlockedReleaseNotice blockers={[blocker({ action: "publish" })]} />
    );
    expect(text()).toMatch(/could not be published/i);
  });
});

describe("it names WHICH document", () => {
  it("identifies a collection entry by slug and id", () => {
    // The fix is per document. An anonymous sentence repeated once per blocker
    // tells an operator something is wrong and leaves them opening every row.
    render(
      <BlockedReleaseNotice
        blockers={[blocker({ scopeSlug: "posts", entryId: "e42" })]}
      />
    );
    expect(text()).toMatch(/posts \/ e42/);
  });

  it("identifies a Single by its slug alone, which is its identity", () => {
    render(
      <BlockedReleaseNotice
        blockers={[
          blocker({ scopeKind: "single", scopeSlug: "homepage", entryId: "x" }),
        ]}
      />
    );
    const shown = text();
    expect(shown).toMatch(/homepage/);
    // A Single has one document, so pairing its slug with a row id would show
    // an identifier that means nothing to the reader.
    expect(shown).not.toMatch(/homepage \/ x/);
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
