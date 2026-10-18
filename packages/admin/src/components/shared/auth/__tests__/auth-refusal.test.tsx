/**
 * A signed-out form says when the server refused its submission, and where to
 * go instead.
 *
 * Before this, a first-run setup opened at `127.0.0.1` for an app at
 * `localhost` was refused with 403 `CSRF_FAILED` and the form looked exactly
 * as it did before the click. The refusals here are the server's own shape,
 * built through the admin's real error parser, so a change to either side of
 * that wire shows up as a failure rather than a mock that still agrees.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Login } from "@admin/components/features/auth-login";
import { Setup } from "@admin/components/features/auth-setup";
import { parseApiError } from "@admin/lib/api/parseApiError";
import { authRefusalOf } from "@admin/lib/auth/auth-refusal";

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock("@admin/lib/api/publicApi", () => ({ publicApi: { get, post } }));
vi.mock("@admin/lib/api/csrf", () => ({
  getCsrfToken: async () => "csrf-token",
}));
vi.mock("@admin/hooks/useApi", () => ({
  useApi: () => ({ api: { public: { get, post } } }),
}));

const PAGE = {
  origin: "http://127.0.0.1:3000",
  pathname: "/admin/setup",
  search: "",
};

/** The 403 the auth routes answer an origin they refuse with. */
const originRefusal = () =>
  parseApiError(
    {
      error: {
        code: "CSRF_FAILED",
        message: "Invalid request origin",
        data: { reason: "origin", appOrigin: "http://localhost:3000" },
      },
    },
    403
  );

describe("reading a refusal", () => {
  it("names both addresses for a refused origin, and links to the same page at the app's", () => {
    expect(authRefusalOf(originRefusal(), PAGE)).toEqual({
      kind: "origin",
      pageOrigin: "http://127.0.0.1:3000",
      appOrigin: "http://localhost:3000",
      href: "http://localhost:3000/admin/setup",
    });
  });

  it("asks for a fresh page for a refused token", () => {
    const token = parseApiError(
      {
        error: {
          code: "CSRF_FAILED",
          message: "Invalid CSRF token",
          data: { reason: "token" },
        },
      },
      403
    );
    expect(authRefusalOf(token, PAGE)).toMatchObject({
      kind: "refused",
      message: expect.stringMatching(/reload the page/i),
    });
  });

  it("never links to an address that is not an http(s) origin", () => {
    for (const appOrigin of [
      "javascript:alert(1)",
      "http://localhost:3000/elsewhere",
      "not a url",
    ]) {
      const refusal = parseApiError(
        {
          error: {
            code: "CSRF_FAILED",
            message: "Invalid request origin",
            data: { reason: "origin", appOrigin },
          },
        },
        403
      );
      expect(authRefusalOf(refusal, PAGE)?.kind).toBe("refused");
    }
  });

  it("never carries the page's query to the other address", () => {
    // A reset or invitation page holds its token in the query.
    const refusal = authRefusalOf(originRefusal(), {
      origin: "http://127.0.0.1:3000",
      pathname: "/admin/reset-password",
      search: "?token=secret-reset-token",
    });
    expect(refusal).toMatchObject({
      kind: "origin",
      href: "http://localhost:3000/admin/reset-password",
    });
  });

  it("offers no link when the server only knows itself by a loopback address", () => {
    // A server behind a proxy that hasn't been told its public address: the
    // loopback address it reports is no place to send the person.
    expect(
      authRefusalOf(originRefusal(), {
        origin: "https://app.example.com",
        pathname: "/admin/reset-password",
        search: "?token=secret-reset-token",
      })
    ).toEqual({
      kind: "unlisted",
      pageOrigin: "https://app.example.com",
      appOrigin: "http://localhost:3000",
    });
  });

  it("leaves a code the form explains to the form", () => {
    const unverified = parseApiError(
      {
        error: {
          code: "EMAIL_NOT_VERIFIED",
          message: "Please verify your email.",
        },
      },
      403
    );
    expect(authRefusalOf(unverified, PAGE, ["EMAIL_NOT_VERIFIED"])).toBeNull();
    expect(authRefusalOf(unverified, PAGE)?.kind).toBe("refused");
  });

  it("does not send the person back to the address that was refused", () => {
    expect(
      authRefusalOf(originRefusal(), {
        ...PAGE,
        origin: "http://localhost:3000",
      })?.kind
    ).toBe("refused");
  });

  it("shows any other refusal's own message", () => {
    const other = parseApiError(
      { error: { code: "FORBIDDEN", message: "Setup is not allowed here." } },
      403
    );
    expect(authRefusalOf(other, PAGE)).toEqual({
      kind: "refused",
      message: "Setup is not allowed here.",
    });
  });

  it("leaves everything that is not a refusal to the form", () => {
    const wrongPassword = parseApiError(
      {
        error: {
          code: "AUTH_INVALID_CREDENTIALS",
          message: "Invalid email or password.",
        },
      },
      401
    );
    expect(authRefusalOf(wrongPassword, PAGE)).toBeNull();
    expect(authRefusalOf(new TypeError("Failed to fetch"), PAGE)).toBeNull();
  });
});

/** The page is open at 127.0.0.1, as in the report. */
function openAt(pathname: string): void {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      origin: "http://127.0.0.1:3000",
      pathname,
      search: "",
      href: `http://127.0.0.1:3000${pathname}`,
    },
  });
}

function expectOriginNotice(path: string): void {
  const notice = screen.getByRole("alert");
  expect(notice).toHaveTextContent("http://127.0.0.1:3000");
  expect(notice).toHaveTextContent("http://localhost:3000");
  expect(
    screen.getByRole("link", {
      name: /open this page at http:\/\/localhost:3000/i,
    })
  ).toHaveAttribute("href", `http://localhost:3000${path}`);
}

describe("the forms show it", () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    // The sign-in page reads its provider and slot list first.
    get.mockResolvedValue({
      providers: [],
      challengeViews: {},
      slots: { beforeForm: [], afterForm: [], branding: [] },
    });
  });

  it("first-run setup", async () => {
    openAt("/admin/setup");
    post.mockRejectedValue(originRefusal());
    const user = userEvent.setup();

    render(<Setup />);
    // Nothing is shown before the submission is refused.
    expect(screen.queryByRole("alert")).toBeNull();

    await user.type(screen.getByPlaceholderText(/full name/i), "Ada Admin");
    await user.type(
      screen.getByPlaceholderText(/email address/i),
      "ada@example.com"
    );
    await user.type(
      screen.getByPlaceholderText(/create a strong password/i),
      "Str0ng!Passw0rd#2026"
    );
    await user.type(
      screen.getByPlaceholderText(/confirm your password/i),
      "Str0ng!Passw0rd#2026"
    );
    await user.click(
      screen.getByRole("button", { name: /create admin account/i })
    );

    await screen.findByRole("alert");
    expectOriginNotice("/admin/setup");
  });

  it("sign-in", async () => {
    openAt("/admin/login");
    post.mockRejectedValue(originRefusal());
    const user = userEvent.setup();

    render(<Login />);
    await user.type(
      await screen.findByPlaceholderText(/email address/i),
      "ada@example.com"
    );
    await user.type(
      screen.getByPlaceholderText(/enter your password/i),
      "any-password"
    );
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await screen.findByRole("alert");
    expectOriginNotice("/admin/login");
  });

  it("sign-in still offers to resend the verification email", async () => {
    // The server answers an unverified account with a 403 too, and sign-in
    // meets it with a resend action, not a refusal.
    openAt("/admin/login");
    post.mockRejectedValue(
      parseApiError(
        {
          error: {
            code: "EMAIL_NOT_VERIFIED",
            message: "Please verify your email.",
          },
        },
        403
      )
    );
    const user = userEvent.setup();

    render(<Login />);
    await user.type(
      await screen.findByPlaceholderText(/email address/i),
      "ada@example.com"
    );
    await user.type(
      screen.getByPlaceholderText(/enter your password/i),
      "right-password"
    );
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(
      await screen.findByRole("button", { name: /resend verification email/i })
    ).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("setup shows an unexplained refusal in the form too", async () => {
    openAt("/admin/setup");
    post.mockRejectedValue(
      parseApiError(
        { error: { code: "FORBIDDEN", message: "Setup is not allowed here." } },
        403
      )
    );
    const user = userEvent.setup();

    render(<Setup />);
    await user.type(screen.getByPlaceholderText(/full name/i), "Ada Admin");
    await user.type(
      screen.getByPlaceholderText(/email address/i),
      "ada@example.com"
    );
    await user.type(
      screen.getByPlaceholderText(/create a strong password/i),
      "Str0ng!Passw0rd#2026"
    );
    await user.type(
      screen.getByPlaceholderText(/confirm your password/i),
      "Str0ng!Passw0rd#2026"
    );
    await user.click(
      screen.getByRole("button", { name: /create admin account/i })
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Setup is not allowed here."
    );
  });
});
