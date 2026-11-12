// @vitest-environment jsdom

/**
 * One response per email in the builder: the Email field it compares cannot
 * be deleted, made optional or given a condition while it is chosen, each
 * refusal saying why; another Email field can be chosen from its own panel;
 * and a field renamed before it is saved keeps the choice.
 *
 * Run against the real provider and view, so a refusal the panel would
 * bypass fails here.
 */
import { TooltipProvider } from "@nextlyhq/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AnyFormField, FormSettings } from "../types";
import { ONE_RESPONSE_FIELD_REASON } from "../utils/one-response-field";

import {
  FormBuilderProvider,
  useFieldBookkeeping,
  useFormBuilder,
} from "./context/FormBuilderContext";
import { FormBuilderView } from "./FormBuilderView";

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

const EMAIL: AnyFormField = {
  type: "email",
  name: "email",
  label: "Email",
  required: true,
};
const WORK: AnyFormField = {
  type: "email",
  name: "work_email",
  label: "Work email",
  required: true,
};

const BY_EMAIL: Partial<FormSettings> = {
  oneResponse: "email",
  oneResponseField: "email",
};

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
            name: "Meetup",
            slug: "meetup",
            fields: [EMAIL, WORK],
            settings: BY_EMAIL,
          }}
          onSave={save}
        />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return {
    user: userEvent.setup(),
    saved: () =>
      save.mock.lastCall?.[0] as {
        fields: AnyFormField[];
        settings: FormSettings;
      },
  };
}

const row = (label: string) =>
  within(screen.getByRole("list", { name: "Form fields" }))
    .getAllByRole("button", { name: new RegExp(`^${label}`) })
    .find(button => button.hasAttribute("aria-expanded"));

describe("the Email field one response per email compares", () => {
  it("cannot be deleted, saying what uses it", async () => {
    const { user } = view();
    await user.click(
      await screen.findByRole("button", { name: "Actions for Email" })
    );
    const remove = screen.getByRole("menuitem", { name: "Delete" });
    expect(remove).toHaveAttribute("aria-disabled", "true");
    await user.hover(remove);
    expect(
      (await screen.findAllByText(/Used by One response per person/)).length
    ).toBeGreaterThan(0);
    await user.keyboard("{Escape}");
    await user.keyboard("{Escape}");
    // The control: another Email field can still be deleted.
    await user.click(
      screen.getByRole("button", { name: "Actions for Work email" })
    );
    expect(
      screen.getByRole("menuitem", { name: "Delete" })
    ).not.toHaveAttribute("aria-disabled", "true");
  });

  it("stays required: turning Required off is refused", async () => {
    const { user, saved } = view();
    await screen.findByRole("list", { name: "Form fields" });
    await user.click(row("Email")!);
    const required = screen.getByRole("switch", { name: "Required" });
    await user.click(required);
    expect(screen.getByRole("switch", { name: "Required" })).toBeChecked();
    // Another edit is taken, and saved with the field still required.
    const label = screen.getByRole("textbox", { name: "Label" });
    await user.clear(label);
    await user.type(label, "Email address");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved().fields.find(field => field.name === "email")?.required).toBe(
      true
    );
  });

  it("stays shown: its conditions cannot be turned on, and why is said", async () => {
    const { user } = view();
    await screen.findByRole("list", { name: "Form fields" });
    await user.click(row("Email")!);
    await user.click(screen.getByRole("tab", { name: "Conditions" }));
    expect(
      screen.getByRole("checkbox", { name: /Enable conditional logic/ })
    ).toBeDisabled();
    expect(screen.getByText(ONE_RESPONSE_FIELD_REASON)).toBeInTheDocument();
    // The control: another Email field can take a condition.
    await user.click(row("Work email")!);
    await user.click(screen.getByRole("tab", { name: "Conditions" }));
    expect(
      screen.getByRole("checkbox", { name: /Enable conditional logic/ })
    ).toBeEnabled();
  });

  it("can be changed from another Email field's own panel", async () => {
    const { user, saved } = view();
    await screen.findByRole("list", { name: "Form fields" });
    await user.click(row("Work email")!);
    const use = screen.getByRole("switch", {
      name: "Use for one response per person",
    });
    expect(use).not.toBeChecked();
    await user.click(use);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saved().settings).toMatchObject({
      oneResponse: "email",
      oneResponseField: "work_email",
    });
  });
});

describe("a field renamed before it is saved", () => {
  it("keeps the one response per email choice", () => {
    let api:
      | (ReturnType<typeof useFormBuilder> &
          ReturnType<typeof useFieldBookkeeping>)
      | undefined;
    function Probe() {
      api = { ...useFormBuilder(), ...useFieldBookkeeping() };
      return null;
    }
    render(
      <FormBuilderProvider initialData={{ fields: [], settings: {} }}>
        <Probe />
      </FormBuilderProvider>
    );
    const added: AnyFormField = {
      type: "email",
      name: "contact",
      label: "Contact",
      required: true,
    };
    act(() => api!.addField(added));
    act(() =>
      api!.updateSettings({ oneResponse: "email", oneResponseField: "contact" })
    );
    act(() =>
      api!.editField(added, { ...added, name: "contact_email" }, api!.fields)
    );
    expect(api!.fields.map(field => field.name)).toEqual(["contact_email"]);
    expect(api!.settings.oneResponseField).toBe("contact_email");
  });
});
