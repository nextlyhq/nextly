/**
 * The empty list offers to create the first entry only when it is given a way
 * to: a caller who may not create, or a collection only a machine fills, gets
 * the empty state without a button that would lead nowhere.
 */
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { EntryEmptyState } from "../EntryEmptyState";

describe("EntryEmptyState", () => {
  it("offers to create the first entry when it can be created", async () => {
    const onCreateClick = vi.fn();
    render(
      <EntryEmptyState
        collectionName="Posts"
        singularName="Post"
        onCreateClick={onCreateClick}
      />
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /create post/i }));
    expect(onCreateClick).toHaveBeenCalledTimes(1);
  });

  it("offers nothing to create when it cannot be", () => {
    render(<EntryEmptyState collectionName="Posts" singularName="Post" />);

    expect(screen.getByText(/no posts yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/get started by creating/i)
    ).not.toBeInTheDocument();
  });
});
