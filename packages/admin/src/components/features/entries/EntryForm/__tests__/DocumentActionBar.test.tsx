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

import {
  acceptContributions,
  DocumentActionBar,
  type ActionBinding,
} from "../DocumentActionBar";
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

describe("a save that must submit rather than call back", () => {
  it("renders a submit button bound to the form", () => {
    /*
     * A collection with NO status column saves by submitting, with no intent
     * attached. Every save handler a host exposes carries one, and the draft
     * handler writes `status: "draft"` — a column such a collection does not
     * have — so routing it through a callback turns Create and Save into a
     * failing write. The control has always been a submit for that reason.
     */
    render(
      <DocumentActionBar
        actions={[{ id: "save", label: "Create", placement: "primary" }]}
        bindings={{
          save: { onSelect: vi.fn(), submitForm: "entry-form" },
        }}
      />
    );

    const create = screen.getByRole("button", { name: /^create$/i });
    expect(create.getAttribute("type")).toBe("submit");
    expect(create.getAttribute("form")).toBe("entry-form");
  });

  it("leaves an ordinary action a plain button that calls back", () => {
    // The control: a bar that submitted everything would satisfy the case
    // above and would submit the form on Publish, which has its own handler.
    const onSelect = vi.fn();
    render(
      <DocumentActionBar
        actions={[{ id: "publish", label: "Publish", placement: "primary" }]}
        bindings={{ publish: { onSelect } }}
      />
    );

    const publish = screen.getByRole("button", { name: /^publish$/i });
    expect(publish.getAttribute("type")).toBe("button");
    expect(publish.getAttribute("form")).toBeNull();
    fireEvent.click(publish);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("a menu action an author may not use", () => {
  it("says why, where a pointer and a screen reader can both reach it", async () => {
    /*
     * The menu is the ONLY place a permission refusal is visible now that
     * Unpublish and Delete live there. A row that is grey and silent reads as
     * broken rather than as forbidden — which is the same complaint the whole
     * reason-bearing model exists to answer.
     */
    render(
      <DocumentActionBar
        actions={[
          { id: "save", label: "Save", placement: "primary" },
          {
            id: "unpublish",
            label: "Unpublish",
            placement: "menu",
            group: "danger",
            destructive: true,
            disabledReason: "You do not have permission to unpublish.",
          },
        ]}
        bindings={{
          save: { onSelect: vi.fn() },
          unpublish: { onSelect: vi.fn() },
        }}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: /more actions/i })
    );

    const item = await screen.findByRole("menuitem", { name: /unpublish/i });
    expect(item.getAttribute("title")).toMatch(/permission/i);
    expect(item.getAttribute("aria-description")).toMatch(/permission/i);
  });

  it("leaves a usable menu action carrying no reason at all", async () => {
    // The control. Attributes attached unconditionally would satisfy the case
    // above while telling every author their available actions are refused.
    render(
      <DocumentActionBar
        actions={[
          { id: "save", label: "Save", placement: "primary" },
          {
            id: "duplicate",
            label: "Duplicate",
            placement: "menu",
            group: "document",
          },
        ]}
        bindings={{
          save: { onSelect: vi.fn() },
          duplicate: { onSelect: vi.fn() },
        }}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: /more actions/i })
    );

    const item = await screen.findByRole("menuitem", { name: /duplicate/i });
    expect(item.getAttribute("title")).toBeNull();
    expect(item.getAttribute("aria-description")).toBeNull();
  });
});

describe("folding in a host's contributions", () => {
  const built: DocumentAction[] = [
    { id: "save", label: "Save", placement: "primary" },
    { id: "delete", label: "Delete", placement: "menu", group: "danger" },
  ];
  const builtDelete = vi.fn();
  const builtBindings = {
    save: { onSelect: vi.fn() },
    delete: { onSelect: builtDelete },
  };

  it("draws a contributed action, wired to the handler that came with it", async () => {
    const run = vi.fn();
    const { actions, bindings } = acceptContributions(built, builtBindings, [
      {
        action: {
          id: "add-to-release",
          label: "Add to release",
          placement: "menu",
          group: "document",
        },
        binding: { onSelect: run },
      },
    ]);
    render(<DocumentActionBar actions={actions} bindings={bindings} />);
    await userEvent.click(
      screen.getByRole("button", { name: /more actions/i })
    );

    const item = await screen.findByRole("menuitem", {
      name: /add to release/i,
    });
    fireEvent.click(item);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("leaves a built-in bound to its OWN handler when a contribution reuses its id", () => {
    /*
     * The substitution this exists to prevent, and the reason one function
     * decides both halves. If the action list drops the colliding contribution
     * while the binding map accepts it, the bar draws the model's Delete —
     * label, danger styling, permission reason and all — running somebody
     * else's handler. Nothing about that looks wrong on screen.
     */
    const impostor = vi.fn();
    const { actions, bindings } = acceptContributions(built, builtBindings, [
      {
        action: { id: "delete", label: "Delete everything", placement: "menu" },
        binding: { onSelect: impostor },
      },
    ]);

    expect(actions.filter(a => a.id === "delete")).toHaveLength(1);
    expect(bindings["delete"]?.onSelect).toBe(builtDelete);
    expect(bindings["delete"]?.onSelect).not.toBe(impostor);
  });

  it("leaves the built-in bindings alone when nothing is contributed", () => {
    // The control: a merge that rebuilt the map could drop a built-in binding,
    // and an action with no binding is not drawn at all.
    const { actions, bindings } = acceptContributions(built, builtBindings, []);
    expect(actions).toEqual(built);
    expect(bindings["delete"]?.onSelect).toBe(builtDelete);
    expect(bindings["save"]).toBeDefined();
  });
});
