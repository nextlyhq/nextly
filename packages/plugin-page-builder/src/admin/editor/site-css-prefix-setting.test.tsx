// @vitest-environment jsdom
/**
 * Settings → Site → Advanced: the CSS variable prefix shown with what a
 * change asks of the site's own CSS, each refused prefix with its reason, a
 * prefix the site's code sets, and a change that asks first and says what it
 * leaves behind.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SiteCssPrefixRead } from "../../library-contract";

import { SiteCssPrefixSetting } from "./site-css-prefix-setting";

/** Every body sent to the prefix route, in order. */
const sent: unknown[] = [];
/** What the dry run answers with: the places naming the old prefix. */
let dryRunUses = { oldPrefixUses: 0, usesComplete: true };

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  writePluginRoute: async ({ body }: { path: string; body: unknown }) => {
    sent.push(body);
    const asked = body as { prefix: string; dryRun?: boolean };
    return asked.dryRun === true
      ? {
          message: "",
          item: { dryRun: true, prefix: asked.prefix, ...dryRunUses },
        }
      : {
          message: "",
          item: { prefix: { current: asked.prefix, stored: asked.prefix } },
        };
  },
}));

const reread = vi.fn();
const refreshStyle = vi.fn();

function draw(prefix: SiteCssPrefixRead = { current: "--site-" }) {
  return render(
    <SiteCssPrefixSetting
      prefix={prefix}
      reread={reread}
      refreshStyle={refreshStyle}
    />
  );
}

function field(): HTMLInputElement {
  return screen.getByLabelText("CSS variable prefix") as HTMLInputElement;
}

function changeButton(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: "Change prefix",
  }) as HTMLButtonElement;
}

beforeEach(() => {
  sent.length = 0;
  dryRunUses = { oldPrefixUses: 0, usesComplete: true };
  reread.mockClear();
  refreshStyle.mockClear();
});

afterEach(cleanup);

describe("the CSS variable prefix setting", () => {
  it("shows --site- under Advanced, with what a change asks of the site's own CSS", () => {
    draw();
    expect(screen.getByRole("heading", { name: "Advanced" })).toBeTruthy();
    expect(field().value).toBe("--site-");
    expect(
      screen.getByText(
        "Your site's own CSS that uses --site- names must change too."
      )
    ).toBeTruthy();
    // Nothing to change yet.
    expect(changeButton().disabled).toBe(true);
    expect(screen.queryByText(/Your site's code sets/)).toBeNull();
  });

  it.each([
    [
      "--nx-",
      "--nx- is kept for the admin's own styles. Choose another prefix.",
    ],
    ["--tw-", "--tw- is used by Tailwind. Choose another prefix."],
    [
      "brand",
      "A prefix starts with two dashes and uses only lowercase letters, numbers and dashes, like --brand-.",
    ],
  ])("refuses %s with the reason, and sends nothing", async (typed, reason) => {
    const user = userEvent.setup();
    draw();
    await user.clear(field());
    await user.type(field(), typed);
    expect(screen.getByRole("alert").textContent).toBe(reason);
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(changeButton().disabled).toBe(true);
    await user.type(field(), "{Enter}");
    expect(sent).toEqual([]);
  });

  it("shows a prefix the site's code sets, and says a prefix saved here replaces it", () => {
    draw({ current: "--acme-", code: "--acme-" });
    expect(field().value).toBe("--acme-");
    expect(
      screen.getByText(
        "Your site's code sets --acme-. A prefix saved here replaces it."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Your site's own CSS that uses --acme- names must change too."
      )
    ).toBeTruthy();
  });

  it("asks before a change, and changes it once confirmed", async () => {
    const user = userEvent.setup();
    draw();
    await user.clear(field());
    await user.type(field(), "--brand-");
    await user.click(changeButton());

    const question = await screen.findByRole("alertdialog");
    expect(question.textContent).toContain("Change the prefix to --brand-?");
    expect(question.textContent).toContain(
      "Your site's own CSS that uses --site- names must change too."
    );
    // No shadow names the old prefix, so the question says nothing of them.
    expect(question.textContent).not.toContain("shadow");
    // Only the dry run so far: nothing is saved before the confirmation.
    expect(sent).toEqual([{ prefix: "--brand-", dryRun: true }]);

    const confirm = screen
      .getAllByRole("button", { name: "Change prefix" })
      .find(button => question.contains(button));
    if (confirm === undefined) throw new Error("no confirm button");
    await user.click(confirm);
    await waitFor(() => expect(refreshStyle).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([
      { prefix: "--brand-", dryRun: true },
      { prefix: "--brand-" },
    ]);
    expect(reread).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("Saved");
  });

  it("says how many shadows lose their colour variable", async () => {
    const user = userEvent.setup();
    dryRunUses = { oldPrefixUses: 2, usesComplete: true };
    draw();
    await user.clear(field());
    await user.type(field(), "--brand-{Enter}");
    const question = await screen.findByRole("alertdialog");
    expect(question.textContent).toContain(
      "2 shadows use a colour variable through the old prefix. They lose that colour until you pick it again."
    );
  });

  it("calls a count the usage index could not finish a lower bound", async () => {
    const user = userEvent.setup();
    dryRunUses = { oldPrefixUses: 1, usesComplete: false };
    draw();
    await user.clear(field());
    await user.type(field(), "--brand-{Enter}");
    const question = await screen.findByRole("alertdialog");
    expect(question.textContent).toContain(
      "At least 1 shadow uses a colour variable through the old prefix."
    );
  });

  it("keeps the prefix when the question is declined", async () => {
    const user = userEvent.setup();
    draw();
    await user.clear(field());
    await user.type(field(), "--brand-");
    await user.click(changeButton());
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Keep --site-" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(sent).toEqual([{ prefix: "--brand-", dryRun: true }]);
    expect(refreshStyle).not.toHaveBeenCalled();
  });
});
