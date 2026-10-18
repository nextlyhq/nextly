/**
 * What the create-user form tells an admin about a password they set: the
 * server makes it one the person must replace at their first sign-in, so the
 * form must not say they merely can.
 */
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import {
  createUserFormSettings,
  type CreateUserFormValues,
} from "@admin/types/userform";

import { UserFormFields } from "./index";

/** The create page's form, with the settings the page itself uses. */
function CreateForm() {
  const form = useForm<CreateUserFormValues>({
    ...createUserFormSettings,
    defaultValues: { signInMethod: "invite", roles: [] },
  });
  return (
    <form onSubmit={e => void form.handleSubmit(() => {})(e)}>
      <UserFormFields
        mode="create"
        register={form.register}
        control={form.control}
        errors={form.formState.errors}
        roles={[]}
      />
      <button type="submit">Create</button>
    </form>
  );
}

describe("the create-user form's set-a-password choice", () => {
  it("says the person chooses a new password at their first sign-in", () => {
    render(<CreateForm />);

    const choice = screen.getByText("Set a password now").parentElement;
    expect(choice?.textContent).toMatch(
      /choose a new password the first time they sign in/
    );
    expect(choice?.textContent).not.toMatch(/can change it/);
  });

  it("describes the server's rule, not a fixed list of symbols, once chosen", async () => {
    render(<CreateForm />);

    await userEvent.click(screen.getByLabelText(/Set a password now/));

    const field = screen.getByPlaceholderText(/a symbol$/);
    expect(field.getAttribute("placeholder")).not.toMatch(/@\$!%/);
  });

  it("lists every rule a password misses, not only the first", async () => {
    render(<CreateForm />);

    await userEvent.click(screen.getByLabelText(/Set a password now/));
    await userEvent.type(screen.getByPlaceholderText(/a symbol$/), "password");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    for (const rule of [
      "Password must contain at least one uppercase letter",
      "Password must contain at least one number",
      "Password must contain at least one special character",
    ]) {
      expect(await screen.findByText(rule)).toBeTruthy();
    }
  });
});
