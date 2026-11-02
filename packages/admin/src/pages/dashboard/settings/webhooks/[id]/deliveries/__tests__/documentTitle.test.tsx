/**
 * A screen that shows one item names that item in the browser tab.
 *
 * The deliveries screen is the real one, inside the real title provider and
 * the route the router resolves for its address. Only its data hooks are
 * stubbed, so each step below is a state the webhook's answer really passes
 * through: not arrived, arrived, and renamed while the screen stays open.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { useWebhook } = vi.hoisted(() => ({ useWebhook: vi.fn() }));

vi.mock("@admin/hooks/queries", () => ({
  useWebhook: (id: string) => useWebhook(id),
  useDeliveries: () => ({
    data: { items: [], meta: { total: 0, totalPages: 1 } },
    isLoading: false,
    isError: false,
  }),
  useRunDrain: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

// The site's name is decided and tested where branding is; here it is fixed so
// the item's part of the title is the only thing that moves.
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useAppName: () => "Golden Shop",
  useBranding: () => ({}),
}));

import { createTestQueryClient } from "@admin/__tests__/utils";
import { DocumentTitleProvider } from "@admin/context/providers/DocumentTitleProvider";
import { resolveRoute } from "@admin/lib/routing";
import { QueryClientProvider } from "@tanstack/react-query";

import { DeliveriesContent } from "../index";

const DELIVERIES_PATH = "/admin/settings/webhooks/wh_1/deliveries";
const WEBHOOKS_PATH = "/admin/settings/webhooks";

const client = createTestQueryClient();

function screenAt(pathname: string, showDeliveries: boolean) {
  return (
    <QueryClientProvider client={client}>
      <DocumentTitleProvider
        route={resolveRoute(pathname, "")}
        pathname={pathname}
      >
        {showDeliveries && <DeliveriesContent id="wh_1" />}
      </DocumentTitleProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  document.title = "Host title";
  useWebhook.mockReset();
});

describe("the deliveries screen's tab title", () => {
  it("names the webhook once it arrives, and follows a rename", () => {
    useWebhook.mockReturnValue({ data: undefined, isLoading: true });
    const view = render(screenAt(DELIVERIES_PATH, true));

    // Nothing to name yet: the screen alone, never a stale or empty item.
    expect(document.title).toBe("Webhooks · Golden Shop");

    useWebhook.mockReturnValue({
      data: { id: "wh_1", name: "Order sync" },
      isLoading: false,
    });
    view.rerender(screenAt(DELIVERIES_PATH, true));
    expect(document.title).toBe("Order sync · Webhooks · Golden Shop");

    useWebhook.mockReturnValue({
      data: { id: "wh_1", name: "Order fulfilment" },
      isLoading: false,
    });
    view.rerender(screenAt(DELIVERIES_PATH, true));
    expect(document.title).toBe("Order fulfilment · Webhooks · Golden Shop");
  });

  it("drops the item when the screen showing it is left", () => {
    useWebhook.mockReturnValue({
      data: { id: "wh_1", name: "Order sync" },
      isLoading: false,
    });
    const view = render(screenAt(DELIVERIES_PATH, true));
    expect(document.title).toBe("Order sync · Webhooks · Golden Shop");

    view.rerender(screenAt(WEBHOOKS_PATH, false));
    expect(document.title).toBe("Webhooks · Golden Shop");
  });
});
