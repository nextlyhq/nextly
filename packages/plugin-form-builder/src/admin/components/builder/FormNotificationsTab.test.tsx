// @vitest-environment jsdom

/**
 * The notification editor is inline, and these pin the two properties that
 * choice rests on.
 *
 * It replaced a slide-out panel that carried its own save button beside the
 * page's, so the first property is that editing writes THROUGH to the form as
 * it happens — there is no second commit, and a rule the page saves is the rule
 * the author last typed. The second is that one row is open at a time, because
 * several open at once turns the list into a wall of fields and loses the
 * overview the summaries exist to give.
 *
 * jsdom is requested per file rather than in the shared vitest config: the
 * integration suites in this package boot a real Nextly instance and have no
 * use for a DOM.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { FormNotification } from "../../../types";

// Radix calls both when a Select opens and jsdom implements neither, so
// without them a test dies on a missing method rather than failing an
// assertion.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

const updateNotification = vi.fn();
const addNotification = vi.fn();
const deleteNotification = vi.fn();
const duplicateNotification = vi.fn();

let notifications: FormNotification[] = [];

vi.mock("../../context/FormBuilderContext", () => ({
  useFormBuilder: () => ({
    notifications,
    fields: [{ name: "email", label: "Email", type: "email" }],
    addNotification,
    duplicateNotification,
    updateNotification,
    deleteNotification,
  }),
}));

// Imported after the mock, so the component resolves the mocked context.
const { FormNotificationsTab } = await import("./FormNotificationsTab");

function aNotification(over: Partial<FormNotification> = {}): FormNotification {
  return {
    id: "n1",
    name: "Admin notification",
    enabled: true,
    recipientType: "static",
    to: "admin@example.com",
    cc: [],
    bcc: [],
    ...over,
  } as FormNotification;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  notifications = [];
});

describe("the notification list", () => {
  it("shows a summary with the editor closed", () => {
    notifications = [aNotification()];
    render(<FormNotificationsTab defaults={null} />);

    const toggle = screen.getByRole("button", {
      name: /edit notification admin notification/i,
    });
    // The contract the row advertises to assistive tech, not just its looks.
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // No editor field is reachable while the row is closed.
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("opens the editor in place, under the row", async () => {
    notifications = [aNotification()];
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);

    const toggle = screen.getByRole("button", {
      name: /edit notification admin notification/i,
    });
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // In place: the region the toggle names is the one that appeared.
    const region = document.getElementById(
      toggle.getAttribute("aria-controls") as string
    );
    expect(region).not.toBeNull();
    expect(region).toContainElement(screen.getByDisplayValue("Admin notification"));
    // And no dialog: an inline editor that still portals is the old panel
    // wearing a different class.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("writes an edit through as it is typed, with no save press", async () => {
    notifications = [aNotification()];
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);

    await user.click(
      screen.getByRole("button", {
        name: /edit notification admin notification/i,
      })
    );

    await user.type(screen.getByDisplayValue("Admin notification"), "!");

    // The page's action bar is the only commit, so an edit that waited for a
    // button here would be lost by the save the author actually presses.
    expect(updateNotification).toHaveBeenCalled();
    const [id, patch] = updateNotification.mock.calls.at(-1) as [
      string,
      FormNotification,
    ];
    expect(id).toBe("n1");
    expect(patch.name).toBe("Admin notification!");
  });

  it("offers no save or cancel of its own", async () => {
    notifications = [aNotification()];
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);

    await user.click(
      screen.getByRole("button", {
        name: /edit notification admin notification/i,
      })
    );

    // The defect this replaced: two commit buttons on one page, with nothing
    // saying which one persists.
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^cancel$/i })).toBeNull();
  });

  it("closes a row when its own toggle is pressed again", async () => {
    // The separating case for a TOGGLE. Replacing the open row on every press
    // also satisfies "opening another closes the first", so without this an
    // implementation that can never be closed passes.
    notifications = [aNotification()];
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);

    const toggle = screen.getByRole("button", {
      name: /notification admin notification/i,
    });

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByDisplayValue("Admin notification")).toBeNull();
  });

  it("keeps one row open at a time", async () => {
    notifications = [
      aNotification(),
      aNotification({ id: "n2", name: "Second" }),
    ];
    const user = userEvent.setup();
    render(<FormNotificationsTab defaults={null} />);

    const first = screen.getByRole("button", {
      name: /notification admin notification/i,
    });
    const second = screen.getByRole("button", { name: /notification second/i });

    await user.click(first);
    expect(first).toHaveAttribute("aria-expanded", "true");

    await user.click(second);
    expect(second).toHaveAttribute("aria-expanded", "true");
    // The part that matters: accumulating open rows would satisfy the line
    // above and turn the list into a wall of fields.
    expect(first).toHaveAttribute("aria-expanded", "false");
  });
});
