// @vitest-environment jsdom
/**
 * A session that ends reaches every open tab, whether or not this device keeps
 * a record of the sign-in. Where the site turned remembering off, or storage
 * refuses writes, no record exists, yet a tab that confirmed a session and is
 * then told by the server it ended must still tell the others, which go to the
 * sign-in page.
 *
 * The other tab is the channel the admin's tabs talk on, read as another tab
 * reads it: a second `BroadcastChannel` of the same name.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyRememberingSwitch,
  resetDeviceMemoryForTests,
} from "@admin/lib/device-memory/device-memory";

const mockUseAuthSession = vi.fn();
vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => mockUseAuthSession(),
  restartSessionCheck: vi.fn(),
  authSessionKey: ["auth", "session"],
}));
vi.mock("@admin/lib/navigation", () => ({ navigateTo: vi.fn() }));
const mockRedirectToLogin = vi.fn();
vi.mock("@admin/lib/api/refreshInterceptor", () => ({
  holdLoginRedirect: () => () => {},
  redirectToLogin: () => mockRedirectToLogin(),
}));
vi.mock("@admin/lib/auth/session", () => ({
  getCurrentUserId: () => Promise.resolve("user-1"),
  invalidateSessionCache: vi.fn(),
}));
vi.mock("@admin/lib/device-memory/server-answer", () => ({
  confirmDeviceMemory: () => Promise.resolve(),
}));

import { PrivateRoute } from "../PrivateRoute";

/** The channel the admin's tabs tell each other of a sign-out on. */
const CHANNEL = "nextly:admin:device-memory";

function session(isAuthenticated: boolean) {
  return { status: "success", data: { isSetup: true, isAuthenticated } };
}

function guard() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <PrivateRoute signIn={<span>sign-in form</span>}>
        {() => <span>protected</span>}
      </PrivateRoute>
    </QueryClientProvider>
  );
}

/** A tab that confirmed a session, then heard from the server it ended. */
async function sessionEndsInThisTab(): Promise<void> {
  mockUseAuthSession.mockReturnValue(session(true));
  const view = render(guard());
  await act(async () => {});
  mockUseAuthSession.mockReturnValue(session(false));
  view.rerender(guard());
  await act(async () => {});
}

/** What another tab hears on the channel. */
function otherTab() {
  const heard: unknown[] = [];
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = event => heard.push(event.data);
  return { heard, close: () => channel.close() };
}

/** Until the channel has delivered what was posted. */
const delivered = () => new Promise(resolve => setTimeout(resolve, 50));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetDeviceMemoryForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a session that ends in one tab", () => {
  it("is told to the other tabs where the site turned remembering off", async () => {
    applyRememberingSwitch(false);
    const other = otherTab();
    await sessionEndsInThisTab();
    await delivered();
    expect(other.heard).toEqual([{ type: "signed-out" }]);
    other.close();
  });

  it("is told to the other tabs where storage refuses to keep anything", async () => {
    const refused = () => {
      throw new DOMException(
        "The quota has been exceeded.",
        "QuotaExceededError"
      );
    };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(refused);
    const other = otherTab();
    await sessionEndsInThisTab();
    await delivered();
    expect(other.heard).toEqual([{ type: "signed-out" }]);
    other.close();
  });

  it("is told by no tab that never confirmed a session", async () => {
    applyRememberingSwitch(false);
    const other = otherTab();
    mockUseAuthSession.mockReturnValue(session(false));
    render(guard());
    await act(async () => {});
    await delivered();
    expect(other.heard).toEqual([]);
    other.close();
  });
});

describe("a tab told another tab signed out", () => {
  it("goes to the sign-in page, remembering off as it may be", async () => {
    applyRememberingSwitch(false);
    mockUseAuthSession.mockReturnValue(session(true));
    render(guard());
    await act(async () => {});

    const sender = new BroadcastChannel(CHANNEL);
    sender.postMessage({ type: "signed-out" });
    sender.close();
    await act(async () => {
      await delivered();
    });
    expect(mockRedirectToLogin).toHaveBeenCalledTimes(1);
  });
});
