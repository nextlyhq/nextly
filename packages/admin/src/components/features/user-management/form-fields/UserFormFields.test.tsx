/**
 * What the create-user form tells an admin about a password they set: the
 * server makes it one the person must replace at their first sign-in, so the
 * form must not say they merely can.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import {
  createUserFormSchema,
  type CreateUserFormValues,
} from "@admin/types/userform";

import { UserFormFields } from "./index";

function CreateForm() {
  const form = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserFormSchema),
    defaultValues: { signInMethod: "invite", roles: [] },
  });
  return (
    <UserFormFields
      mode="create"
      register={form.register}
      control={form.control}
      errors={form.formState.errors}
      roles={[]}
    />
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
});
