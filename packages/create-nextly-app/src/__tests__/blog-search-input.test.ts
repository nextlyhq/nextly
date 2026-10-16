// @vitest-environment jsdom
/**
 * The blog's search box, rendered against a stand-in for the Pagefind bundle
 * the build generates. An emptied box must forget the last answer: clearing
 * it and typing a new query, however quickly, never shows the old query's
 * results while the new search runs.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SearchInput } from "../../../../templates/blog/src/app/(frontend)/components/SearchInput";
import { pending } from "./stubs/pagefind";

/** Answer the search for `query` once the box has asked for it; `false` finds nothing. */
async function answer(query: string, finds = true) {
  await waitFor(() => expect(pending.has(query)).toBe(true));
  await act(async () => {
    pending.get(query)?.(finds);
  });
}

const box = () => screen.getByRole("searchbox", { name: "Search" });

describe("the blog's search box", () => {
  afterEach(() => {
    cleanup();
    pending.clear();
  });

  it("shows a query's results once its search answers", async () => {
    render(createElement(SearchInput));
    fireEvent.change(box(), { target: { value: "alpha" } });
    await answer("alpha");

    expect(await screen.findByText("Post about alpha")).toBeTruthy();
  });

  it("never shows the old results after the box is cleared and a new query typed at once", async () => {
    render(createElement(SearchInput));
    fireEvent.change(box(), { target: { value: "alpha" } });
    await answer("alpha");
    await screen.findByText("Post about alpha");

    // Cleared and retyped within the pause before a search starts.
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.change(box(), { target: { value: "beta" } });

    expect(screen.queryByText("Post about alpha")).toBeNull();
    await waitFor(() => expect(pending.has("beta")).toBe(true));
    expect(screen.queryByText("Post about alpha")).toBeNull();
    // "No results" waits for the new search's own answer.
    expect(screen.queryByText(/No results/)).toBeNull();

    await answer("beta");
    expect(await screen.findByText("Post about beta")).toBeTruthy();
  });

  it("never shows an old search that answers after the box is cleared", async () => {
    render(createElement(SearchInput));
    fireEvent.change(box(), { target: { value: "alpha" } });
    await waitFor(() => expect(pending.has("alpha")).toBe(true));

    // Cleared and retyped while the old search is still running.
    fireEvent.change(box(), { target: { value: "" } });
    fireEvent.change(box(), { target: { value: "beta" } });
    await answer("alpha");

    expect(screen.queryByText("Post about alpha")).toBeNull();
    await answer("beta");
    expect(await screen.findByText("Post about beta")).toBeTruthy();
    expect(screen.queryByText("Post about alpha")).toBeNull();
  });

  it('says "No results" once a search answers with nothing', async () => {
    render(createElement(SearchInput));
    fireEvent.change(box(), { target: { value: "nothing" } });
    await waitFor(() => expect(pending.has("nothing")).toBe(true));
    expect(screen.queryByText(/No results/)).toBeNull();

    await answer("nothing", false);

    expect(await screen.findByText(/No results for "nothing"/)).toBeTruthy();
  });
});
