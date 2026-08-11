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
}: {
  initialValue: string;
  storedSecret: boolean;
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
        />
      </form>
    </Form>
  );
}

function secretInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    'input[name="configuration.apiKey"]'
  );
  if (!input) throw new Error("the credential input did not render");
  return input;
}

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

  it("still clears the real mask on reveal", async () => {
    const user = userEvent.setup();
    render(<Harness initialValue={MASKED_SECRET} storedSecret />);

    await user.click(screen.getByRole("button", { name: /show value/i }));

    // The control. Without it the two assertions above would pass on a field
    // that had simply stopped clearing anything, which would leave the user
    // appending a new credential to a mask.
    expect(secretInput().value).toBe("");
  });
});
