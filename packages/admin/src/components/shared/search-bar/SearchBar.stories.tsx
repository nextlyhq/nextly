import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { SearchBar } from "./index";

/**
 * SearchBar component with debounced search, clear button, and loading indicator
 *
 * The SearchBar component is a reusable search input that supports:
 * - Debounced input to reduce API calls (default: 300ms)
 * - Clear button that appears when input has value
 * - Loading spinner indicator during data fetching
 * - Full keyboard and accessibility support
 */
const meta = {
  title: "Components/Forms/SearchBar",
  component: SearchBar,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "A search input component with debouncing, clear button, and loading states. Designed for data tables and lists that require search functionality with reduced API calls.",
      },
    },
  },
  tags: ["autodocs"],
  argTypes: {
    value: {
      control: "text",
      description: "Current search value",
      table: {
        type: { summary: "string" },
      },
    },
    placeholder: {
      control: "text",
      description: "Placeholder text for the input",
      table: {
        type: { summary: "string" },
        defaultValue: { summary: "Search..." },
      },
    },
    debounceDelay: {
      control: { type: "number", min: 0, max: 2000, step: 100 },
      description: "Debounce delay in milliseconds",
      table: {
        type: { summary: "number" },
        defaultValue: { summary: "300" },
      },
    },
    isLoading: {
      control: "boolean",
      description: "Loading state indicator (shows spinner)",
      table: {
        type: { summary: "boolean" },
        defaultValue: { summary: "false" },
      },
    },
    className: {
      control: "text",
      description: "Optional custom className for the container",
    },
  },
  args: {
    onChange: () => {},
  },
} satisfies Meta<typeof SearchBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// ========================================
// Default Story
// ========================================

export const Default: Story = {
  render: () => {
    const [search, setSearch] = useState("");
    return (
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search users..."
      />
    );
  },
};

// ========================================
// States
// ========================================

export const WithValue: Story = {
  render: () => {
    const [search, setSearch] = useState("John Doe");
    return (
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search users..."
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "SearchBar with initial value. Clear button (X) is visible when input has value.",
      },
    },
  },
};

export const Loading: Story = {
  render: () => {
    const [search, setSearch] = useState("searching...");
    return (
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search users..."
        isLoading={true}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "SearchBar in loading state. Shows animated spinner on the right side.",
      },
    },
  },
};

export const CustomPlaceholder: Story = {
  render: () => {
    const [search, setSearch] = useState("");
    return (
      <SearchBar
        value={search}
        onChange={setSearch}
        placeholder="Search by name or email..."
      />
    );
  },
};

// ========================================
// Debounce Delays
// ========================================

export const FastDebounce: Story = {
  render: () => {
    const [search, setSearch] = useState("");
    return (
      <div className="space-y-4">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Fast debounce (100ms)"
          debounceDelay={100}
        />
        <div className="text-sm text-muted-foreground">
          Debounced value:{" "}
          <span className="font-mono">{search || "(empty)"}</span>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: "SearchBar with 100ms debounce delay for faster responses.",
      },
    },
  },
};

export const SlowDebounce: Story = {
  render: () => {
    const [search, setSearch] = useState("");
    return (
      <div className="space-y-4">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Slow debounce (1000ms)"
          debounceDelay={1000}
        />
        <div className="text-sm text-muted-foreground">
          Debounced value:{" "}
          <span className="font-mono">{search || "(empty)"}</span>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "SearchBar with 1000ms debounce delay. Useful for expensive API calls.",
      },
    },
  },
};

// ========================================
// Use Cases
// ========================================

export const UserSearch: Story = {
  render: () => {
    const [search, setSearch] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    // Simulate API call
    const handleChange = (value: string) => {
      setSearch(value);
      if (value) {
        setIsLoading(true);
        setTimeout(() => setIsLoading(false), 1000);
      } else {
        setIsLoading(false);
      }
    };

    return (
      <div className="w-full max-w-md space-y-4">
        <SearchBar
          value={search}
          onChange={handleChange}
          placeholder="Search users by name or email"
          isLoading={isLoading}
        />
        <div className="text-sm text-muted-foreground">
          {isLoading ? (
            <span>Searching...</span>
          ) : search ? (
            <span>
              Searching for: <span className="font-mono">{search}</span>
            </span>
          ) : (
            <span>Type to search users</span>
          )}
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          "Example user search with simulated API call. Shows loading state during search.",
      },
    },
  },
};

export const ProductSearch: Story = {
  render: () => {
    const [search, setSearch] = useState("");
    return (
      <div className="w-full max-w-md space-y-4">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search products..."
        />
        <div className="rounded-md border border-border p-4">
          <p className="text-sm text-muted-foreground">
            {search
              ? `Showing results for "${search}"`
              : "Start typing to search products"}
          </p>
        </div>
      </div>
    );
  },
  parameters: {
    docs: {
      description: {
        story: "Example product search with results display.",
      },
    },
  },
};

// ========================================
// Full Width Example
// ========================================

export const FullWidth: Story = {
  render: () => {
    const [search, setSearch] = useState("");
    return (
      <div className="w-full">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Full width search..."
          className="w-full"
        />
      </div>
    );
  },
  parameters: {
    layout: "padded",
    docs: {
      description: {
        story: "SearchBar with full width using className prop.",
      },
    },
  },
};

// ========================================
// Interactive Demo
// ========================================

export const InteractiveDemo: Story = {
  render: () => {
    const [search, setSearch] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [debounceDelay, setDebounceDelay] = useState(300);

    const handleChange = (value: string) => {
      setSearch(value);
      if (value) {
        setIsLoading(true);
        setTimeout(() => setIsLoading(false), 800);
      } else {
        setIsLoading(false);
      }
    };

    return (
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-2">
          <label className="text-sm font-medium">Search Input</label>
          <SearchBar
            value={search}
            onChange={handleChange}
            placeholder="Type to search..."
            isLoading={isLoading}
            debounceDelay={debounceDelay}
          />
        </div>

        <div className="space-y-3 rounded-md border border-border p-4">
          <h3 className="text-sm font-semibold">Settings</h3>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">
              Debounce Delay: {debounceDelay}ms
            </label>
            <input
              type="range"
              min="0"
              max="2000"
              step="100"
              value={debounceDelay}
              onChange={e => setDebounceDelay(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        <div className="rounded-md border border-border p-4">
          <h3 className="text-sm font-semibold mb-2">State</h3>
          <div className="space-y-1 text-sm text-muted-foreground">
            <div>
              Search value:{" "}
              <span className="font-mono">{search || "(empty)"}</span>
            </div>
            <div>
              Loading:{" "}
              <span className="font-mono">{isLoading ? "true" : "false"}</span>
            </div>
            <div>
              Debounce: <span className="font-mono">{debounceDelay}ms</span>
            </div>
          </div>
        </div>
      </div>
    );
  },
  parameters: {
    layout: "padded",
    docs: {
      description: {
        story:
          "Interactive demo with configurable debounce delay and state visualization.",
      },
    },
  },
};
