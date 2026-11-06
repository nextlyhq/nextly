// @vitest-environment jsdom
/**
 * Save anyway on the provider page: it saves the form as it stands, not as it
 * was when the check refused it, and a later Update is checked again.
 */
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type {
  EmailProviderDescriptor,
  EmailProviderRecord,
} from "@admin/services/emailProviderApi";

import EditEmailProviderPage from "../edit/[id]";

const { check, update } = vi.hoisted(() => ({
  check: vi.fn(),
  update: vi.fn(),
}));

const PROVIDER_ID = "11111111-1111-4111-8111-111111111111";

const PROVIDER: EmailProviderRecord = {
  id: PROVIDER_ID,
  name: "Transactional",
  type: "resend",
  fromEmail: "hello@example.com",
  fromName: null,
  configuration: {},
  isDefault: false,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const RESEND: EmailProviderDescriptor = {
  type: "resend",
  label: "Resend",
  capabilities: { connectionTest: true },
  configFields: [],
};

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: () => true,
    hasAnswer: true,
    isLoading: false,
    error: null,
  }),
}));

// The pages ask through the router-free hook, which reads the same answer.
vi.mock("@admin/hooks/useHasPermission", async () => {
  const { useCurrentUserPermissions } = await import(
    "@admin/hooks/useCurrentUserPermissions"
  );
  return {
    useHasPermission: () => useCurrentUserPermissions().hasPermission,
  };
});

vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({
    route: { params: { id: PROVIDER_ID } },
    outside: false,
    pathname: "/admin/email/sending/edit",
  }),
}));

vi.mock("@admin/hooks/queries/useEmailProviders", () => ({
  useEmailProvider: () => ({
    data: PROVIDER,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useEmailProviderTypes: () => ({
    data: [RESEND],
    isLoading: false,
    isError: false,
    error: null,
  }),
  useUpdateEmailProvider: () => ({ mutate: update, isPending: false }),
  useCheckProvider: () => ({ mutate: check, isPending: false }),
  useTestProvider: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  check.mockReset();
  update.mockReset();
  check.mockImplementation((_input, { onSuccess }) =>
    onSuccess({ checked: true, success: false, setup: "credentials" })
  );
});

async function rename(user: ReturnType<typeof userEvent.setup>, name: string) {
  const field = screen.getByLabelText(/Provider Name/);
  await user.clear(field);
  await user.click(field);
  await user.paste(name);
}

describe("Save anyway", () => {
  it("saves the form as it is now, not as the check saw it", async () => {
    const user = userEvent.setup();
    render(<EditEmailProviderPage />);

    await rename(user, "First try");
    await user.click(screen.getByRole("button", { name: "Update Provider" }));
    expect(await screen.findByText("Resend refused the sign-in.")).toBeTruthy();
    expect(update).not.toHaveBeenCalled();

    // Changed after the refusal, then saved anyway.
    await rename(user, "Second try");
    await user.click(screen.getByRole("button", { name: "Save anyway" }));

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.name).toBe("Second try");
    // Saved without asking the provider again.
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("checks the next Update again", async () => {
    const user = userEvent.setup();
    render(<EditEmailProviderPage />);

    await user.click(screen.getByRole("button", { name: "Update Provider" }));
    await screen.findByText("Resend refused the sign-in.");
    await user.click(screen.getByRole("button", { name: "Update Provider" }));

    expect(check).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });
});
