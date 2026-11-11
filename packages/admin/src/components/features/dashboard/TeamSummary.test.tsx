/**
 * The Team card as a list of people, drawn from what its `load` answered:
 * each person's name, email, role and last active, in the order the server
 * sent them; an empty state that names the filtered role; and a footer of
 * Invite, for a reader who may add people, beside "View all (N)" when the
 * list is cut or "All users" when it is not.
 */
import type { SizeTier } from "@nextlyhq/ui/format";
import type { TeamWidgetData } from "nextly/core-widget-data";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { inFrame } from "@admin/components/features/widgets/__tests__/in-frame";
import { render, screen, within } from "@admin/__tests__/utils";

import { CardTierContext } from "../widgets/frame/tier";

const held = vi.hoisted(() => ({ slugs: new Set<string>() }));

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (slug: string) => held.slugs.has(slug),
  }),
}));

const { TeamSummary, NO_RECENT_SIGN_IN, initialsOf } = await import(
  "./TeamSummary"
);

const NOW = Date.now();
const minutesAgo = (minutes: number) =>
  new Date(NOW - minutes * 60_000).toISOString();

const PEOPLE: TeamWidgetData["people"] = [
  {
    name: "Ayesha Khan",
    email: "ayesha@example.com",
    role: "Editor",
    lastActiveAt: minutesAgo(12),
  },
  {
    name: "Omar Siddiqui",
    email: "omar@example.com",
    role: "Admin",
    lastActiveAt: minutesAgo(120),
  },
  { email: "nameless@example.com", role: "Author" },
];

function draw(
  data: TeamWidgetData,
  settings: Record<string, unknown> = {},
  tier: SizeTier = "medium"
) {
  return render(
    <CardTierContext.Provider value={tier}>
      {inFrame(
        <TeamSummary
          widgetId="core/team"
          placementId="core/team"
          settings={{ role: "all", limit: 5, lastActive: true, ...settings }}
          size={{ w: 6, h: 5, tier }}
          data={data}
          refreshing={false}
          retry={() => undefined}
        />,
        "Team"
      )}
    </CardTierContext.Provider>
  );
}

beforeEach(() => {
  held.slugs = new Set(["read-users", "create-users"]);
});

describe("the team card's people", () => {
  it("lists each person in the order the server sent, with name, email, role and last active", () => {
    draw({ people: PEOPLE, total: 3 });
    const rows = screen.getAllByTestId("entity-row");
    expect(rows).toHaveLength(3);
    expect(
      rows.map(row => within(row).getByTestId("entity-row-title").textContent)
    ).toEqual(["Ayesha Khan", "Omar Siddiqui", "nameless@example.com"]);
    const first = within(rows[0]!);
    expect(first.getByTestId("entity-row-meta")).toHaveTextContent(
      "ayesha@example.com"
    );
    expect(first.getByTestId("team-role")).toHaveTextContent("Editor");
    expect(first.getByTestId("team-last-active")).toHaveTextContent("12m ago");
    expect(within(rows[1]!).getByTestId("team-last-active")).toHaveTextContent(
      "2h ago"
    );
  });

  it("draws as many people as its Number of people, past the default five", () => {
    const eight = Array.from({ length: 8 }, (_, index) => ({
      name: `Person ${index + 1}`,
      email: `p${index + 1}@example.com`,
    }));
    draw({ people: eight, total: 8 }, { limit: 10 });
    expect(screen.getAllByTestId("entity-row")).toHaveLength(8);
    expect(screen.getByTestId("team-view-all")).toHaveTextContent("All users");
  });

  it("counts the footer by the rows drawn, not the rows sent", () => {
    const seven = Array.from({ length: 7 }, (_, index) => ({
      name: `Person ${index + 1}`,
      email: `p${index + 1}@example.com`,
    }));
    draw({ people: seven, total: 7 }, { limit: 5 });
    expect(screen.getAllByTestId("entity-row")).toHaveLength(5);
    expect(screen.getByTestId("team-view-all")).toHaveTextContent(
      "View all (7)"
    );
  });

  it("names a person with no name by their email alone, and says when no sign-in is on record", () => {
    draw({ people: PEOPLE, total: 3 });
    const row = within(screen.getAllByTestId("entity-row")[2]!);
    // The email is the title, not repeated under it.
    expect(row.queryByTestId("entity-row-meta")).not.toBeInTheDocument();
    expect(row.getByTestId("team-last-active")).toHaveTextContent(
      NO_RECENT_SIGN_IN
    );
  });

  it("reads each row whole to assistive technology", () => {
    draw({ people: PEOPLE, total: 3 });
    expect(
      screen.getByText(
        "Ayesha Khan, ayesha@example.com, Editor, last active 12m ago"
      )
    ).toHaveClass("sr-only");
  });

  it("leaves last active out when its setting is off", () => {
    draw({ people: PEOPLE, total: 3 }, { lastActive: false });
    expect(screen.queryByTestId("team-last-active")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("team-role")).toHaveLength(3);
  });

  it("draws no count tiles", () => {
    draw({ people: PEOPLE, total: 3 });
    expect(screen.queryByText("Users")).not.toBeInTheDocument();
    expect(screen.queryByText("Roles")).not.toBeInTheDocument();
  });

  it("leads each row with up to two initials", () => {
    expect(initialsOf({ name: "Ayesha Khan", email: "a@x" })).toBe("AK");
    expect(initialsOf({ name: "Ana", email: "a@x" })).toBe("A");
    expect(initialsOf({ name: "Mary Ann Lee", email: "a@x" })).toBe("MA");
    expect(initialsOf({ email: "zara@example.com" })).toBe("Z");
  });

  it("says no one has the role when the filter matched no one, and keeps its footer", () => {
    draw({ people: [], total: 0 }, { role: "admin" });
    expect(screen.getByTestId("card-empty")).toHaveTextContent(
      "No one has this role yet"
    );
    expect(screen.getByRole("link", { name: "All users" })).toBeInTheDocument();
  });
});

describe("the team card's footer", () => {
  it("holds Invite and All users when the list holds everyone", () => {
    draw({ people: PEOPLE, total: 3 });
    const footer = within(screen.getByTestId("widget-card-footer"));
    expect(footer.getByRole("link", { name: "Invite" })).toHaveAttribute(
      "href",
      "/admin/users/create"
    );
    expect(footer.getByRole("link", { name: "All users" })).toHaveAttribute(
      "href",
      "/admin/users"
    );
  });

  it("says View all with the role's whole count when the list is cut", () => {
    draw({ people: PEOPLE, total: 14 });
    const link = within(screen.getByTestId("widget-card-footer")).getByTestId(
      "team-view-all"
    );
    expect(link).toHaveTextContent("View all (14)");
    expect(link).toHaveAccessibleName("View all, 14");
  });

  it("carries the filtered role to the Users page", () => {
    draw({ people: PEOPLE.slice(0, 1), total: 1 }, { role: "editor" });
    expect(screen.getByRole("link", { name: "All users" })).toHaveAttribute(
      "href",
      "/admin/users?role=editor"
    );
  });

  it("offers no Invite to a reader who may not add people", () => {
    held.slugs = new Set(["read-users"]);
    draw({ people: PEOPLE, total: 3 });
    expect(
      screen.queryByRole("link", { name: "Invite" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All users" })).toBeInTheDocument();
  });
});
