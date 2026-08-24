import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { useForm } from "react-hook-form";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
} from "@admin/components/ui/form";
import { resetLabelLandingWarnings } from "@admin/lib/forms/label-landing";

import { SettingsRow } from "./SettingsRow";

function Harness({
  description,
  children,
}: {
  description?: string;
  children: ReactNode;
}) {
  const form = useForm({ defaultValues: { foo: "" } });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="foo"
        render={() => (
          <FormItem>
            <SettingsRow label="My Label" description={description}>
              {children}
            </SettingsRow>
          </FormItem>
        )}
      />
    </Form>
  );
}

/** The shape a caller is supposed to write: FormControl directly on the control. */
function WiredControl() {
  return (
    <FormControl>
      <input data-testid="control" />
    </FormControl>
  );
}

describe("SettingsRow", () => {
  it("supplies no vertical padding of its own", () => {
    // `FormSection` now applies the rhythm to every direct child, so a row that
    // also padded itself would double it on exactly the sections that were
    // already correct. The horizontal grid stays this component's business —
    // that is what makes it a two-column row rather than a stacked field.
    const { container } = render(
      <Harness>
        <WiredControl />
      </Harness>
    );
    // The row is the grid element itself, found by the two-column template that
    // makes it a row rather than by its position in the tree.
    const row = container.querySelector('[class*="md:grid-cols-[2fr_3fr]"]');

    expect(row).not.toBeNull();
    expect(row?.className).not.toMatch(/(^|\s)py-/);
  });

  it("renders the label", () => {
    render(<Harness>{<WiredControl />}</Harness>);
    expect(screen.getByText("My Label")).toBeInTheDocument();
  });

  it("renders the description when provided", () => {
    render(<Harness description="extra help">{<WiredControl />}</Harness>);
    expect(screen.getByText("extra help")).toBeInTheDocument();
  });

  it("renders the control slot", () => {
    render(<Harness>{<WiredControl />}</Harness>);
    expect(screen.getByTestId("control")).toBeInTheDocument();
  });

  it("associates the label with the control", () => {
    render(<Harness>{<WiredControl />}</Harness>);
    // `getByLabelText` resolves the association the way assistive technology
    // does, so it fails for a label pointing at nothing AND for one pointing at
    // an element that cannot carry a name — which asserting on `htmlFor` alone
    // would not.
    expect(screen.getByLabelText("My Label")).toBe(
      screen.getByTestId("control")
    );
  });

  it("keeps the description out of the control's accessible name", () => {
    render(<Harness description="extra help">{<WiredControl />}</Harness>);
    // An exact match, which is the assertion: while the description sat INSIDE
    // the label, the name was "My Labelextra help" and a screen reader read the
    // whole paragraph out on every focus. The description belongs in
    // aria-describedby, asserted below, not in the name.
    expect(screen.getByLabelText("My Label")).toBe(
      screen.getByTestId("control")
    );
  });

  it("connects the description to the control", () => {
    render(<Harness description="extra help">{<WiredControl />}</Harness>);
    const describedBy = screen
      .getByTestId("control")
      .getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // The id has to resolve to the text on the page. `aria-describedby` naming
    // an element that does not exist is the failure this whole file is about,
    // one attribute over.
    expect(document.getElementById(String(describedBy))?.textContent).toBe(
      "extra help"
    );
  });

  it("emits no description reference when there is no description", () => {
    render(<Harness>{<WiredControl />}</Harness>);
    // The complement of the case above: a control that always claimed a
    // description would point at an element that never rendered.
    expect(
      screen.getByTestId("control").getAttribute("aria-describedby")
    ).toBeNull();
  });
});

describe("SettingsRow label landing check", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetLabelLandingWarnings();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("stays silent when the id reaches the control", () => {
    render(<Harness>{<WiredControl />}</Harness>);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when no element claims the id", () => {
    // A control rendered without FormControl: it looks correct on screen and
    // nothing throws, which is why this shipped three times.
    render(
      <Harness>
        <input data-testid="control" />
      </Harness>
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "no element carries that id"
    );
  });

  it("warns when the id lands on a wrapper instead of the control", () => {
    // The live shape this check was written for: FormControl clones onto its
    // single child, so a positioning wrapper absorbs the id. `getElementById`
    // finds it and a presence-only check reports the row as correctly wired.
    render(
      <Harness>
        <FormControl>
          <div className="relative">
            <input data-testid="control" />
          </div>
        </FormControl>
      </Harness>
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      "is not one a label can name"
    );
    // The control the label should have reached is present and labelable, so
    // the warning is about the id's destination rather than about a row that
    // rendered no control at all.
    expect(screen.getByTestId("control")).toBeInTheDocument();
  });

  it("names the field and the id it could not resolve", () => {
    render(
      <Harness>
        <input data-testid="control" />
      </Harness>
    );
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('"My Label"');
    expect(message).toContain("-form-item");
  });
});
