import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import SettingsGeneralPage from "../index";

const mockUpdateSettings = vi.fn();
const mockSettings = {
  applicationName: "",
  siteUrl: "",
  adminEmail: "",
  timezone: "UTC",
  dateFormat: "MM/DD/YYYY",
  timeFormat: "12h",
  logoUrl: "",
};

// Make `useUpdateGeneralSettings.mutate` synchronously invoke the success
// callback so we can assert on `setTheme` side-effects without async waits.
vi.mock("@admin/hooks/queries/useGeneralSettings", () => ({
  useGeneralSettings: () => ({ data: mockSettings, isLoading: false }),
  useUpdateGeneralSettings: () => ({
    mutate: (
      payload: unknown,
      opts?: { onSuccess?: () => void; onError?: (e: Error) => void }
    ) => {
      mockUpdateSettings(payload);
      opts?.onSuccess?.();
    },
    isPending: false,
  }),
}));

// The Settings page toggles `dark` on `.adminapp` containers (matching
// ThemeProvider's `ThemeSync` behavior). We attach a stable `.adminapp`
// element to `document.body` *outside* the React tree so that it survives
// `unmount()` and we can assert on its classList in the snap-back case.
let adminAppEl: HTMLElement;

function Providers({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        storageKey="nextly-theme"
      >
        {children}
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function setup() {
  return render(
    <Providers>
      <SettingsGeneralPage />
    </Providers>,
    { container: document.body.appendChild(document.createElement("div")) }
  );
}

describe("SettingsGeneralPage theme behaviour", () => {
  beforeEach(() => {
    mockUpdateSettings.mockClear();
    localStorage.clear();
    adminAppEl = document.createElement("div");
    adminAppEl.className = "adminapp";
    document.body.appendChild(adminAppEl);

    // jsdom does not implement matchMedia. next-themes and our preview
    // resolver both call it on mount.
    if (!window.matchMedia) {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }
  });

  afterEach(() => {
    adminAppEl.remove();
  });

  it("applies preview class to .adminapp on theme tile click without persisting", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /Dark/i }));

    expect(adminAppEl.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("nextly-theme")).toBeNull();
  });

  it("persists the theme on Save", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: /Dark/i }));
    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    expect(mockUpdateSettings).toHaveBeenCalled();
    expect(localStorage.getItem("nextly-theme")).toBe("dark");
  });

  it("snaps back to saved theme on unmount when form is dirty", async () => {
    const user = userEvent.setup();
    const { unmount } = setup();

    await user.click(screen.getByRole("button", { name: /Dark/i }));
    expect(adminAppEl.classList.contains("dark")).toBe(true);

    unmount();

    // Saved theme is "light" (ThemeProvider defaultTheme), so the cleanup
    // hook should have flipped `.adminapp` back to "light" (no dark class).
    expect(adminAppEl.classList.contains("dark")).toBe(false);
  });
});
