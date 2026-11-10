// @vitest-environment jsdom

/**
 * The Form Builder adds and edits fields through the shared field picker and
 * settings panel, configured for forms. Run against the real view, so each
 * test passes through the picker, the panel, the forms configuration, the
 * mapping between a form field and the panel's, and the form's own save.
 *
 * What each test separates from a plausible broken builder:
 * - adding, editing and reordering end in the SAVED fields, not only on screen;
 * - a setting the panel has no place for survives an edit the panel did make;
 * - the form's own rules and conditions are the ones offered;
 * - a saved field's type reads as fixed, with the reason, and a new one's not;
 * - a field another field refers to still cannot be deleted.
 *
 * @module admin/components/builder/__tests__/shared-parts.test
 */
import { TooltipProvider } from "@nextlyhq/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AnyFormField, FormNotification } from "../../../../types";
import { FormBuilderProvider } from "../../../context/FormBuilderContext";
import { FormBuilderView } from "../../../FormBuilderView";
import { FieldCards } from "../FieldCards";
import { SAVED_TYPE_REASON } from "../forms-field-surface";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TOPIC: AnyFormField = {
  type: "select",
  name: "topic",
  label: "Topic",
  options: [
    { label: "Sales", value: "sales" },
    { label: "Other", value: "other" },
  ],
  defaultValue: "sales",
};

const DETAILS: AnyFormField = {
  type: "textarea",
  name: "details",
  label: "Details",
  rows: 6,
  helpText: "Tell us more",
  conditionalLogic: {
    enabled: true,
    action: "show",
    operator: "AND",
    conditions: [{ field: "topic", comparison: "equals", value: "other" }],
  },
};

const EMAIL: AnyFormField = { type: "email", name: "email", label: "Email" };

/** A notification that refers to two of the fields. */
const TEAM: FormNotification = {
  id: "n1",
  name: "Team",
  enabled: true,
  recipientType: "static",
  to: "team@example.com",
  cc: [],
  bcc: [],
  replyTo: "{{email}}",
  condition: { field: "topic", comparison: "equals", value: "sales" },
  templateSlug: "forms-submission",
};

/** The builder on a saved form, answering its settings read with `config`. */
function view(
  config: Record<string, unknown> = {},
  notifications: FormNotification[] = [],
  onSave: (data: unknown) => void | Promise<void> = () => {}
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(config), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    )
  );
  const save = vi.fn(onSave);
  render(
    // The admin's own providers: queries, and the tooltip a refused Delete
    // explains itself with.
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <FormBuilderView
          entryId="form-1"
          initialData={{
            name: "Contact",
            slug: "contact",
            fields: [EMAIL, TOPIC, DETAILS],
            notifications,
          }}
          onSave={save}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return {
    user: userEvent.setup(),
    /** The fields the last save sent. */
    saved: () => (save.mock.lastCall?.[0] as { fields: AnyFormField[] }).fields,
    /** The notifications the last save sent. */
    savedNotifications: () =>
      (save.mock.lastCall?.[0] as { notifications: FormNotification[] })
        .notifications,
  };
}

/** Opens a field's settings by its card's header. */
async function open(user: ReturnType<typeof userEvent.setup>, label: string) {
  const toggle = screen
    .getAllByRole("button", { name: new RegExp(label) })
    .find(
      button =>
        button.hasAttribute("aria-expanded") &&
        !button.hasAttribute("aria-haspopup")
    );
  if (!toggle) throw new Error(`no card for ${label}`);
  await user.click(toggle);
}

/** Adds a phone field through the picker, with the label given. */
async function addPhone(
  user: ReturnType<typeof userEvent.setup>,
  label: string
) {
  await user.click(await screen.findByRole("button", { name: "Add field" }));
  const picker = screen.getByRole("dialog");
  await user.type(
    within(picker).getByRole("combobox", { name: "Search field types" }),
    "phone{Enter}"
  );
  await user.type(
    within(picker).getByRole("textbox", { name: "Label" }),
    label
  );
  await user.click(within(picker).getByRole("button", { name: "Add field" }));
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
}

describe("the Form Builder on the shared picker and panel", () => {
  it("adds, edits and reorders a field through the shared parts", async () => {
    const { user, saved } = view();

    // The picker, once the site's field types have arrived.
    await user.click(await screen.findByRole("button", { name: "Add field" }));
    const picker = screen.getByRole("dialog");
    await user.type(
      within(picker).getByRole("combobox", { name: "Search field types" }),
      "phone{Enter}"
    );
    await user.type(
      within(picker).getByRole("textbox", { name: "Label" }),
      "Mobile number"
    );
    await user.click(within(picker).getByRole("button", { name: "Add field" }));

    // The panel opens on the new field, its name taken from the label.
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "mobile_number"
    );
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "We call once"
    );

    // Moved above Details from its card's menu.
    await user.click(
      screen.getByRole("button", { name: "Actions for Mobile number" })
    );
    await user.click(screen.getByRole("menuitem", { name: "Move up" }));

    await save(user);
    expect(saved().map(field => field.name)).toEqual([
      "email",
      "topic",
      "mobile_number",
      "details",
    ]);
    expect(saved()[2]).toStrictEqual({
      type: "phone",
      name: "mobile_number",
      label: "Mobile number",
      required: false,
      helpText: "We call once",
    });
  });

  it("keeps what the panel has no place for through an edit it makes", async () => {
    const { user, saved } = view();
    await open(user, "Details");
    const label = screen.getByRole("textbox", { name: "Label" });
    await user.clear(label);
    await user.type(label, "More details");

    await save(user);
    // The rows and the show-or-hide logic travel through the panel untouched.
    expect(saved()[2]).toStrictEqual({ ...DETAILS, label: "More details" });
  });

  it("edits a setting only a form has, beside the panel's own", async () => {
    const { user, saved } = view();
    await open(user, "Details");
    const rows = screen.getByRole("spinbutton", { name: /Rows/ });
    expect(rows).toHaveValue(6);
    await user.clear(rows);
    await user.type(rows, "9");

    await save(user);
    expect(saved()[2]).toStrictEqual({ ...DETAILS, rows: 9 });
  });

  it("offers only the rules the form's checks enforce", async () => {
    const { user } = view();
    await open(user, "Email");
    await user.click(screen.getByRole("tab", { name: "Validation" }));
    expect(screen.getByLabelText("Pattern")).toBeInTheDocument();
    // Core allows length bounds on an email; the form's check reads neither.
    expect(screen.queryByLabelText("Min length")).toBeNull();
  });

  it("edits a field's conditions in the form's own editor", async () => {
    const { user } = view();
    await open(user, "Details");
    await user.click(screen.getByRole("tab", { name: "Conditions" }));
    // The form's editor, holding the field's condition on Topic.
    expect(
      screen.getByRole("checkbox", { name: /Enable conditional logic/ })
    ).toBeChecked();
    expect(screen.getAllByText("Topic").length).toBeGreaterThan(0);
  });

  it("fixes a saved field's type with the reason, and not a new one's", async () => {
    const { user } = view();
    await open(user, "Email");
    expect(screen.getByText(SAVED_TYPE_REASON)).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Add field" }));
    const picker = screen.getByRole("dialog");
    await user.type(
      within(picker).getByRole("combobox", { name: "Search field types" }),
      "phone{Enter}"
    );
    await user.type(
      within(picker).getByRole("textbox", { name: "Label" }),
      "Mobile"
    );
    await user.click(within(picker).getByRole("button", { name: "Add field" }));
    // The panel is the new field's, which has no reason to show.
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("mobile");
    expect(screen.queryByText(SAVED_TYPE_REASON)).toBeNull();
  });

  it("treats a field added under a deleted saved field's name as new", async () => {
    const { user } = view();
    await user.click(screen.getByRole("button", { name: "Actions for Email" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    await user.click(await screen.findByRole("button", { name: "Add field" }));
    const picker = screen.getByRole("dialog");
    await user.type(
      within(picker).getByRole("combobox", { name: "Search field types" }),
      "phone{Enter}"
    );
    await user.type(
      within(picker).getByRole("textbox", { name: "Label" }),
      "Email"
    );
    await user.click(within(picker).getByRole("button", { name: "Add field" }));
    // The stored form's "email" is gone; this one is new, its type its own.
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("email");
    expect(screen.queryByText(SAVED_TYPE_REASON)).toBeNull();
  });

  it("adds a field whose label has none of a name's letters", async () => {
    const { user, saved } = view();
    await user.click(await screen.findByRole("button", { name: "Add field" }));
    const picker = screen.getByRole("dialog");
    await user.type(
      within(picker).getByRole("combobox", { name: "Search field types" }),
      "phone{Enter}"
    );
    await user.type(
      within(picker).getByRole("textbox", { name: "Label" }),
      "電話番号"
    );
    await user.click(within(picker).getByRole("button", { name: "Add field" }));

    await save(user);
    expect(saved()[3]).toMatchObject({
      type: "phone",
      name: "field",
      label: "電話番号",
    });
  });

  it("moves what refers to a field with its new name, typed through an empty one", async () => {
    const { user, saved, savedNotifications } = view({}, [TEAM]);
    // Clear, then type: the rename passes through the empty name.
    await open(user, "Topic");
    const name = () => screen.getByRole("textbox", { name: "Name" });
    await user.clear(name());
    await user.type(name(), "subject");
    await open(user, "Email");
    await user.clear(name());
    await user.type(name(), "contact_email");

    await save(user);
    const details = saved().find(field => field.label === "Details");
    expect(details?.conditionalLogic?.conditions).toEqual([
      { field: "subject", comparison: "equals", value: "other" },
    ]);
    expect(savedNotifications()[0]).toMatchObject({
      replyTo: "{{contact_email}}",
      condition: { field: "subject" },
    });
  });

  it("keeps a name unique when a label edit gives one already used", async () => {
    const { user, saved } = view();
    await user.click(await screen.findByRole("button", { name: "Add field" }));
    const picker = screen.getByRole("dialog");
    await user.type(
      within(picker).getByRole("combobox", { name: "Search field types" }),
      "text{Enter}"
    );
    await user.type(
      within(picker).getByRole("textbox", { name: "Label" }),
      "Notes"
    );
    await user.click(within(picker).getByRole("button", { name: "Add field" }));

    // An unsaved field's name follows its label, here onto Topic's.
    const label = screen.getByRole("textbox", { name: "Label" });
    await user.clear(label);
    await user.type(label, "Topic");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
      "topic_2"
    );

    await save(user);
    const names = saved().map(field => field.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("fixes the type of a field once a host's own save has stored it", async () => {
    const { user } = view();
    await user.click(await screen.findByRole("button", { name: "Add field" }));
    const picker = screen.getByRole("dialog");
    await user.type(
      within(picker).getByRole("combobox", { name: "Search field types" }),
      "phone{Enter}"
    );
    await user.type(
      within(picker).getByRole("textbox", { name: "Label" }),
      "Mobile"
    );
    await user.click(within(picker).getByRole("button", { name: "Add field" }));
    expect(screen.queryByText(SAVED_TYPE_REASON)).toBeNull();

    // Saved through the host's callback: the field is now a stored one.
    await save(user);
    expect(await screen.findByText(SAVED_TYPE_REASON)).toBeInTheDocument();
  });

  it("counts as stored only the fields a pending host save was handed", async () => {
    let finish!: () => void;
    const { user } = view({}, [], () => new Promise<void>(r => (finish = r)));
    await addPhone(user, "Mobile");
    await save(user);
    // Added while the host is still saving: not part of what it stores.
    await addPhone(user, "Landline");
    finish();

    // Once the save has landed (Mobile reads as stored), Landline still is not.
    await open(user, "Mobile");
    expect(await screen.findByText(SAVED_TYPE_REASON)).toBeInTheDocument();
    await open(user, "Landline");
    expect(screen.queryByText(SAVED_TYPE_REASON)).toBeNull();
  });

  it("starts no second host save while one is under way", async () => {
    let finish!: () => void;
    const pending = vi.fn(() => new Promise<void>(r => (finish = r)));
    const { user } = view({}, [], pending);
    await save(user);
    // The action bar's save is held while the host's save is pending.
    const button = screen.getByRole("button", { name: /sav/i });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(pending).toHaveBeenCalledTimes(1);
    finish();
    expect(
      await screen.findByRole("button", { name: "Save Changes" })
    ).toBeEnabled();
  });

  it("drops a choice field's default when its choice is removed", async () => {
    const { user, saved } = view();
    await open(user, "Topic");
    // Sales is the default; remove it.
    await user.click(
      screen.getAllByRole("button", { name: "Remove option" })[0]!
    );

    await save(user);
    const topic = saved().find(field => field.name === "topic");
    expect(topic).toMatchObject({
      options: [{ label: "Other", value: "other" }],
    });
    expect(topic).not.toHaveProperty("defaultValue");
  });

  it("clears a failed host save's message once a retry succeeds", async () => {
    let attempt = 0;
    const { user } = view({}, [], () => {
      attempt += 1;
      if (attempt === 1) throw new Error("The host is offline");
    });
    await save(user);
    expect(await screen.findByText("The host is offline")).toBeInTheDocument();
    await save(user);
    expect(screen.queryByText("The host is offline")).toBeNull();
  });

  it("hands a host's add callback the type first, then the picker's choice", async () => {
    const onAddField = vi.fn();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TooltipProvider>
          <FormBuilderProvider initialData={{ fields: [EMAIL] }}>
            <FieldCards enabledTypes={["phone"]} onAddField={onAddField} />
          </FormBuilderProvider>
        </TooltipProvider>
      </QueryClientProvider>
    );
    await user.click(screen.getByRole("button", { name: "Add field" }));
    const picker = screen.getByRole("dialog");
    await user.type(
      within(picker).getByRole("combobox", { name: "Search field types" }),
      "phone{Enter}"
    );
    await user.type(
      within(picker).getByRole("textbox", { name: "Label" }),
      "Mobile"
    );
    await user.click(within(picker).getByRole("button", { name: "Add field" }));
    // A host written for the type alone still gets it as the first argument.
    expect(onAddField).toHaveBeenCalledWith(
      "phone",
      expect.objectContaining({
        type: "phone",
        label: "Mobile",
        name: "mobile",
      })
    );
  });

  it("refuses to delete a field another field's condition refers to", async () => {
    const { user } = view();
    await user.click(screen.getByRole("button", { name: "Actions for Topic" }));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });

  it("leaves a type the site switched off out of the picker", async () => {
    const { user } = view({ fields: { phone: false } });
    await user.click(await screen.findByRole("button", { name: "Add field" }));
    const picker = screen.getByRole("dialog");
    await user.type(
      within(picker).getByRole("combobox", { name: "Search field types" }),
      "phone"
    );
    expect(within(picker).queryByRole("option", { name: /Phone/ })).toBeNull();
    // Positive control: the search itself finds a type that is on.
    await user.clear(
      within(picker).getByRole("combobox", { name: "Search field types" })
    );
    await user.type(
      within(picker).getByRole("combobox", { name: "Search field types" }),
      "email"
    );
    expect(
      within(picker).getByRole("option", { name: /Email/ })
    ).toBeInTheDocument();
  });
});
