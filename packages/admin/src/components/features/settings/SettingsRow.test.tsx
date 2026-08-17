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
