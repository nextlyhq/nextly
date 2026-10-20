// @vitest-environment jsdom
/**
 * The key form's summary draws what the server answered, grouped by resource,
 * and says plainly why there is no list: no role chosen yet, a role the
 * server refuses, an answer that could not be loaded, or a key that would do
 * nothing. The answer itself is the server's; whether the form draws that
 * answer is the browser test's (`e2e/tests/api-key-form.spec.ts`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { ApiKeyAbility } from "@admin/services/apiKeyApi";

import { KeySummary } from "../KeySummary";

const answer = vi.hoisted(() => ({
  current: {
    data: undefined as ApiKeyAbility[] | undefined,
    error: null as Error | null,
    isLoading: false,
  },
  asked: [] as unknown[],
}));

vi.mock("@admin/hooks/queries/useApiKeys", () => ({
  useApiKeyAbilities: (query: unknown) => {
    answer.asked.push(query);
    return answer.current;
  },
}));

/** An error as `parseApiError` makes it from the server's envelope. */
function refusal(status: number, code: string): Error {
  return Object.assign(new Error("refused"), { status, code });
}

beforeEach(() => {
  answer.current = { data: undefined, error: null, isLoading: false };
  answer.asked = [];
});

describe("KeySummary", () => {
  it("draws each resource once, with every action the server answered", () => {
    answer.current.data = [
      { slug: "read-posts", action: "read", resource: "posts" },
      { slug: "create-posts", action: "create", resource: "posts" },
      {
        slug: "read-email-providers",
        action: "read",
        resource: "email-providers",
      },
      {
        slug: "read-nx_pb_class_usage",
        action: "read",
        resource: "nx_pb_class_usage",
      },
    ];
    render(<KeySummary tokenType="full-access" roleId={undefined} />);

    const rows = screen.getByTestId("api-key-summary").querySelectorAll("li");
    expect(
      Array.from(rows).map(row => [
        row.getAttribute("data-resource"),
        Array.from(row.querySelectorAll("[data-action]")).map(chip =>
          chip.getAttribute("data-action")
        ),
      ])
    ).toEqual([
      ["posts", ["read", "create"]],
      ["email-providers", ["read"]],
      ["nx_pb_class_usage", ["read"]],
    ]);
    expect(screen.getByText("Email Providers")).toBeTruthy();
    expect(screen.getByText("Nx Pb Class Usage")).toBeTruthy();
    expect(answer.asked).toContainEqual({ tokenType: "full-access" });
    expect(
      screen.getByText(
        /access rule written in code .* can still allow this key less/
      )
    ).toBeTruthy();
  });

  it("asks for the chosen role, and for a role before it can answer", () => {
    render(<KeySummary tokenType="role-based" roleId={undefined} />);
    expect(
      screen.getByText("Choose a role to see what this key will be able to do.")
    ).toBeTruthy();

    answer.current.data = [];
    render(<KeySummary tokenType="role-based" roleId="role-1" />);
    expect(answer.asked).toContainEqual({
      tokenType: "role-based",
      roleId: "role-1",
    });
  });

  it("says a refused role is above its creator, apart from a failed load", () => {
    answer.current.error = refusal(403, "API_KEY_ROLE_ABOVE_CREATOR");
    const { unmount } = render(
      <KeySummary tokenType="role-based" roleId="role-1" />
    );
    expect(
      screen.getByText(
        "You can't create a key with this role: it allows more than you can do."
      )
    ).toBeTruthy();
    unmount();

    answer.current.error = refusal(500, "INTERNAL_ERROR");
    render(<KeySummary tokenType="role-based" roleId="role-1" />);
    expect(
      screen.getByText("What this key can do couldn't be loaded.")
    ).toBeTruthy();
  });

  it("says plainly when its viewer may no longer create keys, apart from a role above them", () => {
    // Both are 403s; only the code tells them apart. A person whose
    // permission to create keys is taken while the form is open is told
    // that, not that the role they chose is too wide.
    answer.current.error = refusal(403, "FORBIDDEN");
    render(<KeySummary tokenType="role-based" roleId="role-1" />);
    expect(screen.getByText("You can no longer create API keys.")).toBeTruthy();
    expect(screen.queryByText(/allows more than you can do/)).toBeNull();
  });

  it("says when the key would be able to do nothing", () => {
    answer.current.data = [];
    render(<KeySummary tokenType="read-only" roleId={undefined} />);
    expect(
      screen.getByText("This key would be able to do nothing.")
    ).toBeTruthy();
    expect(screen.queryByTestId("api-key-summary")).toBeNull();
  });

  it("shows that it is working while the answer is on its way", () => {
    answer.current.isLoading = true;
    render(<KeySummary tokenType="read-only" roleId={undefined} />);
    expect(screen.getByText("Working out what this key can do…")).toBeTruthy();
  });
});
