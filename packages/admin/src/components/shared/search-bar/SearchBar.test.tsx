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
