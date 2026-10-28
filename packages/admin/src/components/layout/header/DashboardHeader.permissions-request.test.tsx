/**
 * The header and the notification bell read the same permissions answer, and the hook asks again
 * whenever a new reader of it mounts with no request in flight. So a cold load asks once only if
 * every reader in the header has mounted while the first request is still out: a bell mounted after
 * the answer arrives asks a second time, one round trip after the first.
 *
 * The hook is the real one, so the count is the requests it sends; only the network below it is
 * replaced.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";
import type {
  CapabilitiesResponse,
  UserPermissionsResponse,
} from "@admin/types/permissions";

const server = vi.hoisted(() => ({
  asked: [] as string[],
  /** Held until released, for the permissions requests. */
  permissionsGate: Promise.resolve() as Promise<void>,
}));

const SUPER_ADMIN: UserPermissionsResponse = {
  permissions: [],
  isSuperAdmin: true,
  roles: ["super-admin"],
};

const EVERYTHING: CapabilitiesResponse = {
  isSuperAdmin: true,
  validUntil: null,
  entities: {},
};

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: {
    get: async (path: string) => {
      server.asked.push(path);
      const route = path.split("?")[0];
      if (route === "/me/permissions") {
        await server.permissionsGate;
        return SUPER_ADMIN;
      }
      if (route === "/me/capabilities") return EVERYTHING;
      if (route === "/schema/journal") return { rows: [], hasMore: false };
      throw new Error(`unexpected request ${path}`);
    },
  },
}));
vi.mock("@admin/hooks/useRouter", () => ({
  useRouter: () => ({ route: { routeType: "private" } }),
}));
vi.mock("@admin/hooks/useLocaleParam", () => ({
  useLocaleParam: () => undefined,
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  // The workspace answer is in and offers the bell: the builder runs and no plugin hides it.
  useBranding: () => ({ plugins: [], showBuilder: true }) as AdminBranding,
  useBrandingStatus: () => ({
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: null }),
}));
vi.mock("@admin/hooks/useLogout", () => ({
  useLogout: () => () => {},
}));
vi.mock("../sidebar/UserProfileDropdown", () => ({
  UserProfileDropdown: () => <div data-testid="account-menu" />,
}));

import { DashboardHeader } from "./DashboardHeader";

describe("DashboardHeader on a cold load", () => {
  it("asks for the reader's permissions once, though the bell reads them too", async () => {
    let release = (): void => {};
    server.permissionsGate = new Promise(done => {
      release = done;
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    render(
      <QueryClientProvider client={client}>
        <DashboardHeader />
      </QueryClientProvider>
    );
    // The first request is out and unanswered: the cold load.
    await waitFor(() => expect(server.asked).toContain("/me/permissions"));
    release();

    // The bell is the reader's (a super-admin), so it shows once the answer is in.
    expect(
      await screen.findByRole("button", { name: "Recent schema changes" })
    ).toBeInTheDocument();
    await waitFor(() => expect(client.isFetching()).toBe(0));

    expect(server.asked.filter(path => path === "/me/permissions")).toEqual([
      "/me/permissions",
    ]);
  });
});
