/**
 * The three behaviours the hook's docblock claims, each asserted where a
 * plausible wrong implementation would differ.
 *
 * The card-level test covers the case a reader sees; these cover the ones a
 * caller depends on and the card cannot reach — a timestamp that CHANGES while
 * mounted is the case the dashboard exercises on every window focus.
 */
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useRelativeTime } from "@admin/hooks/useRelativeTime";

function Probe({ date }: { date: Date | null | undefined }) {
  const label = useRelativeTime(date);
  return <span data-testid="label">{label ?? "(null)"}</span>;
}

function label() {
  return screen.getByTestId("label").textContent;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useRelativeTime", () => {
  it("answers null for no timestamp, so a caller reads one value for it", () => {
    render(<Probe date={null} />);
    expect(label()).toBe("(null)");
  });

  it("answers null for undefined as well as null", () => {
    render(<Probe date={undefined} />);
    expect(label()).toBe("(null)");
  });

  it("advances across the minute boundary without an outside render", () => {
    vi.useFakeTimers();
    render(<Probe date={new Date()} />);
    expect(label()).toBe("just now");

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(label()).toBe("1m ago");
  });

  it("advances across the hour boundary, where it ticks far less often", () => {
    // The second bucket, so a hook that only ever armed the 5-second interval
    // is not what these assertions are satisfied by.
    vi.useFakeTimers();
    render(<Probe date={new Date()} />);

    act(() => {
      vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    });
    expect(label()).toBe("2h ago");
  });

  it("re-reads a timestamp that CHANGED while mounted", () => {
    // What a refetch does on every window focus. A hook holding the label in
    // state and seeding it once would keep showing the old one.
    vi.useFakeTimers();
    const landed = new Date();
    const { rerender } = render(<Probe date={landed} />);

    act(() => {
      vi.advanceTimersByTime(10 * 60 * 1000);
    });
    expect(label()).toBe("10m ago");

    // The refetch lands: a new timestamp, at the new "now".
    rerender(<Probe date={new Date()} />);
    expect(label()).toBe("just now");
  });

  it("stops ticking once unmounted", () => {
    // A recursive `setTimeout` that re-armed after unmount would keep calling
    // `tick` on a torn-down component, which React reports as an error.
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<Probe date={new Date()} />);
    unmount();

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(vi.getTimerCount()).toBe(0);
    expect(errors).not.toHaveBeenCalled();
  });
});
