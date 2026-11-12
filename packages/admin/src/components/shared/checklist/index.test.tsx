/**
 * The checklist the setup card draws, as a component of its own.
 *
 * The mark and the styling only SHOW a step's status, so what separates a
 * correct checklist from a plausible broken one is what a reader without them
 * gets: the status spoken after each name, a mark whose shape (not colour)
 * differs by status, and a finished step read quieter than an open one by the
 * host's own judgement of "finished". The bar is a picture, so it must stay
 * hidden from assistive technology while its width follows the count.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Checklist, ChecklistItem, ChecklistProgress } from "./index";

function renderSteps() {
  return render(
    <Checklist label="Set up SEO" done={1} total={3}>
      <ChecklistItem status="done" label="Name the site" hint="Done" />
      <ChecklistItem
        status="open"
        label="Bring in old values"
        hint="Nothing imported yet"
        actions={<button type="button">Import</button>}
      />
      <ChecklistItem status="skipped" label="Connect Search Console" />
    </Checklist>
  );
}

describe("Checklist", () => {
  it("lists the steps in order under the list's own name", () => {
    renderSteps();
    const list = screen.getByRole("list", { name: "Set up SEO" });
    const items = within(list).getAllByRole("listitem");

    expect(list.tagName).toBe("OL");
    expect(items.map(item => item.getAttribute("data-status"))).toEqual([
      "done",
      "open",
      "skipped",
    ]);
  });

  it("speaks each step's status after its name", () => {
    renderSteps();
    const [done, open, skipped] = screen.getAllByRole("listitem");

    expect(done).toHaveTextContent("Name the site — done");
    expect(open).toHaveTextContent("Bring in old values — still to do");
    expect(skipped).toHaveTextContent("Connect Search Console — skipped");
  });

  it("draws a mark of its own shape per status, hidden from assistive technology", () => {
    const { container } = renderSteps();
    const marks = Array.from(
      container.querySelectorAll<HTMLElement>("[data-checklist-mark]")
    );

    expect(marks.map(mark => mark.dataset.checklistMark)).toEqual([
      "done",
      "open",
      "skipped",
    ]);
    marks.forEach(mark => expect(mark).toHaveAttribute("aria-hidden", "true"));
    // The tick is drawn only on a done step; skipped is told by its dashes.
    expect(marks[0]!.querySelector("svg")).not.toBeNull();
    expect(marks[1]!.querySelector("svg")).toBeNull();
    expect(marks[2]).toHaveClass("border-dashed");
    expect(marks[1]).not.toHaveClass("border-dashed");
  });

  it("reads a finished step quieter than an open one", () => {
    renderSteps();
    const [done, open, skipped] = screen
      .getAllByRole("listitem")
      .map(item => item.querySelector("p")!);

    expect(done).toHaveClass("text-muted-foreground");
    expect(skipped).toHaveClass("text-muted-foreground");
    expect(open).toHaveClass("font-medium", "text-foreground");
    expect(open).not.toHaveClass("text-muted-foreground");
  });

  it("keeps a step's buttons beside it, and takes no room for none", () => {
    renderSteps();
    const [done, open] = screen.getAllByRole("listitem");

    expect(
      within(open!).getByRole("button", { name: "Import" }).parentElement
    ).toHaveAttribute("data-checklist-actions");
    expect(
      done!.querySelector("[data-checklist-actions]")
    ).toBeEmptyDOMElement();
    expect(done!.querySelector("[data-checklist-actions]")).toHaveClass(
      "empty:hidden"
    );
  });

  it("draws one column with a rule between steps, and no struck name, by default", () => {
    renderSteps();
    const list = screen.getByRole("list", { name: "Set up SEO" });
    const [done] = screen
      .getAllByRole("listitem")
      .map(item => item.querySelector("p")!);

    expect(list.className).not.toMatch(/grid-cols-2/);
    expect(list.className).not.toContain("border-t-0");
    expect(done).not.toHaveClass("line-through");
  });

  it("lays its steps in two columns, without rules, when asked", () => {
    const { container } = render(
      <Checklist label="Set up SEO" done={0} total={2} columns={2}>
        <ChecklistItem status="open" label="One" />
        <ChecklistItem status="open" label="Two" />
      </Checklist>
    );
    const list = screen.getByRole("list", { name: "Set up SEO" });

    // Two columns where the checklist's own box is wide enough, one below.
    expect(list).toHaveClass("grid-cols-1", "@2xl:grid-cols-2");
    expect(list).toHaveClass("[&>li]:border-t-0");
    expect(container.firstElementChild).toHaveClass("@container");
  });

  it("strikes through a done step's name when asked, and only a done one's", () => {
    render(
      <Checklist label="Set up SEO" done={1} total={3} doneStyle="struck">
        <ChecklistItem status="done" label="Name the site" />
        <ChecklistItem status="open" label="Bring in old values" />
        <ChecklistItem status="skipped" label="Connect Search Console" />
      </Checklist>
    );
    const [done, open, skipped] = screen
      .getAllByRole("listitem")
      .map(item => item.querySelector("p")!);

    expect(done).toHaveClass("line-through", "text-muted-foreground");
    expect(open).not.toHaveClass("line-through");
    expect(skipped).not.toHaveClass("line-through");
    // Struck is a look: the status is still spoken.
    expect(done).toHaveTextContent("Name the site — done");
  });

  it("draws a failed hint in the danger text colour", () => {
    render(
      <ol>
        <ChecklistItem status="open" label="Load" hint="It failed" hintFailed />
      </ol>
    );

    expect(screen.getByText("It failed")).toHaveClass("text-danger-text");
  });
});

describe("ChecklistProgress", () => {
  it("is a picture whose width follows the count", () => {
    const { container } = render(<ChecklistProgress done={4} total={6} />);
    const bar = container.querySelector<HTMLElement>(
      "[data-checklist-progress]"
    )!;

    expect(bar).toHaveAttribute("aria-hidden", "true");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("67%");
  });

  it("draws an empty bar for an empty list rather than dividing by zero", () => {
    const { container } = render(<ChecklistProgress done={0} total={0} />);
    const fill = container.querySelector<HTMLElement>(
      "[data-checklist-progress] > div"
    )!;

    expect(fill.style.width).toBe("0%");
  });
});
