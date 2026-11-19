/**
 * One workflow in Settings, rendered against the server's answers, with the
 * settings service watched for what each control sends.
 *
 * - Read-only: the definition (where it is registered, attachments, the
 *   diagram with its documents per stage, steps and permissions) is shown, and
 *   a reader without `update-settings` gets no control but Copy path.
 * - Grants: the dialog starts from the roles holding the step, lists a role
 *   holding it on some collections only (unticked, saying what saving does),
 *   names the steps sharing its permission, and sends the exact set for that
 *   step alone.
 * - Default reviewer: only those holding the stage's primary step are offered,
 *   and a reviewer the server says no longer holds it, a role or a person, is
 *   warned about.
 * - Labels: Reset sends `null`; each email switch sends its own trigger.
 * - A permission no role holds is an alert.
 * - A conflict reads the settings again and keeps the pending choice; a
 *   refusal lands beside the setting its path names.
 *
 * The plausible broken screen: a grant save that sends the sibling step too
 * (the server refuses it), a picker offering every role, a Reset that sends
 * the code's label back as an override, a switch sending all three emails, and
 * a conflict that closes the dialog and drops the choice.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import type { WorkflowSettingsView } from "@admin/types/workflows";

import { WorkflowSettingsDetail } from "../WorkflowSettingsDetail";

import { EDITORIAL, ROLES, USERS, settingsOf } from "./fixtures";

const api = vi.hoisted(() => ({
  listWorkflows: vi.fn(),
  getWorkflowSettings: vi.fn(),
  updateWorkflowSettings: vi.fn(),
}));
const held = vi.hoisted(() => ({ permissions: new Set<string>() }));

vi.mock("@admin/services/workflowApi", () => api);
vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => ({ data: { isAuthenticated: true } }),
}));
vi.mock("@admin/hooks/queries/useRoles", () => ({
  useRoles: () => ({ data: { items: ROLES } }),
}));
vi.mock("@admin/hooks/queries/useUsers", () => ({
  useUsers: () => ({ data: { items: USERS } }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (slug: string) => held.permissions.has(slug),
  }),
}));
vi.mock("@admin/hooks/useDocumentTitle", () => ({
  useDocumentTitle: () => undefined,
}));

const ADMIN = [
  "read-settings",
  "update-settings",
  "update-roles",
  "read-users",
];

/** An error as `fetcher` raises it from the canonical envelope. */
function apiError(status: number, code: string, data?: unknown): Error {
  return Object.assign(new Error(code), { status, code, data });
}

function serve(settings: WorkflowSettingsView) {
  api.listWorkflows.mockResolvedValue({
    items: [EDITORIAL],
    meta: { total: 1 },
  });
  api.getWorkflowSettings.mockResolvedValue(settings);
}

async function open(settings = settingsOf(), permissions = ADMIN) {
  held.permissions = new Set(permissions);
  serve(settings);
  render(<WorkflowSettingsDetail slug="editorial" />);
  await screen.findByRole("heading", { name: "Who takes each step" });
}

const section = (name: string) =>
  screen.getByRole("region", { name }) as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a workflow in Settings", () => {
  it("shows the definition read-only: where it is registered and used, the diagram with its documents, and each step's permission", async () => {
    await open();

    expect(screen.getByText("src/nextly.config.ts")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy path" })).toBeTruthy();
    expect(screen.getByText("Used by posts, pages and banner")).toBeTruthy();
    expect(screen.getByText("Defined in code")).toBeTruthy();
    const diagram = within(section("Stages and steps")).getByRole("img");
    expect(diagram.getAttribute("aria-label")).toContain(
      "Legal check, 2 documents: Clear moves it to Cleared; Bounce moves it to Writing, with a comment; Park moves it to On hold, with a comment."
    );
    expect(within(diagram).getByText("4 documents")).toBeTruthy();
    const clear = within(section("Who takes each step")).getByRole(
      "rowheader",
      { name: /^Clear/ }
    ).parentElement as HTMLElement;
    expect(within(clear).getByText("sign-off")).toBeTruthy();
    expect(within(clear).getByText("Lawyers")).toBeTruthy();
    const send = within(section("Who takes each step")).getByRole("rowheader", {
      name: /^Send to legal/,
    }).parentElement as HTMLElement;
    // A step naming no permission of its own needs the collection's own, named.
    expect(within(send).getByText("update")).toBeTruthy();
    expect(
      within(send).queryByRole("button", { name: /Change who takes/ })
    ).toBeNull();
  });

  it("gives a reader without update-settings no control but Copy path", async () => {
    await open(settingsOf(), ["read-settings"]);

    expect(
      screen.queryAllByRole("button").map(button => button.textContent)
    ).toEqual(["Copy path"]);
    expect(screen.queryAllByRole("switch")).toEqual([]);
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.queryAllByRole("combobox")).toEqual([]);
    expect(screen.queryAllByRole("radio")).toEqual([]);
  });

  it("keeps who takes each step read-only for a reader who may not update roles", async () => {
    await open(settingsOf(), ["read-settings", "update-settings"]);

    expect(
      screen.queryByRole("button", { name: /Change who takes/ })
    ).toBeNull();
    expect(
      screen.getByText(
        "Changing who takes a step also needs permission to update roles."
      )
    ).toBeTruthy();
  });

  it("sends the exact set of roles for the step changed, and only that step", async () => {
    const user = userEvent.setup();
    await open();
    api.updateWorkflowSettings.mockResolvedValue(
      settingsOf({
        revision: 4,
        grants: {
          clear: ["r-editors", "r-lawyers"],
          bounce: ["r-editors", "r-lawyers"],
        },
      })
    );

    await user.click(
      screen.getByRole("button", { name: "Change who takes Clear" })
    );
    const dialog = await screen.findByRole("dialog");
    // Starts from the roles holding it now; the partial holder is unticked and says what saving does.
    expect(
      within(dialog)
        .getByRole("checkbox", { name: "Lawyers" })
        .getAttribute("aria-checked")
    ).toBe("true");
    const interns = within(dialog).getByRole("checkbox", { name: "Interns" });
    expect(interns.getAttribute("aria-checked")).toBe("false");
    expect(
      within(dialog).getByText(/Holds it on some collections only/)
    ).toBeTruthy();
    expect(within(dialog).getByText(/Also changes: Bounce/)).toBeTruthy();

    await user.click(within(dialog).getByRole("checkbox", { name: "Editors" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.updateWorkflowSettings).toHaveBeenCalledWith("editorial", {
        revision: 3,
        grants: { clear: ["r-editors", "r-lawyers"] },
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.getAllByRole("status").some(each => each.textContent === "Saved.")
    ).toBe(true);
  });

  it("offers as default reviewer only those holding the stage's primary step", async () => {
    await open();

    const select = screen.getByRole("combobox", {
      name: "Default reviewer for Legal check",
    });
    const offered = within(select)
      .getAllByRole("option")
      .map(option => option.textContent);
    expect(offered).toEqual([
      "No default reviewer",
      "Super admin (the whole role)",
      "Lawyers (the whole role)",
      "Rita",
      "Ada",
    ]);
  });

  it("offers for a step needing the collections' own permission only those the server says hold it", async () => {
    await open();

    const select = screen.getByRole("combobox", {
      name: "Default reviewer for On hold",
    });
    expect(
      within(select)
        .getAllByRole("option")
        .map(option => option.textContent)
    ).toEqual([
      "No default reviewer",
      "Super admin (the whole role)",
      "Editors (the whole role)",
      "Ed",
      "Ada",
    ]);
    // The server has judged who holds it, so nothing is left to a save to find out.
    expect(screen.queryByText(/checked when you save/)).toBeNull();
  });

  it("warns when a person reviewer is deactivated, as the server says", async () => {
    await open(
      settingsOf({
        defaultReviewers: { hold: { kind: "user", id: "u-ed" } },
        defaultReviewerHolds: { hold: "deactivated" },
      })
    );

    expect(
      screen.getByText(/The default reviewer of On hold, Ed, is deactivated/)
    ).toBeTruthy();
  });

  it("warns when a role reviewer no longer holds the stage's primary step, and saves a new one", async () => {
    const user = userEvent.setup();
    await open(
      settingsOf({
        defaultReviewers: { legal: { kind: "role", id: "r-editors" } },
        defaultReviewerHolds: { legal: "lacks" },
      })
    );
    api.updateWorkflowSettings.mockResolvedValue(settingsOf({ revision: 4 }));

    expect(
      screen.getByText(
        /The default reviewer of Legal check, Editors \(role\), no longer holds Clear/
      )
    ).toBeTruthy();

    const select = screen.getByRole("combobox", {
      name: "Default reviewer for Legal check",
    });
    // The stored reviewer stays shown, marked, so the choice on screen is the one stored.
    expect((select as HTMLSelectElement).selectedOptions[0]?.textContent).toBe(
      "Editors (role) (no longer offered)"
    );
    await user.selectOptions(select, "user:u-rita");
    await user.click(
      screen.getByRole("button", {
        name: "Save default reviewer for Legal check",
      })
    );
    await waitFor(() =>
      expect(api.updateWorkflowSettings).toHaveBeenCalledWith("editorial", {
        revision: 3,
        defaultReviewers: { legal: { kind: "user", id: "u-rita" } },
      })
    );
  });

  it("resets a stage's label and colour by sending null", async () => {
    const user = userEvent.setup();
    await open(
      settingsOf({ labels: { legal: { label: "Lawyers", colour: "#d97706" } } })
    );
    api.updateWorkflowSettings.mockResolvedValue(settingsOf({ revision: 4 }));

    // Reset is offered only where something differs from the code.
    expect(
      (
        screen.getByRole("button", {
          name: "Reset Writing",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Reset Legal check" }));

    await waitFor(() =>
      expect(api.updateWorkflowSettings).toHaveBeenCalledWith("editorial", {
        revision: 3,
        labels: { legal: null },
      })
    );
  });

  it("saves a label and a colour from the palette, the code's own label as none", async () => {
    const user = userEvent.setup();
    await open();
    api.updateWorkflowSettings.mockResolvedValue(settingsOf({ revision: 4 }));

    const row = screen.getByRole("textbox", { name: "Label for On hold" });
    await user.clear(row);
    await user.type(row, "Parked");
    await user.click(
      within(
        screen.getByRole("group", { name: "Colour for On hold" })
      ).getByRole("radio", { name: "Amber" })
    );
    await user.click(screen.getByRole("button", { name: "Save On hold" }));
    await waitFor(() =>
      expect(api.updateWorkflowSettings).toHaveBeenCalledWith("editorial", {
        revision: 3,
        labels: { hold: { label: "Parked", colour: "#d97706" } },
      })
    );

    await user.click(
      within(
        screen.getByRole("group", { name: "Colour for Writing" })
      ).getByRole("radio", { name: "Blue" })
    );
    await user.click(screen.getByRole("button", { name: "Save Writing" }));
    // Over the revision the first save answered with.
    await waitFor(() =>
      expect(api.updateWorkflowSettings).toHaveBeenLastCalledWith("editorial", {
        revision: 4,
        labels: { writing: { label: null, colour: "#2563eb" } },
      })
    );
  });

  it("sends each email switch's own trigger", async () => {
    const user = userEvent.setup();
    await open();
    api.updateWorkflowSettings.mockResolvedValue(settingsOf({ revision: 4 }));

    await user.click(
      screen.getByRole("switch", { name: "Email for Approved" })
    );

    await waitFor(() =>
      expect(api.updateWorkflowSettings).toHaveBeenCalledWith("editorial", {
        revision: 3,
        emails: { approved: false },
      })
    );
  });

  it("alerts when no role holds a step's permission", async () => {
    await open(settingsOf({ grants: { clear: [], bounce: [] } }));

    const alert = screen
      .getAllByRole("alert")
      .find(each => each.textContent?.includes("No role can take"));
    expect(alert?.textContent).toContain(
      "No role can take Clear and Bounce yet"
    );
    expect(alert?.textContent).toContain("Give a role “sign-off”");
  });

  it("on a conflict, reads the settings again and keeps the roles ticked", async () => {
    const user = userEvent.setup();
    await open();
    api.updateWorkflowSettings.mockRejectedValue(apiError(409, "CONFLICT"));

    await user.click(
      screen.getByRole("button", { name: "Change who takes Clear" })
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: "Editors" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Someone changed these settings; review and save again."
        )
      ).toBeTruthy()
    );
    expect(api.getWorkflowSettings).toHaveBeenCalledTimes(2);
    expect(
      within(screen.getByRole("dialog"))
        .getByRole("checkbox", { name: "Editors" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("puts a refusal beside the setting its path names", async () => {
    const user = userEvent.setup();
    await open();
    api.updateWorkflowSettings.mockRejectedValue(
      apiError(400, "VALIDATION_ERROR", {
        errors: [
          {
            path: "defaultReviewers.legal",
            code: "WORKFLOW_INELIGIBLE_REVIEWER",
            message: "This user cannot be the default reviewer.",
          },
        ],
      })
    );

    await user.selectOptions(
      screen.getByRole("combobox", {
        name: "Default reviewer for Legal check",
      }),
      "user:u-rita"
    );
    await user.click(
      screen.getByRole("button", {
        name: "Save default reviewer for Legal check",
      })
    );

    const select = await screen.findByRole("combobox", {
      name: "Default reviewer for Legal check",
      description: "This user cannot be the default reviewer.",
    });
    expect(select.getAttribute("aria-invalid")).toBe("true");
  });
});
