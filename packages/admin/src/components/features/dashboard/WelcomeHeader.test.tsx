/**
 * The dashboard keeps exactly one level-one heading in every state.
 *
 * The heading is the page's landmark for screen-reader and keyboard users:
 * jumping by heading lands on it, and every card title (an `h2`) sits under it
 * in the outline. It used to vanish whenever the sample-content card was the
 * page's call to action (offer unanswered, loading, answered, failed) and
 * while the signed-in user was still loading, which is what a first visit
 * paints first. So these render the heading WITH the sample-content card, in
 * each state the card's hook can report, against each state of the user read,
 * and count the headings on the composed page rather than on the header alone.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SeedStatus } from "@admin/hooks/queries/useSeedStatus";
import type { SeedResult } from "@admin/services/seedApi";

let seedStatus: SeedStatus = { kind: "loading" };
vi.mock("@admin/hooks/queries/useSeedStatus", () => ({
  useSeedStatus: () => ({
    status: seedStatus,
    startSeed: () => {},
    skip: () => {},
  }),
}));

type UserRead = {
  user: { id: string; name: string; email: string } | null;
  isLoading: boolean;
  error: Error | null;
};
let userRead: UserRead = { user: null, isLoading: true, error: null };
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => userRead,
}));

import { SeedDemoContentCard } from "./SeedDemoContentCard";
import { WelcomeHeader } from "./WelcomeHeader";

function seedResult(warnings: string[] = []): SeedResult {
  return {
    message: "Demo content seeded.",
    summary: {
      rolesCreated: 3,
      usersCreated: 3,
      categoriesCreated: 5,
      tagsCreated: 8,
      postsCreated: 12,
      mediaUploaded: 14,
      mediaSkipped: 0,
      collectionsRegistered: 0,
      singlesRegistered: 0,
      permissionsSynced: 0,
    },
    warnings,
  };
}

const SEED_STATES: Array<[string, SeedStatus]> = [
  ["the offer still being read", { kind: "loading" }],
  ["no offer (unavailable, loaded or declined)", { kind: "hidden" }],
  [
    "the offer unanswered",
    { kind: "idle", template: { slug: "blog", label: "Blog" } },
  ],
  ["sample content loading", { kind: "seeding" }],
  ["sample content loaded", { kind: "success", result: seedResult() }],
  [
    "sample content loaded with warnings",
    { kind: "success", result: seedResult(["one media file skipped"]) },
  ],
  ["sample content failed", { kind: "error", message: "Seed failed (500)" }],
];

const USER_STATES: Array<[string, UserRead]> = [
  ["the user still loading", { user: null, isLoading: true, error: null }],
  [
    "the user loaded",
    {
      user: { id: "u1", name: "Ada Lovelace", email: "ada@example.com" },
      isLoading: false,
      error: null,
    },
  ],
  [
    "the user read failed",
    { user: null, isLoading: false, error: new Error("network") },
  ],
];

/** The two pieces in the order the dashboard draws them. */
function renderDashboardTop() {
  return render(
    <div>
      <WelcomeHeader />
      <SeedDemoContentCard />
    </div>
  );
}

afterEach(() => {
  seedStatus = { kind: "loading" };
  userRead = { user: null, isLoading: true, error: null };
});

describe("the dashboard's main heading", () => {
  for (const [seedLabel, seed] of SEED_STATES) {
    for (const [userLabel, user] of USER_STATES) {
      it(`is the one level-one heading with ${seedLabel} and ${userLabel}`, () => {
        seedStatus = seed;
        userRead = user;
        renderDashboardTop();

        const mains = screen.getAllByRole("heading", { level: 1 });
        expect(mains).toHaveLength(1);
        const main = mains[0]!;

        // Card titles sit below it in the outline: each comes after it in the
        // document, and none is another level-one heading.
        for (const title of screen.queryAllByRole("heading", { level: 2 })) {
          expect(
            main.compareDocumentPosition(title) &
              Node.DOCUMENT_POSITION_FOLLOWING
          ).toBeTruthy();
        }
      });
    }
  }

  it("names the signed-in person once they are known", () => {
    seedStatus = { kind: "idle", template: { slug: "blog", label: "Blog" } };
    userRead = USER_STATES[1]![1];
    renderDashboardTop();
    expect(
      screen.getByRole("heading", { level: 1, name: "Welcome, Ada" })
    ).toBeInTheDocument();
  });

  it("is a heading with a name before the person is known", () => {
    // The first paint of a first visit: nothing has answered yet. A heading
    // with an empty accessible name is skipped by screen readers' heading
    // lists, so present is not enough.
    renderDashboardTop();
    const main = screen.getByRole("heading", { level: 1 });
    expect(main).toHaveAccessibleName(/^Welcome/);
  });
});
