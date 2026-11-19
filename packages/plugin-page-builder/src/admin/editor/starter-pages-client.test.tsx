// @vitest-environment jsdom
/**
 * The empty page's starter row in the editor: a starter the site can't use
 * reaches the start area with its reason, is never applied, and is said in
 * the editor's notices; a starter whose copy the editor refuses is said the
 * same way rather than doing nothing in silence.
 */
import type { PageInsertersProps, StarterPage } from "@nextlyhq/builder/shell";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NewPageStarter } from "../../pages-write-contract";

let listed: readonly NewPageStarter[] = [];
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  readPluginRoute: async () => ({ items: listed }),
}));

/** What the start area was last handed, for the row's starters. */
let drawn: readonly StarterPage[] = [];
const applyStarterPage = vi.fn<(...args: unknown[]) => boolean>();
// The start area itself is the builder's, tested beside it; here it is a row
// of tiles that report the press, as the real one does for a usable starter.
vi.mock("@nextlyhq/builder/shell", () => ({
  applyStarterPage: (...args: unknown[]) => applyStarterPage(...args),
  DocumentMiniature: (): JSX.Element => <span />,
  PageInserters: ({ start }: PageInsertersProps): JSX.Element => {
    drawn = start.starters ?? [];
    return (
      <div>
        {drawn.map(starter => (
          <button
            key={starter.id}
            type="button"
            onClick={() => start.onStarter?.(starter.id)}
          >
            {starter.title}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock("./section-pictures", () => ({
  usePictureRender: () => () => null,
}));

const { EditorPageInserters } = await import("./starter-pages-client");

/** A starter as the read lists it: its blocks are one Heading. */
function starter(
  id: string,
  label: string,
  unavailable?: string
): NewPageStarter {
  return {
    id,
    label,
    description: `${label}, in a few blocks.`,
    document: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: `${id}-title`,
          type: "core/heading",
          version: 1,
          props: { text: label, level: 1 },
        },
      ],
    },
    ...(unavailable === undefined
      ? {}
      : { unavailable: { reason: unavailable } }),
  };
}

const REASON = "Uses the Form block, which this site doesn't have.";
const raise = vi.fn<(message: string) => void>();

/** The editor on an empty page, with the notices queue it raises into. */
async function mount(): Promise<void> {
  render(
    <EditorPageInserters
      view={{
        editor: {
          document: { formatVersion: 1, kind: "page", nodes: [] },
          applyAll: () => null,
        },
        canvasSiteStyle: undefined,
        componentLibrary: { definitions: {} },
        previewMode: undefined,
        pictureSession: undefined,
        notices: { raise },
      }}
      document={{ formatVersion: 1, kind: "page", nodes: [] }}
      selectedId={null}
      onAddAfter={() => undefined}
      start={{ onStart: () => undefined }}
    />
  );
  await act(async () => undefined);
}

beforeEach(() => {
  listed = [
    starter("landing", "Landing"),
    starter("contact", "Contact", REASON),
  ];
  drawn = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the editor's starter row", () => {
  it("hands the start area a starter's reason, and says it rather than applying it", async () => {
    await mount();
    expect(drawn.map(({ id, unavailable }) => ({ id, unavailable }))).toEqual([
      { id: "landing", unavailable: undefined },
      { id: "contact", unavailable: REASON },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Contact" }));
    expect(applyStarterPage).not.toHaveBeenCalled();
    expect(raise).toHaveBeenCalledWith(
      `The starter page "Contact" isn't available on this site. ${REASON}`
    );
  });

  it("says a starter whose copy the editor refuses, without a reason it doesn't know", async () => {
    applyStarterPage.mockReturnValue(false);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Landing" }));
    expect(applyStarterPage).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith(
      `The starter page "Landing" isn't available on this site.`
    );
  });

  it("says nothing when the starter is applied", async () => {
    applyStarterPage.mockReturnValue(true);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Landing" }));
    expect(applyStarterPage).toHaveBeenCalledTimes(1);
    expect(raise).not.toHaveBeenCalled();
  });
});
