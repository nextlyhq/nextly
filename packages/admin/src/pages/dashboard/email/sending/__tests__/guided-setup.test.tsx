// @vitest-environment jsdom
/**
 * Adding a provider in three steps. The provider is saved off and never the
 * default; a check the provider refuses is explained by what to check and
 * saves nothing; an accepted test offers to turn it on, and only Done does.
 * Saving changed settings asks for a new test, and a person who may add
 * providers but not edit them leaves the provider off.
 */
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type {
  EmailProviderDescriptor,
  EmailProviderRecord,
} from "@admin/services/emailProviderApi";

import CreateEmailProviderPage from "../create";

const { check, create, update, test, grants, uninstalled } = vi.hoisted(() => ({
  check: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  test: vi.fn(),
  grants: new Set<string>(),
  /** Types a catalog refresh has taken away. */
  uninstalled: new Set<string>(),
}));

const SMTP: EmailProviderDescriptor = {
  type: "smtp",
  label: "SMTP",
  description: "Send through any mail server.",
  capabilities: { connectionTest: true },
  configFields: [],
};
const LOG: EmailProviderDescriptor = {
  type: "log",
  label: "Log",
  description: "Write each email to the server log.",
  capabilities: {},
  configFields: [],
};

vi.mock("@admin/hooks/queries/useEmailProviders", () => ({
  useEmailProviderTypes: () => ({
    data: [SMTP, LOG].filter(entry => !uninstalled.has(entry.type)),
    isLoading: false,
    error: null,
    isError: false,
  }),
  useCheckProvider: () => ({ mutate: check, isPending: false }),
  useCreateEmailProvider: () => ({ mutate: create, isPending: false }),
  useUpdateEmailProvider: () => ({ mutate: update, isPending: false }),
  useTestProvider: () => ({ mutate: test, isPending: false }),
  useEmailProviders: () => ({ data: { data: [] } }),
}));

vi.mock("@admin/hooks/useCurrentUserPermissions", () => ({
  useCurrentUserPermissions: () => ({
    hasPermission: (slug: string) => grants.has(slug),
  }),
}));

vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: { email: "me@example.com" } }),
}));

const navigateTo = vi.fn();
vi.mock("@admin/lib/navigation", () => ({
  navigateTo: (path: string) => navigateTo(path),
}));

// Radix needs these and jsdom has none.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

function saved(over: Partial<EmailProviderRecord> = {}): EmailProviderRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Dev log",
    type: "smtp",
    fromEmail: "dev@example.com",
    fromName: null,
    configuration: {},
    isDefault: false,
    isActive: false,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    ...over,
  };
}

async function connect(
  user: ReturnType<typeof userEvent.setup>,
  type: "SMTP" | "Log"
) {
  await user.click(screen.getByRole("radio", { name: new RegExp(type) }));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  // Pasted rather than typed: typing each key is slow enough to time out
  // under a loaded test run, and the form reads the value either way.
  await user.click(screen.getByLabelText(/Provider Name/));
  await user.paste("Dev log");
  await user.click(screen.getByLabelText(/From Email/));
  await user.paste("dev@example.com");
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

beforeEach(() => {
  check.mockReset();
  create.mockReset();
  update.mockReset();
  test.mockReset();
  navigateTo.mockReset();
  uninstalled.clear();
  grants.clear();
  grants.add("create-email-providers");
  grants.add("update-email-providers");
});

/** Through a checked save to an accepted test. */
async function acceptedTest(user: ReturnType<typeof userEvent.setup>) {
  check.mockImplementation((_input, { onSuccess }) =>
    onSuccess({ checked: true, success: true })
  );
  create.mockImplementation((_data, { onSuccess }) => onSuccess(saved()));
  update.mockImplementation((_input, { onSuccess }) => onSuccess(saved()));
  test.mockImplementation((_input, { onSuccess }) =>
    onSuccess({ success: true })
  );
  render(<CreateEmailProviderPage />);
  await connect(user, "SMTP");
  await user.click(screen.getByRole("button", { name: "Send a test" }));
  await screen.findByText("SMTP accepted the test email.");
}

describe("adding a provider", () => {
  it("offers every type as a card, Log marked as delivering nothing", () => {
    render(<CreateEmailProviderPage />);
    expect(screen.getByRole("radio", { name: /SMTP/ })).toBeTruthy();
    expect(screen.getByText(/delivers nothing/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it("explains a refused check by what to check, and saves nothing", async () => {
    const user = userEvent.setup();
    check.mockImplementation((_input, { onSuccess }) =>
      onSuccess({ checked: true, success: false, setup: "credentials" })
    );
    render(<CreateEmailProviderPage />);
    await connect(user, "SMTP");

    expect(await screen.findByText("SMTP refused the sign-in.")).toBeTruthy();
    expect(screen.getByText(/app password/)).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it("saves a checked provider off, and never as the default", async () => {
    const user = userEvent.setup();
    check.mockImplementation((_input, { onSuccess }) =>
      onSuccess({ checked: true, success: true })
    );
    create.mockImplementation((_data, { onSuccess }) => onSuccess(saved()));
    render(<CreateEmailProviderPage />);
    await connect(user, "SMTP");

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      type: "smtp",
      isActive: false,
      isDefault: false,
    });
    expect(
      await screen.findByRole("heading", { name: "Send a test" })
    ).toBeTruthy();
  });

  it("turns the provider on only when an accepted test is followed by Done", async () => {
    const user = userEvent.setup();
    check.mockImplementation((_input, { onSuccess }) =>
      onSuccess({ checked: true, success: true })
    );
    create.mockImplementation((_data, { onSuccess }) => onSuccess(saved()));
    test.mockImplementation((_input, { onSuccess }) =>
      onSuccess({ success: true })
    );
    update.mockImplementation((_input, { onSuccess }) => onSuccess(saved()));
    render(<CreateEmailProviderPage />);
    await connect(user, "SMTP");

    // The person's own address, which the server sends to whatever is
    // asked: it can't be changed here.
    const sendTo = screen.getByLabelText("Send to") as HTMLInputElement;
    expect(sendTo.value).toBe("me@example.com");
    expect(sendTo.readOnly).toBe(true);
    await user.click(screen.getByRole("button", { name: "Send a test" }));

    expect(
      await screen.findByText("SMTP accepted the test email.")
    ).toBeTruthy();
    const turnOn = screen.getByRole("switch", { name: "Turn on" });
    expect(turnOn.getAttribute("aria-checked")).toBe("true");
    expect(update).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(update).toHaveBeenCalledWith(
      {
        id: saved().id,
        data: { isActive: true, isDefault: false },
      },
      expect.anything()
    );
    expect(navigateTo).toHaveBeenCalledWith("/admin/email/sending");
  });

  it("explains a refused test and lets the person send again in place", async () => {
    const user = userEvent.setup();
    check.mockImplementation((_input, { onSuccess }) =>
      onSuccess({ checked: true, success: true })
    );
    create.mockImplementation((_data, { onSuccess }) => onSuccess(saved()));
    test.mockImplementation((_input, { onSuccess }) =>
      onSuccess({ success: false, setup: "recipient", retryable: false })
    );
    render(<CreateEmailProviderPage />);
    await connect(user, "SMTP");
    await user.click(screen.getByRole("button", { name: "Send a test" }));

    expect(
      await screen.findByText("SMTP refused me@example.com.")
    ).toBeTruthy();
    // Still off: nothing was accepted.
    expect(
      screen
        .getByRole("switch", { name: "Turn on" })
        .getAttribute("aria-checked")
    ).toBe("false");
    expect(screen.getByRole("button", { name: "Send again" })).toBeTruthy();
  });

  it("only lets an on provider be made the default", async () => {
    const user = userEvent.setup();
    check.mockImplementation((_input, { onSuccess }) =>
      onSuccess({ checked: false, success: true })
    );
    create.mockImplementation((_data, { onSuccess }) =>
      onSuccess(saved({ type: "log" }))
    );
    render(<CreateEmailProviderPage />);
    await connect(user, "Log");

    expect(
      (
        screen.getByRole("switch", {
          name: "Make it the default",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    await user.click(screen.getByRole("switch", { name: "Turn on" }));
    expect(
      (
        screen.getByRole("switch", {
          name: "Make it the default",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  it("asks for a new test once changed settings are saved", async () => {
    const user = userEvent.setup();
    await acceptedTest(user);
    expect(
      screen
        .getByRole("switch", { name: "Turn on" })
        .getAttribute("aria-checked")
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: "Change settings" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Back at the test, nothing carried over from the settings before.
    expect(
      screen
        .getByRole("switch", { name: "Turn on" })
        .getAttribute("aria-checked")
    ).toBe("false");
    update.mockClear();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(update).not.toHaveBeenCalled();
  });

  it("lets a person who can't edit providers test one, and leaves it off", async () => {
    grants.delete("update-email-providers");
    const user = userEvent.setup();
    await acceptedTest(user);

    const turnOn = screen.getByRole("switch", {
      name: "Turn on",
    }) as HTMLButtonElement;
    expect(turnOn.disabled).toBe(true);
    expect(turnOn.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/needs permission to edit providers/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(update).not.toHaveBeenCalled();
    expect(navigateTo).toHaveBeenCalledWith("/admin/email/sending");
  });

  it("asks for a new choice when a refresh takes the chosen type away", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CreateEmailProviderPage />);
    await user.click(screen.getByRole("radio", { name: /SMTP/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Connect SMTP")).toBeTruthy();

    uninstalled.add("smtp");
    rerender(<CreateEmailProviderPage />);

    // Never another type's fields under the one that was chosen.
    expect(
      screen.getByText("That provider type is no longer installed")
    ).toBeTruthy();
    expect(screen.queryByText("Connect SMTP")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    await user.click(screen.getByRole("radio", { name: /Log/ }));
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it("says a test through Log was logged, not sent", async () => {
    const user = userEvent.setup();
    check.mockImplementation((_input, { onSuccess }) =>
      onSuccess({ checked: false, success: true })
    );
    create.mockImplementation((_data, { onSuccess }) =>
      onSuccess(saved({ type: "log" }))
    );
    test.mockImplementation((_input, { onSuccess }) =>
      onSuccess({ success: true })
    );
    render(<CreateEmailProviderPage />);
    await connect(user, "Log");
    await user.click(screen.getByRole("button", { name: "Send a test" }));

    expect(
      await screen.findByText("The test email was logged, not sent.")
    ).toBeTruthy();
  });
});
