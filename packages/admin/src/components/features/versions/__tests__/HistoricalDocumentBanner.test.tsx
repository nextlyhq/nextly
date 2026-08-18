/**
 * The banner is the only thing on a historical page that says it is historical,
 * and the only way off it. What matters is that it names the version, offers
 * the way back unconditionally, and offers restoring only when restoring is a
 * decision the reader is in a position to make.
 */
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { HistoricalDocumentBanner } from "../HistoricalDocumentBanner";

describe("HistoricalDocumentBanner", () => {
  it("names the version and says it is not live", () => {
    render(
      <HistoricalDocumentBanner versionNo={7} onReturnToCurrent={vi.fn()} />
    );

    expect(screen.getByText("Version 7")).toBeInTheDocument();
    expect(screen.getByText(/not what is live/)).toBeInTheDocument();
  });

  it("names the locale a version was captured in", () => {
    render(
      <HistoricalDocumentBanner
        versionNo={7}
        locale="de"
        onReturnToCurrent={vi.fn()}
      />
    );

    expect(screen.getByText(/\(de\)/)).toBeInTheDocument();
  });

  it("always offers the way back", async () => {
    const onReturnToCurrent = vi.fn();
    render(
      <HistoricalDocumentBanner
        versionNo={7}
        onReturnToCurrent={onReturnToCurrent}
      />
    );

    // Offered even without restore: a reader who may not write still has to be
    // able to leave a page that cannot be edited.
    await userEvent.click(
      screen.getByRole("button", { name: /back to current/i })
    );
    expect(onReturnToCurrent).toHaveBeenCalled();
  });

  it("offers restoring only when a handler is supplied", () => {
    const { unmount } = render(
      <HistoricalDocumentBanner versionNo={7} onReturnToCurrent={vi.fn()} />
    );
    expect(
      screen.queryByRole("button", { name: /restore this version/i })
    ).toBeNull();
    unmount();

    render(
      <HistoricalDocumentBanner
        versionNo={7}
        onReturnToCurrent={vi.fn()}
        onRestore={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /restore this version/i })
    ).toBeInTheDocument();
  });

  it("holds restoring back until the version is actually on screen", () => {
    // Restoring writes the live document. Choosing it from a skeleton, or from
    // a version that failed to load, is a decision made without having seen
    // what is being chosen.
    const onRestore = vi.fn();
    render(
      <HistoricalDocumentBanner
        versionNo={7}
        onReturnToCurrent={vi.fn()}
        onRestore={onRestore}
        restoreDisabled
      />
    );

    expect(
      screen.getByRole("button", { name: /restore this version/i })
    ).toBeDisabled();
    // The way back stays available: being unable to restore is not being
    // trapped on the page.
    expect(
      screen.getByRole("button", { name: /back to current/i })
    ).toBeEnabled();
  });
});
