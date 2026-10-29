// @vitest-environment jsdom
/**
 * The confirming action of an alert dialog is red only when the caller says it
 * deletes data. A dialog confirms saves, publishes and restores as often as it
 * confirms a delete, and a red default made every one of those look like data
 * loss unless its caller remembered to override the colour.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "../alert-dialog";
import { buttonVariants } from "../button";

afterEach(cleanup);

function confirmButton(action: React.ReactElement): HTMLButtonElement {
  render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogTitle>Confirm</AlertDialogTitle>
        <AlertDialogDescription>What happens next.</AlertDialogDescription>
        <AlertDialogFooter>{action}</AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return screen.getByRole("button", { name: "Go" });
}

/** The classes a button variant draws with, to compare a rendered button to. */
function classesOf(variant: "primary" | "destructive"): string[] {
  return buttonVariants({ variant }).split(/\s+/).filter(Boolean);
}

describe("AlertDialogAction", () => {
  it("the confirm action is primary unless asked to be destructive", () => {
    const fill = (button: HTMLButtonElement) =>
      [...button.classList].filter(name => /^(hover:)?bg-/.test(name)).sort();

    const plain = confirmButton(<AlertDialogAction>Go</AlertDialogAction>);
    expect(fill(plain)).toEqual(
      classesOf("primary")
        .filter(name => /^(hover:)?bg-/.test(name))
        .sort()
    );
    cleanup();

    const deleting = confirmButton(
      <AlertDialogAction variant="destructive">Go</AlertDialogAction>
    );
    expect(fill(deleting)).toEqual(
      classesOf("destructive")
        .filter(name => /^(hover:)?bg-/.test(name))
        .sort()
    );
    // The two must differ, or the comparison above would pass with one fill
    // for both.
    expect(fill(deleting)).not.toEqual(fill(plain));
  });
});
