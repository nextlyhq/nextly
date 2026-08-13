import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";

import { SearchBar } from "./index";

describe("SearchBar", () => {
  // ========================================
  // Basic Rendering
  // ========================================

  it("renders search input element", () => {
    const handleChange = vi.fn();
    render(<SearchBar value="" onChange={handleChange} />);

    expect(screen.getByTestId("search-input")).toBeInTheDocument();
  });

  it("takes its height from the control token, not its own", () => {
    // Composing Input is only worth anything if Input's decisions survive.
    // `h-10` here happens to equal today's `--nx-control-height`, so nothing
    // looks wrong -- and the field would silently stay at 40px the moment a
    // consumer or the design system moved the token, which is the drift this
    // component was rewritten to remove.
    const handleChange = vi.fn();
    render(<SearchBar value="" onChange={handleChange} />);

    const classes = screen.getByTestId("search-input").className.split(/\s+/);
    expect(classes).toContain("h-[var(--nx-control-height)]");
    expect(
      classes.filter(name => /^h-(?!\[var\(--nx-control-height\)\])/.test(name))
    ).toEqual([]);
  });

  it("warns when a class reaches the wrapper and does nothing", () => {
    // This warning is the COMPLETE half of the dead-class check: it has the
    // final class string, so no spelling can hide from it. The source scan
    // beside it only reads literals and defers everything else here, so if this
    // stops firing the computed forms lose their only coverage.
    // The environment is stated rather than inherited. The guard opts INTO
    // development so that an absent or unexpected NODE_ENV stays silent rather
    // than shipping a warning to consumers, which means the suite's own
    // `test` value does not trigger it -- and a test that quietly relied on
    // the ambient value would break the moment that polarity was corrected.
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(
        <SearchBar
          value=""
          onChange={vi.fn()}
          className="w-full border-input"
        />
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("border-input");
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it.each(["production", "staging", ""])(
    "stays silent when NODE_ENV is %o",
    environment => {
      // "production" alone does NOT separate the two polarities: an opt-out
      // that returns early on an exact "production" passes it just as an
      // opt-in does. What separates them is a THIRD value — an unset or
      // unexpected NODE_ENV, which is precisely the case a bundler can leave
      // behind, and where an opt-out ships a console warning to every consumer.
      //
      // Verified: with the guard written as `=== "production"`, the empty and
      // "staging" cases fail and the "production" case still passes.
      vi.stubEnv("NODE_ENV", environment);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        render(
          <SearchBar
            value=""
            onChange={vi.fn()}
            className="w-full border-input"
          />
        );
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
        vi.unstubAllEnvs();
      }
    }
  );

  it("says nothing about a layout class", () => {
    // The negative half. A warning that fired on every className would satisfy
    // the assertion above and make the component unusable.
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(<SearchBar value="" onChange={vi.fn()} className="w-full" />);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("displays custom placeholder", () => {
    const handleChange = vi.fn();
    render(
      <SearchBar
        value=""
        onChange={handleChange}
        placeholder="Search users..."
      />
    );

    expect(screen.getByPlaceholderText(/search users/i)).toBeInTheDocument();
  });

  it("displays default placeholder", () => {
    const handleChange = vi.fn();
    render(<SearchBar value="" onChange={handleChange} />);

    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it("renders search icon", () => {
    const handleChange = vi.fn();
    const { container } = render(
      <SearchBar value="" onChange={handleChange} />
    );

    // Search icon should be in the DOM (lucide-react renders as svg)
    const searchIcon = container.querySelector("svg");
    expect(searchIcon).toBeInTheDocument();
  });

  // ========================================
  // Value Display
  // ========================================

  it("displays current value", () => {
    const handleChange = vi.fn();
    render(<SearchBar value="test query" onChange={handleChange} />);

    expect(screen.getByDisplayValue("test query")).toBeInTheDocument();
  });

  it("updates display value when prop changes", () => {
    const handleChange = vi.fn();
    const { rerender } = render(
      <SearchBar value="initial" onChange={handleChange} />
    );

    expect(screen.getByDisplayValue("initial")).toBeInTheDocument();

    rerender(<SearchBar value="updated" onChange={handleChange} />);

    expect(screen.getByDisplayValue("updated")).toBeInTheDocument();
  });

  // ========================================
  // Debounce Logic
  // ========================================

  it("debounces onChange calls with default delay", async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();

    render(<SearchBar value="" onChange={handleChange} />);

    const input = screen.getByTestId("search-input");
    await user.type(input, "test");

    // Should not be called immediately
    expect(handleChange).not.toHaveBeenCalled();

    // Wait for debounce delay (300ms + buffer)
    await waitFor(
      () => {
        expect(handleChange).toHaveBeenCalled();
      },
      { timeout: 1000 }
    );

    expect(handleChange).toHaveBeenCalledWith("test");
  });

  it("accepts custom debounce delay", async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();

    render(<SearchBar value="" onChange={handleChange} debounceDelay={100} />);

    const input = screen.getByTestId("search-input");
    await user.type(input, "fast");

    // Wait for short debounce
    await waitFor(
      () => {
        expect(handleChange).toHaveBeenCalled();
      },
      { timeout: 500 }
    );

    expect(handleChange).toHaveBeenCalledWith("fast");
  });

  it("does not debounce when clearing with clear button", async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();

    render(<SearchBar value="test" onChange={handleChange} />);

    const clearButton = screen.getByRole("button", { name: /clear search/i });
    await user.click(clearButton);

    // Should call onChange immediately (not debounced)
    expect(handleChange).toHaveBeenCalledWith("");
  });

  // ========================================
  // Clear Button
  // ========================================

  it("shows clear button when value is not empty", () => {
    const handleChange = vi.fn();
    render(<SearchBar value="query" onChange={handleChange} />);

    expect(
      screen.getByRole("button", { name: /clear search/i })
    ).toBeInTheDocument();
  });

  it("hides clear button when value is empty", () => {
    const handleChange = vi.fn();
    render(<SearchBar value="" onChange={handleChange} />);

    expect(
      screen.queryByRole("button", { name: /clear search/i })
    ).not.toBeInTheDocument();
  });

  it("clears value when clear button is clicked", async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();

    render(<SearchBar value="test query" onChange={handleChange} />);

    const clearButton = screen.getByRole("button", { name: /clear search/i });
    await user.click(clearButton);

    expect(handleChange).toHaveBeenCalledWith("");
  });

  it("attempts to focus input after clearing", async () => {
    const handleChange = vi.fn();
    const user = userEvent.setup();

    render(<SearchBar value="test" onChange={handleChange} />);

    const input = screen.getByTestId("search-input");
    const clearButton = screen.getByRole("button", { name: /clear search/i });

    // Verify clear button functionality (focus behavior tested manually)
    await user.click(clearButton);
    expect(handleChange).toHaveBeenCalledWith("");

    // Note: Focus behavior is present in implementation but difficult to test in jsdom
  });

  // ========================================
  // Loading State
  // ========================================

  it("shows loading spinner when isLoading is true", () => {
    const handleChange = vi.fn();
    const { container } = render(
      <SearchBar value="query" onChange={handleChange} isLoading={true} />
    );

    // Loader2 icon should be in the DOM (animate-spin class)
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeInTheDocument();
  });

  it("hides loading spinner when isLoading is false", () => {
    const handleChange = vi.fn();
    const { container } = render(
      <SearchBar value="query" onChange={handleChange} isLoading={false} />
    );

    const spinner = container.querySelector(".animate-spin");
    expect(spinner).not.toBeInTheDocument();
  });

  it("sets aria-busy when loading", () => {
    const handleChange = vi.fn();
    render(
      <SearchBar value="query" onChange={handleChange} isLoading={true} />
    );

    const input = screen.getByTestId("search-input");
    expect(input).toHaveAttribute("aria-busy", "true");
  });

  // ========================================
  // Custom ClassName
  // ========================================

  it("applies custom className to container", () => {
    const handleChange = vi.fn();
    const { container } = render(
      <SearchBar
        value=""
        onChange={handleChange}
        className="custom-search-class"
      />
    );

    const searchContainer = container.firstChild;
    expect(searchContainer).toHaveClass("custom-search-class");
  });

  // ========================================
  // Accessibility
  // ========================================

  it("has correct input type", () => {
    const handleChange = vi.fn();
    render(<SearchBar value="" onChange={handleChange} />);

    const input = screen.getByTestId("search-input");
    expect(input).toHaveAttribute("type", "search");
  });

  it("supports forwarded ref", () => {
    const handleChange = vi.fn();
    const ref = vi.fn();

    render(<SearchBar ref={ref} value="" onChange={handleChange} />);

    expect(ref).toHaveBeenCalled();
  });

  // ========================================
  // Edge Cases
  // ========================================

  it("handles empty string as value", () => {
    const handleChange = vi.fn();
    render(<SearchBar value="" onChange={handleChange} />);

    expect(screen.getByTestId("search-input")).toHaveValue("");
  });

  it("handles controlled component updates", async () => {
    const handleChange = vi.fn();
    const { rerender } = render(<SearchBar value="" onChange={handleChange} />);

    const input = screen.getByTestId("search-input");
    expect(input).toHaveValue("");

    // Update value via props
    rerender(<SearchBar value="new value" onChange={handleChange} />);

    expect(input).toHaveValue("new value");
  });
});
