// @vitest-environment jsdom
/**
 * Importing from a file above a list: the preview the server's dry run gives,
 * an import that cannot be confirmed while the site lacks a block or a
 * breakpoint waits for a choice, each choice asked of the server again, and a
 * stale preview that is refused and asked for again before anything is done.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ImportPreview,
  ImportRequest,
  TransferFile,
} from "../transfer/transfer-contract";

const sent: ImportRequest[] = [];
let answer: (body: ImportRequest) => Promise<unknown> = async () => ({});
const navigated: string[] = [];

class FakeApiError extends Error {
  constructor(readonly status: number) {
    super(`status ${String(status)}`);
  }
}

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  writePluginRoute: async ({ body }: { body: ImportRequest }) => {
    sent.push(body);
    return answer(body);
  },
  isApiError: (error: unknown) => error instanceof FakeApiError,
  navigateTo: (path: string) => navigated.push(path),
  apiErrorMessage: (error: Error, fallback: string) =>
    error.message || fallback,
  validationIssues: () => [],
  usePluginRouteMutation: () => ({
    write: vi.fn(),
    pending: false,
    error: null,
  }),
}));

const { TransferImport } = await import("./transfer-import");

// jsdom's File has no `text()`; a browser's does.
if (typeof Blob.prototype.text !== "function") {
  Blob.prototype.text = function text(this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
      reader.readAsText(this);
    });
  };
}

const FILE: TransferFile = {
  format: "nextly-page-builder-transfer",
  formatVersion: 1,
  exportedAt: "2026-11-03T00:00:00.000Z",
  root: { kind: "pattern", id: "p" },
  components: [],
  patterns: [
    {
      id: "p",
      title: "Hero",
      slug: "hero",
      status: "published",
      granularity: "section",
      content: { formatVersion: 1, kind: "pattern", nodes: [] },
    },
  ],
  layouts: [],
  classes: [],
  tokens: [],
  breakpoints: [],
  media: [],
  blockTypes: [],
};

function preview(overrides: Partial<ImportPreview> = {}): ImportPreview {
  return {
    root: { kind: "pattern", title: "Hero" },
    added: [{ kind: "pattern", fileId: "p", name: "Hero" }],
    reused: [],
    conflicts: [],
    breakpoints: { matched: [], unmatched: [] },
    missingBlockTypes: [],
    problems: [],
    ready: true,
    fingerprint: "f1",
    ...overrides,
  };
}

const envelope = (item: ImportPreview, rootId?: string) => ({
  message: "",
  item: {
    dryRun: rootId === undefined,
    preview: item,
    ...(rootId === undefined ? {} : { rootId }),
  },
});

async function choose(file: TransferFile = FILE): Promise<void> {
  render(<TransferImport />);
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file input");
  await userEvent.upload(
    input,
    new File([JSON.stringify(file)], "hero.pattern.nextly.json", {
      type: "application/json",
    })
  );
  await screen.findByRole("dialog");
}

beforeEach(() => {
  sent.length = 0;
  navigated.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("TransferImport", () => {
  it("previews the file through a dry run and imports what was previewed", async () => {
    answer = async body =>
      envelope(preview(), body.dryRun === true ? undefined : "new-id");
    await choose();

    expect(await screen.findByText("Hero", { selector: "dd" })).toBeTruthy();
    expect(sent[0]).toMatchObject({ file: FILE, dryRun: true });
    const importButton = screen.getByRole("button", { name: "Import" });
    await waitFor(() =>
      expect((importButton as HTMLButtonElement).disabled).toBe(false)
    );

    await userEvent.click(importButton);

    await waitFor(() =>
      expect(navigated).toEqual(["/admin/collections/patterns/new-id"])
    );
    expect(sent.at(-1)).toEqual({ file: FILE, choices: {}, expect: "f1" });
  });

  it("shows a variable by its name, its path beside", async () => {
    answer = async () =>
      envelope(
        preview({
          added: [
            {
              kind: "token",
              fileId: "color.accent",
              name: "Accent",
              detail: "color.accent",
            },
          ],
        })
      );
    await choose();

    expect(await screen.findByText("Accent")).toBeTruthy();
    expect(screen.getByText("color.accent").className).toContain(
      "nx-pb-transfer__detail"
    );
  });

  it("lists the block types the site lacks and cannot be confirmed", async () => {
    answer = async () =>
      envelope(preview({ missingBlockTypes: ["acme/widget"], ready: false }));
    await choose();

    expect(await screen.findByText("acme/widget")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Import" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Import from file" })
      )
    );
  });

  it("waits for a breakpoint choice, asks the server again with it, and never offers what is not allowed", async () => {
    const unmatched = {
      fileId: "phone",
      label: "Phone",
      axis: "viewport" as const,
      maxWidth: 479,
      styles: 2,
      hides: 1,
      mayAdd: false,
      whyNotAdd: "Adding a breakpoint needs the right to manage site settings.",
    };
    answer = async body => {
      const choice = body.choices?.breakpoints?.phone;
      return envelope(
        preview({
          breakpoints: {
            matched: [],
            unmatched: [
              { ...unmatched, ...(choice === undefined ? {} : { choice }) },
            ],
          },
          ready: choice !== undefined,
          fingerprint: choice === undefined ? "f1" : "f2",
        })
      );
    };
    await choose();

    expect(
      await screen.findByText("Used by 2 styles and 1 hide setting")
    ).toBeTruthy();
    expect(screen.getByText(unmatched.whyNotAdd)).toBeTruthy();
    expect(
      (
        screen.getByRole("radio", {
          name: "Add to this site",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Import" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    let held: () => void = () => undefined;
    const answering = answer;
    answer = body =>
      new Promise(resolve => {
        held = () => resolve(answering(body));
      });
    await userEvent.click(
      screen.getByRole("radio", { name: "Drop its styles and hide settings" })
    );
    // Shown chosen at once, before the server has answered again.
    expect(
      screen
        .getByRole("radio", { name: "Drop its styles and hide settings" })
        .getAttribute("aria-checked")
    ).toBe("true");
    await waitFor(() => expect(sent).toHaveLength(2));
    held();

    await waitFor(() =>
      expect(sent.at(-1)).toEqual({
        file: FILE,
        choices: { breakpoints: { phone: "drop" } },
        dryRun: true,
      })
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Import" }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    );
  });

  it("says the site changed and asks for the preview again when the import is refused as stale", async () => {
    let previews = 0;
    answer = async body => {
      if (body.dryRun !== true) throw new FakeApiError(409);
      previews += 1;
      return envelope(preview({ fingerprint: `f${String(previews)}` }));
    };
    await choose();
    const importButton = screen.getByRole("button", { name: "Import" });
    await waitFor(() =>
      expect((importButton as HTMLButtonElement).disabled).toBe(false)
    );

    await userEvent.click(importButton);

    expect(
      await screen.findByText("This site changed since the preview")
    ).toBeTruthy();
    await waitFor(() => expect(previews).toBe(2));
    expect(navigated).toEqual([]);
  });

  it("refuses a file with the export's marker but not its lists, without asking the server", async () => {
    render(<TransferImport />);
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("no file input");
    const damaged = { ...FILE, components: "not a list" };
    await userEvent.upload(
      input,
      new File([JSON.stringify(damaged)], "damaged.json", {
        type: "application/json",
      })
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent).toEqual([]);
  });

  it("refuses a file that is not an export without asking the server", async () => {
    render(<TransferImport />);
    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("no file input");
    await userEvent.upload(
      input,
      new File(["{}"], "other.json", { type: "application/json" })
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent).toEqual([]);
  });
});
