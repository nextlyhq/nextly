// @vitest-environment jsdom

/**
 * The Builder's outline of fields: a row per field with its badges; a field
 * added below a row with "/", or between two rows; a field a notification
 * refers to refused deletion; a saved field's name fixed with the reason; and
 * a rename finished after leaving the Builder still moving what refers to it.
 *
 * @module admin/components/builder/__tests__/outline.test
 */
import { TooltipProvider } from "@nextlyhq/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AnyFormField, FormNotification } from "../../../../types";
import {
  FormBuilderProvider,
  useFormBuilder,
  type FormBuilderContextValue,
} from "../../../context/FormBuilderContext";
import { FormBuilderView } from "../../../FormBuilderView";
import { FieldCards } from "../FieldCards";
import { SAVED_NAME_REASON } from "../forms-field-surface";

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

const EMAIL: AnyFormField = { type: "email", name: "email", label: "Email" };
const TOPIC: AnyFormField = {
  type: "select",
  name: "topic",
  label: "Topic",
  required: true,
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
  conditionalLogic: {
    enabled: true,
    action: "show",
    operator: "AND",
    conditions: [{ field: "topic", comparison: "equals", value: "other" }],
  },
};

/** A notification replying to the visitor at the Email field. */
const TEAM: FormNotification = {
  id: "n1",
  name: "Team",
  enabled: true,
  recipientType: "static",
  to: "team@example.com",
  cc: [],
  bcc: [],
  replyTo: "{{email}}",
  templateSlug: "forms-submission",
};

/** The builder on a saved form, its saves handed to the returned `saved`. */
function view() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    )
  );
  const save = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <FormBuilderView
          entryId="form-1"
          initialData={{
            name: "Contact",
            slug: "contact",
            fields: [EMAIL, TOPIC, DETAILS],
            notifications: [TEAM],
          }}
          onSave={save}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return {
    user: userEvent.setup(),
    savedNames: () =>
      (save.mock.lastCall?.[0] as { fields: AnyFormField[] }).fields.map(
        field => field.name
      ),
  };
}

/** A row's own button, by the field's label. */
const row = (label: string) =>
  within(screen.getByRole("list", { name: "Form fields" }))
    .getAllByRole("button", { name: new RegExp(`^${label}`) })
    .find(button => button.hasAttribute("aria-expanded"));

/** Picks a phone field with `label` in the open picker. */
async function pickPhone(
  user: ReturnType<typeof userEvent.setup>,
  label: string
) {
  const picker = await screen.findByRole("dialog");
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

describe("the outline of fields", () => {
  it("shows each field's type, name and badges in its row", async () => {
    view();
    await screen.findByRole("list", { name: "Form fields" });
    const topic = row("Topic");
    expect(topic).toHaveTextContent("Select");
    expect(topic).toHaveTextContent("topic");
    expect(topic).toHaveTextContent("Required");
    expect(topic).toHaveTextContent("= Sales");
    const details = row("Details");
    expect(within(details!).getByText("Shown if…")).toHaveAttribute(
      "title",
      "Shown depending on Topic"
    );
  });

  it("adds a field below a row with /", async () => {
    const { user, savedNames } = view();
    await screen.findByRole("list", { name: "Form fields" });
    row("Topic")!.focus();
    await user.keyboard("/");
    await pickPhone(user, "Mobile");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(savedNames()).toEqual(["email", "topic", "mobile", "details"]);
  });

  it("adds a field between two rows", async () => {
    const { user, savedNames } = view();
    await user.click(
      await screen.findByRole("button", { name: "Add a field above Details" })
    );
    await pickPhone(user, "Mobile");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(savedNames()).toEqual(["email", "topic", "mobile", "details"]);
  });

  it("adds at the end from the toolbar", async () => {
    // The control for the two above: the place comes from where it was asked
    // for, not from the picker.
    const { user, savedNames } = view();
    await user.click(await screen.findByRole("button", { name: "Add field" }));
    await pickPhone(user, "Mobile");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(savedNames()).toEqual(["email", "topic", "details", "mobile"]);
  });

  it("refuses to delete a field a notification refers to, naming it", async () => {
    const { user } = view();
    await user.click(
      await screen.findByRole("button", { name: "Actions for Email" })
    );
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await user.hover(screen.getByRole("menuitem", { name: "Delete" }));
    expect((await screen.findAllByText(/Used by Team/)).length).toBeGreaterThan(
      0
    );
  });

  it("fixes a saved field's name with the reason, and not a new one's", async () => {
    const { user } = view();
    await screen.findByRole("list", { name: "Form fields" });
    await user.click(row("Email")!);
    expect(screen.getByText(SAVED_NAME_REASON)).toBeInTheDocument();
    // Fixed, not merely explained: the input takes no edit.
    expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Add field" }));
    await pickPhone(user, "Mobile");
    // The new field's settings are open, with no reason given, and its name
    // can still be changed.
    expect(screen.queryByText(SAVED_NAME_REASON)).toBeNull();
    expect(screen.getByRole("textbox", { name: "Name" })).toBeEnabled();
  });
});

describe("a rename across a trip away from the Builder", () => {
  it("moves a condition's and a notification's references, typed through an empty name", async () => {
    let form!: FormBuilderContextValue;
    function Probe() {
      form = useFormBuilder();
      return null;
    }
    let show!: (shown: boolean) => void;
    function Builder() {
      const [shown, setShown] = useState(true);
      show = setShown;
      return shown ? (
        <FieldCards enabledTypes={["text", "email"]} onAddField={() => {}} />
      ) : null;
    }
    render(
      <TooltipProvider>
        <FormBuilderProvider
          initialData={{
            fields: [],
            // Replies to the visitor at the Email field.
            notifications: [{ ...TEAM, replyTo: "{{email}}" }],
          }}
        >
          <Probe />
          <Builder />
        </FormBuilderProvider>
      </TooltipProvider>
    );
    // Two new fields, so neither name is fixed yet: Company shows once Email
    // is answered.
    act(() => {
      form.addField({ type: "email", name: "email", label: "Email" });
      form.addField({
        type: "text",
        name: "company",
        label: "Company",
        conditionalLogic: {
          enabled: true,
          action: "show",
          operator: "AND",
          conditions: [{ field: "email", comparison: "isNotEmpty" }],
        },
      });
    });
    const user = userEvent.setup();
    await user.click(row("Email")!);
    await user.clear(screen.getByRole("textbox", { name: "Name" }));

    // Another page of the editor, then back: the list is drawn again.
    act(() => show(false));
    act(() => show(true));

    // The selection is the provider's, so the field's settings may still be
    // open; open them if not.
    if (screen.queryByRole("textbox", { name: "Name" }) === null) {
      await user.click(row("Email")!);
    }
    await user.type(
      screen.getByRole("textbox", { name: "Name" }),
      "work_email"
    );

    const company = form.fields.find(field => field.name === "company");
    expect(company?.conditionalLogic?.conditions[0]?.field).toBe("work_email");
    expect(form.notifications[0]?.replyTo).toBe("{{work_email}}");
  });
});

describe("the field list drawn on its own", () => {
  /** A window wide enough to dock the settings. */
  function wide() {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("min-width"),
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList
    );
  }

  function list(dockedSettings?: "beside" | "host") {
    render(
      <TooltipProvider>
        <FormBuilderProvider initialData={{ fields: [EMAIL, TOPIC] }}>
          <FieldCards
            enabledTypes={["email"]}
            onAddField={() => {}}
            {...(dockedSettings === undefined ? {} : { dockedSettings })}
          />
        </FormBuilderProvider>
      </TooltipProvider>
    );
  }

  it("docks the selected field's settings beside itself on a wide window", async () => {
    wide();
    list();
    await userEvent.setup().click(row("Email")!);
    expect(
      screen.getByRole("complementary", { name: "Field settings" })
    ).toBeVisible();
  });

  it("leaves docking to a host that docks the settings itself", async () => {
    // The control: the editor draws them against the window's edge, so the
    // list must not draw a second copy.
    wide();
    list("host");
    await userEvent.setup().click(row("Email")!);
    expect(
      screen.queryByRole("complementary", { name: "Field settings" })
    ).toBeNull();
  });
});
