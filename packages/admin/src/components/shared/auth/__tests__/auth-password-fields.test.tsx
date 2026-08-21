import { zodResolver } from "@hookform/resolvers/zod";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";

import {
  AuthNewPasswordFields,
  newPasswordFormSchema,
  type NewPasswordFormValues,
} from "../AuthNewPasswordFields";
import {
  AuthSignupFields,
  signupFormSchema,
  type SignupFormValues,
} from "../AuthSignupFields";

/**
 * The two password-field groups the signed-out screens are built from.
 *
 * They exist as two components rather than one because they render the
 * strength meter in different places, and that is what these tests hold: the
 * placement is the reason the split exists, so collapsing them into one would
 * have to break something here first.
 */

function NewPasswordHarness({ label }: { label?: string }) {
  const form = useForm<NewPasswordFormValues>({
    resolver: zodResolver(newPasswordFormSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });
  return (
    <FormProvider {...form}>
      <AuthNewPasswordFields passwordLabel={label} />
    </FormProvider>
  );
}

function SignupHarness() {
  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupFormSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });
  return (
    <FormProvider {...form}>
      <AuthSignupFields />
    </FormProvider>
  );
}

/** The field wrapper each `FormItem` renders, used to test containment. */
function formItemContaining(node: ReactNode | HTMLElement) {
  return (node as HTMLElement).closest('[data-slot="form-item"]');
}

describe("AuthNewPasswordFields", () => {
  it("labels the first field 'New Password' unless told otherwise", () => {
    render(<NewPasswordHarness />);

    expect(screen.getByText("New Password")).toBeInTheDocument();
    expect(screen.getByText("Confirm Password")).toBeInTheDocument();
  });

  // Accepting an invite sets a first password rather than replacing one, so
  // "New Password" would be wrong there.
  it("takes a different label for the first field", () => {
    render(<NewPasswordHarness label="Password" />);

    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.queryByText("New Password")).not.toBeInTheDocument();
  });

  it("reveals only the field whose toggle was pressed", async () => {
    const user = userEvent.setup();
    render(<NewPasswordHarness />);

    const password = screen.getByPlaceholderText("Create a strong password…");
    const confirm = screen.getByPlaceholderText("Confirm your password…");
    expect(password).toHaveAttribute("type", "password");
    expect(confirm).toHaveAttribute("type", "password");

    await user.click(
      screen.getAllByRole("button", { name: "Show password" })[0]
    );

    expect(password).toHaveAttribute("type", "text");
    expect(confirm).toHaveAttribute("type", "password");
  });

  // The placement that makes this a separate component from AuthSignupFields.
  it("renders the strength meter inside the confirm field", async () => {
    const user = userEvent.setup();
    render(<NewPasswordHarness />);

    // The meter renders nothing until there is a password to describe, so an
    // assertion made before typing would pass against its own absence.
    expect(screen.queryByText(/^Strength:/)).not.toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("Create a strong password…"),
      "Str0ng!Passw0rd"
    );

    const meter = await screen.findByText(/^Strength:/);
    const confirmField = formItemContaining(
      screen.getByPlaceholderText("Confirm your password…")
    );
    expect(confirmField).not.toBeNull();
    expect(confirmField).toContainElement(meter);
  });
});

describe("signupFormSchema", () => {
  // zod runs the chain in order, so a length check written before the trim
  // measures the untrimmed string. Both of these passed until the trim moved
  // to the front: the first arrived as an empty name, the second as one
  // character under a two-character rule.
  it.each([
    ["whitespace only", "   "],
    ["one character in padding", "   a   "],
  ])("rejects a full name that is %s", (_label, input) => {
    const result = signupFormSchema.safeParse({
      fullName: input,
      email: "someone@example.com",
      password: "Str0ng!P",
      confirmPassword: "Str0ng!P",
    });

    expect(result.success).toBe(false);
  });

  it("keeps a padded real name, trimmed", () => {
    const result = signupFormSchema.safeParse({
      fullName: "  Ada Lovelace  ",
      email: "someone@example.com",
      password: "Str0ng!P",
      confirmPassword: "Str0ng!P",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.fullName).toBe("Ada Lovelace");
  });
});

describe("AuthSignupFields", () => {
  it("renders the name, email and password pair", () => {
    render(<SignupHarness />);

    expect(
      screen.getByPlaceholderText("Enter your full name…")
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Enter your email address…")
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Create a strong password…")
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Confirm your password…")
    ).toBeInTheDocument();
  });

  // The other half of the placement decision: here the meter sits after both
  // fields, belonging to neither. Sharing one component with
  // AuthNewPasswordFields would move it into the confirm field and change what
  // these two screens render.
  it("renders the strength meter outside both fields", async () => {
    const user = userEvent.setup();
    render(<SignupHarness />);

    expect(screen.queryByText(/^Strength:/)).not.toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("Create a strong password…"),
      "Str0ng!Passw0rd"
    );

    const meter = await screen.findByText(/^Strength:/);
    expect(formItemContaining(meter)).toBeNull();
  });

  it("reveals only the field whose toggle was pressed", async () => {
    const user = userEvent.setup();
    render(<SignupHarness />);

    const password = screen.getByPlaceholderText("Create a strong password…");
    const confirm = screen.getByPlaceholderText("Confirm your password…");

    await user.click(
      screen.getAllByRole("button", { name: "Show password" })[1]
    );

    expect(password).toHaveAttribute("type", "password");
    expect(confirm).toHaveAttribute("type", "text");
  });
});
