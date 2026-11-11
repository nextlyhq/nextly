// @vitest-environment jsdom

/**
 * The form editor in the admin's frame: its controls in the bar, in order;
 * the status menu; one count of unsaved changes with Undo; a refused save that
 * keeps the changes and says where to fix them; and the header.
 *
 * Run against the real view and provider, since what is under test is how the
 * pieces meet.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SUBMISSION_COUNT_KEY } from "./components/editor/useSubmissionCount";
import { FormBuilderView, type FormBuilderViewProps } from "./FormBuilderView";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  submissionTotal = 12;
  permissions = { isSuperAdmin: true };
});

const answer = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  );

/** How many submissions the server says the form has. */
let submissionTotal = 12;

/** What the permissions route answers: everything, unless a case says less. */
let permissions: Record<string, unknown> = { isSuperAdmin: true };

/**
 * The admin's answers: the builder's configuration, the form's submissions
 * (12 of them), and each save in turn from `saves`.
 */
function server(...saves: (() => Promise<Response>)[]) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      return (saves.shift() ?? (() => answer(500, {})))();
    }
    if (url.includes("/me/permissions")) {
      return answer(200, permissions);
    }
    if (url.includes("/builder-config")) {
      return answer(200, {
        slugs: { forms: "forms", submissions: "form-submissions" },
      });
    }
    if (url.includes("/form-submissions/entries")) {
      return answer(200, { items: [], meta: { total: submissionTotal } });
    }
    return answer(200, {});
  });
}

function view(
  props: Partial<FormBuilderViewProps> = {},
  client: QueryClient = new QueryClient()
) {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <FormBuilderView
        entryId="form-1"
        collectionSlug="forms"
        initialData={{
          name: "Meetup sign-up",
          slug: "meetup",
          status: "published",
          fields: [
            { id: "f1", name: "email", label: "Email", type: "email" },
            { id: "f2", name: "full_name", label: "Full name", type: "text" },
          ],
        }}
        {...props}
      />
    </QueryClientProvider>
  );
  return user;
}

const bar = () => {
  const found = document.querySelector<HTMLElement>(
    '[data-slot="form-editor-bar"]'
  );
  if (found === null) throw new Error("No form editor bar");
  return found;
};

/** The bar's controls and its save state, by name, in the order drawn. */
function barOrder(): string[] {
  return Array.from(
    bar().querySelectorAll<HTMLElement>('button, a, [role="status"]')
  ).map(node =>
    node.getAttribute("role") === "status"
      ? `state: ${node.textContent ?? ""}`
      : (node.getAttribute("aria-label") ?? node.textContent ?? "").trim()
  );
}

async function pickStatus(
  user: ReturnType<typeof userEvent.setup>,
  state: RegExp
) {
  await user.click(screen.getByRole("button", { name: /^Status:/ }));
  await user.click(await screen.findByRole("menuitemradio", { name: state }));
}

describe("the form editor's bar", () => {
  it("holds the status, the save state, the submissions, More and Save, in that order", async () => {
    vi.stubGlobal("fetch", server());
    view();

    // The count arrives with its request.
    await within(bar()).findByRole("link", { name: "12 submissions" });
    expect(barOrder()).toEqual([
      "Status: Live",
      "state: All changes saved",
      "12 submissions",
      "More",
      "Save",
    ]);
    // Undo appears with something to undo, after the save state.
    const user = userEvent.setup();
    await pickStatus(user, /^Closed/);
    expect(barOrder()).toEqual([
      "Status: Closed",
      "state: 1 unsaved change",
      "Undo",
      "12 submissions",
      "More",
      "Save",
    ]);
  });

  it("links the submissions count to the form's Submissions tab", async () => {
    vi.stubGlobal("fetch", server());
    view();
    expect(
      await within(bar()).findByRole("link", { name: "12 submissions" })
    ).toHaveAttribute("href", "/admin/collections/forms/form-1/submissions");
  });

  it("reads the count again when a submission changes", async () => {
    vi.stubGlobal("fetch", server());
    const client = new QueryClient();
    view({}, client);
    await within(bar()).findByRole("link", { name: "12 submissions" });

    // A submission is deleted from the list, which says so through the key.
    submissionTotal = 11;
    await act(() =>
      client.invalidateQueries({ queryKey: SUBMISSION_COUNT_KEY })
    );

    expect(
      await within(bar()).findByRole("link", { name: "11 submissions" })
    ).toBeVisible();
  });

  it("offers Save only with something to save", async () => {
    vi.stubGlobal("fetch", server());
    const user = view();
    const save = within(bar()).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await pickStatus(user, /^Draft/);
    expect(save).toBeEnabled();
  });
});

describe("the status menu", () => {
  it("is a menu button named by the form's state, offering the three states", async () => {
    vi.stubGlobal("fetch", server());
    const user = view();
    const trigger = screen.getByRole("button", { name: "Status: Live" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");

    await user.click(trigger);
    const states = await screen.findAllByRole("menuitemradio");
    expect(states.map(state => state.textContent)).toEqual([
      "LiveAccepting submissions",
      "ClosedShows the closed message",
      "DraftNot on the site yet",
    ]);
    expect(
      screen.getByRole("menuitemradio", { name: /^Live/ })
    ).toHaveAttribute("aria-checked", "true");
  });

  it("records a pick as an unsaved change of the form, saved with the rest", async () => {
    const fetchMock = server(() =>
      answer(200, { message: "Updated", item: { id: "form-1" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = view();

    await pickStatus(user, /^Closed/);
    expect(
      screen.getByRole("button", { name: "Status: Closed" })
    ).toBeVisible();
    expect(within(bar()).getByRole("status")).toHaveTextContent(
      "1 unsaved change"
    );
    // Nothing is sent until Save.
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")
    ).toHaveLength(0);

    await user.click(within(bar()).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(within(bar()).getByRole("status")).toHaveTextContent(
        "All changes saved"
      )
    );
    const [, init] = fetchMock.mock.calls.find(
      ([, each]) => each?.method === "PATCH"
    )!;
    expect(JSON.parse(String(init!.body))).toMatchObject({ status: "closed" });
  });
});

describe("unsaved changes", () => {
  it("counts changes across pages once each, and Undo takes them back in turn", async () => {
    vi.stubGlobal("fetch", server());
    const user = view({ view: "settings" });
    const state = () => within(bar()).getByRole("status");
    const name = screen.getByRole("textbox", { name: "Name" });

    // Typing a name is one change, however many keystrokes.
    await user.type(name, " 2026");
    expect(state()).toHaveTextContent("1 unsaved change");
    await pickStatus(user, /^Draft/);
    expect(state()).toHaveTextContent("2 unsaved changes");

    await user.click(within(bar()).getByRole("button", { name: "Undo" }));
    expect(state()).toHaveTextContent("1 unsaved change");
    expect(screen.getByRole("button", { name: "Status: Live" })).toBeVisible();
    expect(name).toHaveValue("Meetup sign-up 2026");

    await user.click(within(bar()).getByRole("button", { name: "Undo" }));
    expect(state()).toHaveTextContent("All changes saved");
    expect(name).toHaveValue("Meetup sign-up");
    expect(within(bar()).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(within(bar()).getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("a refused save", () => {
  it("keeps the changes and says what to fix, with the way to where it is", async () => {
    vi.stubGlobal(
      "fetch",
      server(() =>
        answer(400, {
          error: {
            code: "VALIDATION_ERROR",
            message: "Validation failed.",
            data: {
              errors: [
                {
                  path: "fields[1].name",
                  code: "DUPLICATE",
                  message: "Two fields are named email.",
                },
              ],
            },
          },
        })
      )
    );
    const user = view({ view: "settings" });
    await user.type(screen.getByRole("textbox", { name: "Name" }), "!");
    await user.click(within(bar()).getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Two fields are named email.");
    // The field is on Builder, so the message leads there.
    expect(
      within(alert).getByRole("link", { name: "Go to Builder" })
    ).toHaveAttribute("href", "/admin/collections/forms/form-1");
    // Nothing was lost.
    expect(within(bar()).getByRole("status")).toHaveTextContent(
      "1 unsaved change"
    );
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "Meetup sign-up!"
    );
  });
});

describe("the form editor's header", () => {
  it("is titled with the form's name, with its field count and API path under it", () => {
    vi.stubGlobal("fetch", server());
    view();
    expect(
      screen.getByRole("heading", { level: 1, name: "Meetup sign-up" })
    ).toBeVisible();
    expect(screen.getByText("/api/forms/meetup")).toBeVisible();
    expect(screen.getByText(/^2 fields/)).toBeVisible();
    // The editor's own heading, metadata box and footer are gone.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("draws the pages as links, each at its own address, the current one marked", async () => {
    vi.stubGlobal("fetch", server());
    view({ view: "notifications" });
    // Submissions joins once the role's permissions say it may read them.
    await screen.findByRole("link", { name: /^Submissions/ });
    const tabs = within(
      screen.getByRole("navigation", { name: "Form pages" })
    ).getAllByRole("link");
    expect(
      tabs.map(tab => [
        tab.textContent?.replace(/\d+$/, ""),
        tab.getAttribute("href"),
        tab.getAttribute("aria-current"),
      ])
    ).toEqual([
      ["Builder", "/admin/collections/forms/form-1", null],
      ["Preview", "/admin/collections/forms/form-1/preview", null],
      ["Settings", "/admin/collections/forms/form-1/settings", null],
      [
        "Notifications",
        "/admin/collections/forms/form-1/notifications",
        "page",
      ],
      ["Submissions", "/admin/collections/forms/form-1/submissions", null],
    ]);
  });

  it("opens Builder on the form's edit address", () => {
    vi.stubGlobal("fetch", server());
    view();
    expect(screen.getByRole("link", { name: /^Builder/ })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});

describe("what a role may do from the editor", () => {
  /** Opens More and reads its items. */
  async function moreItems(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(bar()).getByRole("button", { name: "More" }));
    const items = await screen.findAllByRole("menuitem");
    return items.map(item => item.textContent);
  }

  /**
   * The editor for a role holding `held`, once its permissions have arrived:
   * the submissions count, which reading submissions allows, is the sign.
   */
  async function asRole(held: string[]) {
    permissions = { permissions: [...held, "read-form-submissions"] };
    vi.stubGlobal("fetch", server());
    const user = view({ onDelete: vi.fn() });
    await within(bar()).findByRole("link", { name: "12 submissions" });
    return user;
  }

  it("offers Delete form to a role that may delete forms", async () => {
    // The control for the case below.
    const user = await asRole(["read-forms", "update-forms", "delete-forms"]);
    expect(await moreItems(user)).toContain("Delete form…");
  });

  it("does not offer Delete form to a role that may only change forms", async () => {
    const user = await asRole(["read-forms", "update-forms"]);
    expect(await moreItems(user)).not.toContain("Delete form…");
  });

  it("leaves Submissions out for a role that may not read them", async () => {
    permissions = { permissions: ["read-forms", "update-forms"] };
    vi.stubGlobal("fetch", server());
    view({ view: "submissions" });
    expect(
      await screen.findByText(/can't see this form's submissions/)
    ).toBeVisible();
    const tabs = within(
      screen.getByRole("navigation", { name: "Form pages" })
    ).getAllByRole("link");
    expect(tabs.map(tab => tab.textContent?.replace(/\d+$/, ""))).not.toContain(
      "Submissions"
    );
    expect(
      within(bar()).queryByRole("link", { name: /submissions?$/ })
    ).toBeNull();
  });

  it("shows Submissions to a role that may read them", async () => {
    // The control: the tab and the count come with the permission.
    permissions = {
      permissions: ["read-forms", "update-forms", "read-form-submissions"],
    };
    vi.stubGlobal("fetch", server());
    view();
    expect(
      await within(bar()).findByRole("link", { name: "12 submissions" })
    ).toBeVisible();
    expect(screen.getByRole("link", { name: /^Submissions/ })).toBeVisible();
  });
});
