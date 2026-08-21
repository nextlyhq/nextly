import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseApiError } from "@admin/lib/api/parseApiError";

import { SetInitialPassword } from "../auth-login/set-initial-password";
import { Signup } from "../auth-signup";
import { VerifyEmail } from "../auth-verify-email";

/**
 * What an auth screen tells someone when their request fails.
 *
 * `fetcher` throws the parsed `{ error: { code, message, data } }` envelope, so
 * a validation failure's top-level message is the deliberately generic
 * "Validation failed." and the actionable reasons are per-field in
 * `data.errors`. Every surface here reads them through `apiErrorMessage`; these
 * tests hold that from the outside, by rejecting a real request and reading
 * what reaches the screen.
 */

const { toast, post, verifyEmail, navigateTo } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  post: vi.fn(),
  verifyEmail: vi.fn(),
  navigateTo: vi.fn(),
}));

vi.mock("@admin/components/ui", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast,
}));
vi.mock("@admin/hooks/useApi", () => ({
  useApi: () => ({ api: { public: { post } } }),
}));
vi.mock("@admin/lib/api/csrf", () => ({
  getCsrfToken: () => Promise.resolve("csrf-token"),
}));
vi.mock("@admin/services/authApi", () => ({ verifyEmail }));
vi.mock("@admin/lib/navigation", () => ({ navigateTo }));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ logoText: "Acme Docs", logoUrl: null }),
  useAppName: () => "Acme Docs",
}));

/** A rejection shaped the way `fetcher` produces one. */
const rejection = (body: unknown, status: number): Promise<never> =>
  Promise.reject(parseApiError(body, status));

/** The canonical validation envelope, carrying one field's reason. */
const validationFailure = (path: string, code: string, reason: string) => ({
  error: {
    code: "VALIDATION_ERROR",
    message: "Validation failed.",
    requestId: "req_test",
    data: { errors: [{ path, code, message: reason }] },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Signup", () => {
  // The reachable case: the client schema caps nothing on name, the server
  // caps it at 100, so this rejection is one a real person can provoke by
  // pasting a long name.
  it("names the field the server rejected", async () => {
    post.mockImplementation(() =>
      rejection(
        validationFailure(
          "name",
          "TOO_LONG",
          "Name must be 100 characters or less."
        ),
        400
      )
    );

    const user = userEvent.setup({ delay: null });
    render(<Signup />);

    await user.type(
      screen.getByPlaceholderText("Enter your full name…"),
      "Ada"
    );
    await user.type(
      screen.getByPlaceholderText("Enter your email address…"),
      "someone@example.com"
    );
    await user.type(
      screen.getByPlaceholderText("Create a strong password…"),
      "Str0ng!P"
    );
    await user.type(
      screen.getByPlaceholderText("Confirm your password…"),
      "Str0ng!P"
    );
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith("Registration failed", {
      description: "Name must be 100 characters or less.",
    });
    // Four fields to fill against two in every other case here, each keystroke
    // re-running the resolver: this is the one that runs near the default limit
    // when the whole suite is competing for the machine.
  }, 20000);
});

describe("SetInitialPassword", () => {
  async function submitAPassword() {
    const user = userEvent.setup({ delay: null });
    render(<SetInitialPassword pendingToken="pending" onDone={vi.fn()} />);

    // Both fields must satisfy `passwordSchema` client-side, or the submit
    // never reaches the request whose rejection is under test.
    await user.type(
      screen.getByPlaceholderText("Create a strong password…"),
      "Str0ng!P"
    );
    await user.type(
      screen.getByPlaceholderText("Confirm your password…"),
      "Str0ng!P"
    );
    await user.click(screen.getByRole("button", { name: /set password/i }));
  }

  it("says which rule the password broke", async () => {
    post.mockImplementation(() =>
      rejection(
        validationFailure(
          "newPassword",
          "WEAK_PASSWORD",
          "Password must contain at least one uppercase letter"
        ),
        400
      )
    );

    await submitAPassword();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith("Could not set your password", {
      description: "Password must contain at least one uppercase letter",
    });
  });

  // Not a test of WHICH reader runs -- the previous one produced this string
  // too. What it pins is that the screen hands `apiErrorMessage` its own
  // wording: drop that argument and the shared default "An error occurred"
  // reaches the toast instead. `parseApiError.test` cannot see the call site.
  it("shows its own wording, not the shared default, when the failure carries none", async () => {
    post.mockImplementation(() => Promise.reject(new Error("")));

    await submitAPassword();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith("Could not set your password", {
      description: "Something went wrong. Please try again.",
    });
    expect(toast.error).not.toHaveBeenCalledWith(
      "Could not set your password",
      {
        description: "An error occurred",
      }
    );
  });
});

describe("VerifyEmail", () => {
  // Validation-shaped on purpose: a surface reading `error.message` directly
  // renders "Validation failed." here, so this separates the two readings. A
  // plain `{ code, message }` failure would not — its message IS the answer.
  it("shows why the server refused the token", async () => {
    verifyEmail.mockImplementation(() =>
      rejection(
        validationFailure(
          "token",
          "EXPIRED",
          "That verification link expired three days ago."
        ),
        400
      )
    );

    render(<VerifyEmail searchParams={{ token: "t" }} />);

    expect(
      await screen.findByText("That verification link expired three days ago.")
    ).toBeInTheDocument();
  });

  // The loading card carries different copy, so this string cannot be what is
  // already on screen while the request is in flight — it is only reachable
  // once the rejection has arrived and the catch has chosen the fallback.
  it("shows its own wording, not the shared default, when the failure carries none", async () => {
    verifyEmail.mockImplementation(() => Promise.reject(new Error("")));

    render(<VerifyEmail searchParams={{ token: "t" }} />);

    expect(
      await screen.findByText(
        "This verification link is invalid or has expired."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("An error occurred")).not.toBeInTheDocument();
  });
});
