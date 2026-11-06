// The hook under the real branding provider, with only the network and the
// session supplied: the installed plugins' field types reach a picker surface
// from the admin-meta answer, not from a value a test hands the hook.
// `plugin-field-type-entries.test.ts` covers the projection on its own; this
// covers the hook reading it from where the admin keeps it.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AdminBranding } from "@admin/types/branding";

const publicGet = vi.fn();
const protectedGet = vi.fn();

vi.mock("@admin/lib/api/publicApi", () => ({
  publicApi: { get: (...args: unknown[]) => publicGet(...args) },
}));

vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get: (...args: unknown[]) => protectedGet(...args) },
}));

vi.mock("@admin/hooks/queries/useAuthSession", () => ({
  useAuthSession: () => ({
    data: { isSetup: true, isAuthenticated: true },
    isPending: false,
  }),
  authSessionKey: ["auth", "session"],
}));

import { BrandingProvider } from "@admin/context/providers/BrandingProvider";

import { usePluginFieldTypeEntries } from "../usePluginFieldTypeEntries";

const WORKSPACE: Partial<AdminBranding> = {
  plugins: [
    {
      name: "ratings",
      collections: [],
      fieldTypes: [
        {
          type: "rating",
          component: "ratings/Rating",
          storage: "number",
          label: "Rating",
          description: "Stars out of five",
          icon: "Star",
          category: "Advanced",
          surfaces: ["entries", "forms"],
        },
        {
          type: "signature",
          component: "ratings/Signature",
          storage: "text",
          label: "Signature",
          surfaces: ["forms"],
        },
      ],
    },
  ],
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <BrandingProvider>{children}</BrandingProvider>
    </QueryClientProvider>
  );
}

describe("usePluginFieldTypeEntries under the branding provider", () => {
  it("projects the installed plugins' field types for its surface", async () => {
    publicGet.mockResolvedValue({});
    protectedGet.mockResolvedValue(WORKSPACE);

    const { result } = renderHook(() => usePluginFieldTypeEntries("entries"), {
      wrapper,
    });

    await waitFor(() => expect(result.current).not.toEqual([]));
    expect(result.current).toEqual([
      {
        type: "rating",
        label: "Rating",
        category: "Advanced",
        hint: "Stars out of five",
        icon: "Star",
      },
    ]);
  });

  it("lists a type declared for another surface only there", async () => {
    publicGet.mockResolvedValue({});
    protectedGet.mockResolvedValue(WORKSPACE);

    const { result } = renderHook(() => usePluginFieldTypeEntries("forms"), {
      wrapper,
    });

    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current.map(row => row.type)).toEqual([
      "rating",
      "signature",
    ]);
  });
});
