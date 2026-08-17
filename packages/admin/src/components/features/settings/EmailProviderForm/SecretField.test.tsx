/**
 * Telling the server's mask from a credential that merely looks like one.
 *
 * The mask is bullets, and bullets are a legal password. A field that decides
 * "this came from storage" by inspecting its own characters therefore wipes a
 * credential the user just typed the moment they press reveal — so provenance
 * has to arrive from outside the value.
 */

import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { Form } from "@admin/components/ui/form";

import { MASKED_SECRET } from "./schemas/emailProviderSchema";
import type { ProviderFormValues } from "./schemas/emailProviderSchema";
import { SecretField } from "./SecretField";

function Harness({
  initialValue,
  storedSecret,
  clearable,
}: {
  initialValue: string;
  storedSecret: boolean;
  clearable?: boolean;
}) {
  const form = useForm<ProviderFormValues>({
    defaultValues: {
      name: "",
      type: "acme",
      fromEmail: "",
      fromName: "",
      isDefault: false,
      isActive: true,
      configuration: { apiKey: initialValue },
    },
  });

  return (
    <Form {...form}>
      <form>
        <SecretField
          control={form.control}
          name="configuration.apiKey"
          label="API Key"
          storedSecret={storedSecret}
          clearable={clearable}
        />
        {/* What the FORM holds, which is what a submit would carry — distinct
            from what the input displays while it is being edited. */}
        <output data-testid="form-value">
          {String(form.watch("configuration.apiKey") ?? "")}
        </output>
      </form>
    </Form>
  );
}

/** The value the form would submit, as opposed to what the input shows. */
function currentFormValue(): string {
  return screen.getByTestId("form-value").textContent ?? "";
}

function secretInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    'input[name="configuration.apiKey"]'
  );
  if (!input) throw new Error("the credential input did not render");
  return input;
}

describe("the row's label", () => {
  it("names the credential input itself", () => {
    render(<Harness initialValue="" storedSecret={false} />);
    // Queried the way assistive technology resolves a name, rather than by
    // selector: the id used to land on the positioning wrapper around this
    // input, which a lookup finds and a label cannot name. Every test in this
    // file reached the control by `name` or by role, so none of them could see
    // that the field had no accessible name at all.
    expect(screen.getByLabelText("API Key")).toBe(secretInput());
  });

  it("connects the helper text to the input for a stored credential", () => {
    render(<Harness initialValue={MASKED_SECRET} storedSecret={true} />);
    const describedBy = secretInput().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // The description has to be reachable from the input, not merely present on
    // the page: `aria-describedby` naming an id is only a promise, and the
    // element it names is what a screen reader actually reads out.
    const description = document.getElementById(
      String(describedBy).split(" ")[0] ?? ""
    );
    expect(description?.textContent).toContain("Existing secret is configured");
  });
});

describe("a credential made only of the characters the mask uses", () => {
  it("survives a reveal on a create", async () => {
    const user = userEvent.setup();
    render(<Harness initialValue="" storedSecret={false} />);

    const input = secretInput();
    await user.type(input, "••••••••");
    await user.tab();
    await user.click(screen.getByRole("button", { name: /show value/i }));

    // Nothing was stored, so nothing here is a placeholder — whatever it looks
    // like, it is what the user typed.
    expect(input.value).toBe("••••••••");
  });

  it("survives a reveal after replacing a stored one", async () => {
    const user = userEvent.setup();
    render(<Harness initialValue={MASKED_SECRET} storedSecret />);

    const input = secretInput();
    await user.clear(input);
    await user.type(input, "••••");
    await user.tab();
    await user.click(screen.getByRole("button", { name: /show value/i }));

    // A credential IS stored here, so the only thing separating the mask from
    // this value is that the user typed this one.
    expect(input.value).toBe("••••");
  });

  it("lets a typed value replace the real mask", async () => {
    const user = userEvent.setup();
    render(<Harness initialValue={MASKED_SECRET} storedSecret />);

    await user.click(screen.getByRole("button", { name: /show value/i }));
    await user.type(secretInput(), "brand-new-secret");

    // The control for the two cases above. Focus blanks only what is
    // DISPLAYED, so the form never holds "" without the user having emptied it
    // — and typing replaces the mask rather than appending to it, which is the
    // property clearing existed to provide.
    expect(secretInput().value).toBe("brand-new-secret");
  });

  it("leaves the mask alone when a reveal is followed by no typing", async () => {
    const user = userEvent.setup();
    render(<Harness initialValue={MASKED_SECRET} storedSecret />);

    await user.click(screen.getByRole("button", { name: /show value/i }));
    await user.tab();

    // The case that made clearing fragile: every submit path that does not
    // blur first read the empty field as a deliberate removal. There is no
    // empty window to misread now.
    expect(secretInput().value).toBe(MASKED_SECRET);
  });
});

describe("submitting without ever leaving the credential field", () => {
  it("keeps the stored mask in the form", async () => {
    // Enter from inside the field submits without firing blur. The previous
    // design cleared the FORM value on focus and restored it on blur, so this
    // path read an untouched credential as a deliberate removal and deleted
    // it. The form now never holds the empty value at all.
    const user = userEvent.setup();
    render(<Harness initialValue={MASKED_SECRET} storedSecret />);

    const input = secretInput();
    await user.click(input);
    // Displayed empty so typing replaces rather than appends...
    expect(input.value).toBe("");

    // ...but no blur, no restoration, and the value the form submits is the
    // mask — which is what "leave this credential alone" means on the wire.
    expect(currentFormValue()).toBe(MASKED_SECRET);
  });

  it("submits what was typed when the user did type", async () => {
    // The control: the blanking must not make a real replacement invisible.
    const user = userEvent.setup();
    render(<Harness initialValue={MASKED_SECRET} storedSecret />);

    await user.click(secretInput());
    await user.type(secretInput(), "a-new-credential");

    expect(currentFormValue()).toBe("a-new-credential");
  });
});

describe("removing a stored credential rather than replacing it", () => {
  it("puts an empty value in the form when the remove control is used", async () => {
    // The field shows itself as empty while the form holds the mask, so
    // Backspace over that blank changes no value and fires no `onChange`.
    // Without a gesture of its own, an operator can replace a stored optional
    // credential and never remove one.
    const user = userEvent.setup();
    render(<Harness initialValue={MASKED_SECRET} storedSecret clearable />);

    await user.click(
      screen.getByRole("button", { name: /remove stored value/i })
    );

    // An empty optional value is what the payload builder reads as a removal;
    // the mask is what it reads as "leave this alone".
    expect(currentFormValue()).toBe("");
    expect(secretInput().value).toBe("");
  });

  it("proves the keyboard alone cannot do it", async () => {
    // The control for the case above. If this ever starts passing, the remove
    // control has stopped being the only route and the test above is no longer
    // testing what it says.
    const user = userEvent.setup();
    render(<Harness initialValue={MASKED_SECRET} storedSecret clearable />);

    await user.click(secretInput());
    await user.keyboard("{Backspace}{Backspace}{Delete}");

    expect(currentFormValue()).toBe(MASKED_SECRET);
  });

  it("is not offered for a credential that cannot be empty", () => {
    // A required credential has no empty state to be put into, so an affordance
    // for it would only ever produce a validation error.
    render(<Harness initialValue={MASKED_SECRET} storedSecret />);

    expect(
      screen.queryByRole("button", { name: /remove stored value/i })
    ).not.toBeInTheDocument();
  });

  it("is not offered when nothing is stored", () => {
    render(<Harness initialValue="" storedSecret={false} clearable />);

    expect(
      screen.queryByRole("button", { name: /remove stored value/i })
    ).not.toBeInTheDocument();
  });

  it("stops offering it once the credential has been removed", async () => {
    // Focus would otherwise be dropped onto the document when the button it
    // sits on stops rendering.
    const user = userEvent.setup();
    render(<Harness initialValue={MASKED_SECRET} storedSecret clearable />);

    await user.click(
      screen.getByRole("button", { name: /remove stored value/i })
    );

    expect(
      screen.queryByRole("button", { name: /remove stored value/i })
    ).not.toBeInTheDocument();
    expect(document.activeElement).toBe(secretInput());
  });
});
