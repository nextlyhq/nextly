/**
 * Drawing the document's actions where each said it belongs.
 *
 * `document-actions.test` covers WHICH actions exist; this covers what becomes
 * of them. The two are apart because they fail differently — a correct action
 * list still misleads if the bar draws a menu item as a button, and a correct
 * bar draws the wrong set if the model is wrong.
 *
 * @module components/features/entries/EntryForm/__tests__/DocumentActionBar.test
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { fireEvent, render, screen } from "@admin/__tests__/utils";

import { DocumentActionBar, type ActionBinding } from "../DocumentActionBar";
import type { DocumentAction } from "../document-actions";

const ACTIONS: DocumentAction[] = [
  { id: "publish", label: "Publish changes", placement: "primary" },
  { id: "save", label: "Save", placement: "toolbar" },
  { id: "duplicate", label: "Duplicate", placement: "menu", group: "document" },
  {
    id: "unpublish",
    label: "Unpublish",
    placement: "menu",
    group: "danger",
    destructive: true,
  },
];

/** Every action wired, unless a case says otherwise. */
function allBound(
  over: Record<string, ActionBinding | undefined> = {}
): Record<string, ActionBinding | undefined> {
  return {
    publish: { onSelect: vi.fn() },
    save: { onSelect: vi.fn() },
    duplicate: { onSelect: vi.fn() },
    unpublish: { onSelect: vi.fn() },
    ...over,
  };
}

const button = (name: RegExp) => screen.queryByRole("button", { name });

describe("where each action ends up", () => {
  it("draws the leading action as a button and the menu ones as menu items", () => {
    render(<DocumentActionBar actions={ACTIONS} bindings={allBound()} />);

    expect(button(/^publish changes$/i)).toBeTruthy();
    expect(button(/^save$/i)).toBeTruthy();
    // The demotion that matters: Unpublish is no longer one slip from Publish.
    expect(button(/^unpublish$/i)).toBeNull();
    expect(button(/^duplicate$/i)).toBeNull();
    expect(button(/more actions/i)).toBeTruthy();
  });

  it("marks exactly one control as the leading one", () => {
    // The model guarantees one primary action; this is the half that guarantees
    // one primary CONTROL, which is a different claim about a different layer.
    const { container } = render(
      <DocumentActionBar actions={ACTIONS} bindings={allBound()} />
    );
    expect(container.querySelectorAll("[data-primary='true']").length).toBe(1);
  });

  it("opens the menu onto both groups, with a rule between them", async () => {
    /*
     * `userEvent` rather than `fireEvent`, because the menu is Radix and opens
     * on a pointer sequence rather than on a bare click — a plain click leaves
     * it closed and the assertions below would report the items as missing when
     * the menu simply never opened.
     */
    render(<DocumentActionBar actions={ACTIONS} bindings={allBound()} />);
    await userEvent.click(
      screen.getByRole("button", { name: /more actions/i })
    );

    const items = await screen.findAllByRole("menuitem");
    // Order is the contract: routine verbs first, destructive ones after.
    expect(items.map(item => item.textContent)).toEqual([
      "Duplicate",
      "Unpublish",
    ]);
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("draws no rule when only one group has anything in it", async () => {
    /*
     * The control. A separator drawn unconditionally becomes a rule at the top
     * or bottom of the menu, which reads as a group whose items failed to
     * render — the same "something is missing here" the panel work was about.
     */
    render(
      <DocumentActionBar
        actions={ACTIONS}
        bindings={allBound({ unpublish: undefined })}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: /more actions/i })
    );

    expect(await screen.findAllByRole("menuitem")).toHaveLength(1);
    expect(screen.queryByRole("separator")).toBeNull();
  });
});

describe("an action a host did not wire", () => {
  it("is not drawn at all", () => {
    /*
     * How an optional affordance disappears — a collection with no duplicate
     * handler — without the model needing to know which handlers a host passed.
     */
    render(
      <DocumentActionBar
        actions={ACTIONS}
        bindings={allBound({ duplicate: undefined, unpublish: undefined })}
      />
    );
    // Both menu entries were the only menu content, so the trigger goes too:
    // a menu button opening onto nothing is the empty-panel defect again.
    expect(button(/more actions/i)).toBeNull();
  });

  it("still draws the ones that ARE wired", () => {
    // The control. A bar that dropped everything would satisfy the case above.
    render(
      <DocumentActionBar
        actions={ACTIONS}
        bindings={allBound({ duplicate: undefined })}
      />
    );
    expect(button(/^publish changes$/i)).toBeTruthy();
    expect(button(/more actions/i)).toBeTruthy();
  });
});

describe("an action that cannot be used", () => {
  it("is disabled and says why, from either kind of reason", () => {
    /*
     * Two sources, deliberately kept apart: the MODEL knows about permission
     * and document state, the BINDING knows about this instant — mid-submit,
     * invalid, nothing changed. Both must reach the control, or an author sees
     * a dead button with no explanation.
     */
    const withModelReason: DocumentAction[] = [
      {
        id: "publish",
        label: "Publish",
        placement: "primary",
        disabledReason: "You do not have permission to publish.",
      },
      { id: "save", label: "Save", placement: "toolbar" },
    ];
    render(
      <DocumentActionBar
        actions={withModelReason}
        bindings={{
          publish: { onSelect: vi.fn() },
          save: { onSelect: vi.fn(), disabledReason: "Nothing to save." },
        }}
      />
    );

    const publish = screen.getByRole("button", { name: /^publish$/i });
    expect(publish).toBeDisabled();
    expect(publish.getAttribute("title")).toMatch(/permission/i);

    const save = screen.getByRole("button", { name: /^save$/i });
    expect(save).toBeDisabled();
    expect(save.getAttribute("title")).toMatch(/nothing to save/i);
  });

  it("leaves a usable action enabled, titled with its own label", () => {
    // The control: a bar that disabled everything, or titled everything with a
    // reason, would satisfy the case above.
    render(<DocumentActionBar actions={ACTIONS} bindings={allBound()} />);
    const publish = screen.getByRole("button", { name: /^publish changes$/i });
    expect(publish).toBeEnabled();
    expect(publish.getAttribute("title")).toBe("Publish changes");
  });

  it("does not run when pressed", () => {
    const onSelect = vi.fn();
    render(
      <DocumentActionBar
        actions={[
          {
            id: "publish",
            label: "Publish",
            placement: "primary",
            disabledReason: "no",
          },
        ]}
        bindings={{ publish: { onSelect } }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("running an action", () => {
  it("calls the binding the host supplied", () => {
    const publish = vi.fn();
    render(
      <DocumentActionBar
        actions={ACTIONS}
        bindings={allBound({ publish: { onSelect: publish } })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /^publish changes$/i }));
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
