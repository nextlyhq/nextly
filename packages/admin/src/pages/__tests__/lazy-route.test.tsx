/**
 * The three states a lazy route moves through — loading, page, recoverable
 * error — and the retry that turns a failed fetch into a rendered page
 * (R-2's fetch-failure clauses). The shell is outside the route by
 * construction; a wrapping shell div here stands in for it, asserting it
 * never leaves.
 */
import { render, screen, waitFor } from "@admin/__tests__/utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { lazyRoute, type RouteModule } from "../lazy-route";

const Page = () => <div data-testid="page">the page</div>;

/** A loader whose first call rejects and whose second resolves. */
function failingThenWorkingLoader(): () => Promise<{ default: typeof Page }> {
  const impl = vi
    .fn()
    .mockImplementationOnce(() => Promise.reject(new Error("offline")))
    .mockImplementationOnce(() => Promise.resolve({ default: Page }));
  return impl as unknown as () => Promise<{ default: typeof Page }>;
}

function renderInShell(ui: React.ReactElement) {
  return render(<div data-testid="shell">{ui}</div>);
}

describe("lazyRoute", () => {
  it("shows the loading state while the chunk is in flight, then the page", async () => {
    const loader = vi.fn((): Promise<RouteModule> => new Promise(() => {}));
    const Route = lazyRoute(loader);
    renderInShell(<Route />);

    expect(screen.getByTestId("route-loading")).toBeTruthy();
    expect(screen.queryByTestId("page")).toBeNull();
  });

  it("renders the page once the chunk arrives", async () => {
    const Route = lazyRoute(() =>
      Promise.resolve({ default: Page })
    );
    renderInShell(<Route />);

    await waitFor(() =>
      expect(screen.getByTestId("page")).toBeTruthy()
    );
    expect(screen.queryByTestId("route-loading")).toBeNull();
  });

  it("keeps the shell and shows a recoverable error when the fetch fails", async () => {
    const Route = lazyRoute(failingThenWorkingLoader());
    renderInShell(<Route />);

    await waitFor(() =>
      expect(screen.getByTestId("route-load-error")).toBeTruthy()
    );
    // The shell held through the failure.
    expect(screen.getByTestId("shell")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("re-attempts the fetch on retry and renders the route when it arrives", async () => {
    const loader = failingThenWorkingLoader();
    const Route = lazyRoute(loader);
    renderInShell(<Route />);

    await waitFor(() =>
      expect(screen.getByTestId("route-load-error")).toBeTruthy()
    );

    await userEvent.click(
      screen.getByRole("button", { name: /try again/i })
    );

    await waitFor(() => expect(screen.getByTestId("page")).toBeTruthy());
    expect(loader).toHaveBeenCalledTimes(2);
    // The error left with the retry; the shell never did.
    expect(screen.queryByTestId("route-load-error")).toBeNull();
    expect(screen.getByTestId("shell")).toBeTruthy();
  });

  it("passes the route's props through to the page", async () => {
    const PageWithProps = (props: { params?: { slug?: string } }) => (
      <div data-testid="page">{props.params?.slug}</div>
    );
    const Route = lazyRoute(() =>
      Promise.resolve({ default: PageWithProps })
    );
    render(<Route params={{ slug: "news" }} />);

    await waitFor(() =>
      expect(screen.getByTestId("page")).toHaveTextContent("news")
    );
  });
});
