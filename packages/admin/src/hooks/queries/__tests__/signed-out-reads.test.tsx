/**
 * What the admin asks of the server while nobody is signed in.
 *
 * The general settings and the workspace half of admin-meta are both
 * session-gated: a visitor's request is answered 401. Both used to be sent
 * from the sign-in screen anyway, and each was sometimes sent twice. The
 * cause, reproduced below rather than inferred: TanStack Query asks a query
 * that ended in an error again whenever a reader mounts after the error
 * arrived (`retryOnMount`), so a remount of the screen, or a second reader,
 * sent the refused request again instead of sharing the first. Whether that
 * happened depended on whether the 401 beat the mount, which is why it was
 * rare. A visitor's screen now asks neither, so neither can be sent twice;
 * a signed-in screen asks each once.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

const getSettings = vi.fn();
const publicGet = vi.fn();
const protectedGet = vi.fn();
const session = vi.fn();

vi.mock("@admin/services/generalSettingsApi", () => ({
  getGeneralSettings: () => getSettings(),
  updateGeneralSettings: vi.fn(),
}));

vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: { get: (...args: unknown[]) => publicGet(...args) },
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: (...args: unknown[]) => protectedGet(...args) },
}));

vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => session(),
  authSessionKey: ["auth", "session"],
}));

import { BrandingProvider } from "@admin/context/providers/BrandingProvider";
import { useGeneralSettings } from "@admin/hooks/queries/useGeneralSettings";

const signedOut = {
  data: { isSetup: true, isAuthenticated: false },
  isPending: false,
};
const signedIn = {
  data: { isSetup: true, isAuthenticated: true },
  isPending: false,
};

class Unauthorized extends Error {
  status = 401;
}

function SettingsReader(): null {
  useGeneralSettings();
  return null;
}

/** Renders `tree` and returns a way to mount a second copy of it afterwards. */
function renderTwice(tree: () => React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const first = render(
    <QueryClientProvider client={client}>{tree()}</QueryClientProvider>
  );
  return {
    remount: () => {
      first.unmount();
      render(
        <QueryClientProvider client={client}>{tree()}</QueryClientProvider>
      );
    },
    second: () =>
      render(
        <QueryClientProvider client={client}>{tree()}</QueryClientProvider>
      ),
  };
}

/** Lets every query that is going to run, run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20));

afterEach(() => {
  getSettings.mockReset();
  publicGet.mockReset();
  protectedGet.mockReset();
  session.mockReset();
});

describe("the cause: a refused read is asked again by a reader that mounts after the refusal", () => {
  it("sends the settings read again when a second reader mounts after its 401", async () => {
    // A signed-in session whose read the server refuses all the same (an
    // expired grant): the read is still made, so the mechanism shows.
    session.mockReturnValue(signedIn);
    getSettings.mockRejectedValue(new Unauthorized("401"));

    const screen = renderTwice(() => <SettingsReader />);
    await waitFor(() => expect(getSettings).toHaveBeenCalledTimes(1));
    await settle();
    screen.second();

    await waitFor(() => expect(getSettings).toHaveBeenCalledTimes(2));
  });
});

describe("a visitor's screen", () => {
  it("asks for no general settings, however often it mounts", async () => {
    session.mockReturnValue(signedOut);
    getSettings.mockRejectedValue(new Unauthorized("401"));

    const screen = renderTwice(() => <SettingsReader />);
    await settle();
    screen.second();
    screen.remount();
    await settle();

    expect(getSettings).not.toHaveBeenCalled();
  });

  it("asks for the workspace half of admin-meta never, however often it mounts, and still the public half", async () => {
    session.mockReturnValue(signedOut);
    publicGet.mockResolvedValue({ logoText: "Site" } as AdminBranding);
    protectedGet.mockRejectedValue(new Unauthorized("401"));

    const screen = renderTwice(() => (
      <BrandingProvider>
        <span />
      </BrandingProvider>
    ));
    await waitFor(() => expect(publicGet).toHaveBeenCalled());
    await settle();
    screen.remount();
    await settle();

    expect(protectedGet).not.toHaveBeenCalled();
  });
});

describe("a signed-in screen", () => {
  it("asks for each once", async () => {
    session.mockReturnValue(signedIn);
    getSettings.mockResolvedValue({ timezone: "UTC" });
    publicGet.mockResolvedValue({} as AdminBranding);
    protectedGet.mockResolvedValue({ plugins: [] } as unknown as AdminBranding);

    renderTwice(() => (
      <BrandingProvider>
        <SettingsReader />
      </BrandingProvider>
    ));
    await waitFor(() => expect(getSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(protectedGet).toHaveBeenCalledTimes(1));
    await settle();

    expect(getSettings).toHaveBeenCalledTimes(1);
    expect(protectedGet).toHaveBeenCalledTimes(1);
    expect(protectedGet).toHaveBeenCalledWith("/admin-meta/workspace");
  });
});
