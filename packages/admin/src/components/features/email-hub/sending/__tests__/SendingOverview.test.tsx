// @vitest-environment jsdom
/**
 * The Sending tab at a glance: who sends an email with no provider of its
 * own, the provider set in the site's code, and a warning when the default
 * delivers nothing on a site that is not in development.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type {
  EmailProviderRecord,
  SendingSettings,
} from "@admin/services/emailProviderApi";

import { SendingOverview, defaultSenderOf } from "../SendingOverview";

const { settings, providers, loaded, failed, refetch } = vi.hoisted(() => ({
  settings: { current: undefined as SendingSettings | undefined },
  providers: { current: [] as EmailProviderRecord[] },
  /** Whether both reads have answered. */
  loaded: { current: true },
  /** Whether the provider list's read failed. */
  failed: { current: false },
  refetch: vi.fn(),
}));

vi.mock("@admin/hooks/queries/useEmailProviders", () => ({
  useSendingSettings: () => ({
    data: loaded.current ? settings.current : undefined,
    isSuccess: loaded.current,
  }),
  useEmailProviders: () => ({
    data: loaded.current ? { data: providers.current } : undefined,
    isSuccess: loaded.current,
    isError: failed.current,
    refetch,
  }),
}));

function provider(over: Partial<EmailProviderRecord>): EmailProviderRecord {
  return {
    id: "p1",
    name: "Office SMTP",
    type: "smtp",
    fromEmail: "web@example.com",
    fromName: "Northwind",
    configuration: {},
    isDefault: false,
    isActive: true,
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    ...over,
  };
}

const NO_CODE: SendingSettings = {
  from: null,
  codeProvider: null,
  development: false,
};

beforeEach(() => {
  settings.current = NO_CODE;
  providers.current = [];
});

describe("defaultSenderOf", () => {
  it("is the default provider here when it is on", () => {
    expect(
      defaultSenderOf([provider({ isDefault: true })], NO_CODE)
    ).toMatchObject({
      source: "provider",
      name: "Office SMTP",
      from: "Northwind <web@example.com>",
    });
  });

  it("falls to the provider set in code when the default here is off", () => {
    expect(
      defaultSenderOf([provider({ isDefault: true, isActive: false })], {
        from: "App <app@example.com>",
        codeProvider: { type: "resend", label: "Resend" },
        development: false,
      })
    ).toMatchObject({ source: "code", name: "Resend" });
  });

  it("is nobody when nothing sends", () => {
    expect(defaultSenderOf([provider({})], NO_CODE)).toBeNull();
  });
});

describe("SendingOverview", () => {
  it("shows the default sender", () => {
    providers.current = [provider({ isDefault: true })];
    render(<SendingOverview />);
    expect(screen.getByText("Northwind <web@example.com>")).toBeTruthy();
  });

  it("warns when the Log provider is the default outside development", () => {
    providers.current = [provider({ type: "log", isDefault: true })];
    render(<SendingOverview />);
    expect(screen.getByText("Email is being logged, not sent")).toBeTruthy();
  });

  it("does not warn in development, where Log is meant", () => {
    settings.current = { ...NO_CODE, development: true };
    providers.current = [provider({ type: "log", isDefault: true })];
    render(<SendingOverview />);
    expect(screen.queryByText("Email is being logged, not sent")).toBeNull();
  });

  it("shows the provider set in code, read-only", () => {
    settings.current = {
      from: "App <app@example.com>",
      codeProvider: { type: "resend", label: "Resend" },
      development: false,
    };
    render(<SendingOverview />);
    expect(screen.getByRole("heading", { name: "Set in code" })).toBeTruthy();
    expect(screen.getByText("email.providerConfig")).toBeTruthy();
    expect(screen.getByText("App <app@example.com>")).toBeTruthy();
  });

  it("says nothing about a default before the providers are read", () => {
    loaded.current = false;
    render(<SendingOverview />);
    expect(screen.queryByText("No provider sends email yet")).toBeNull();
    loaded.current = true;
  });

  it("says a read that failed, with a retry, rather than loading for ever", async () => {
    loaded.current = false;
    failed.current = true;
    render(<SendingOverview />);
    expect(
      screen.getByText("The default sender couldn't be read.")
    ).toBeTruthy();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
    loaded.current = true;
    failed.current = false;
  });

  it("says when no provider sends email yet", () => {
    render(<SendingOverview />);
    expect(screen.getByText("No provider sends email yet")).toBeTruthy();
  });
});
