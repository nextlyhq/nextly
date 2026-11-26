/**
 * The publish dialog sends the version its description was made from, so it publishes what it
 * described or nothing: a part changed since is refused, described again and named, and published
 * only once it is confirmed again.
 *
 * The plausible broken dialogs: one that sends a version read as it is confirmed, which puts the
 * change live under the older description; one that sends the refused publish again by itself; and
 * one that says the document changed without saying where.
 */
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";
import { parseApiError } from "@admin/lib/api/parseApiError";
import type {
  PublishPartsChoice,
  PublishPartsResult,
} from "@admin/services/publishParts";

import { PublishPartsDialog } from "../PublishPartsDialog";

import { pressConfirm } from "./press-confirm";

const api = vi.hoisted(() => ({
  publishParts: vi.fn(),
  findByID: vi.fn(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      publishParts: api.publishParts,
      findByID: api.findByID,
    },
  };
});

const LANGUAGES = ["en", "es", "ar"];
const labelOf = (code: string) =>
  ({ en: "English", es: "Spanish", ar: "Arabic" })[code] ?? code;

/** The document as the server holds it: a counter of its own, and one a language. */
let stored = { main: 7, languages: { en: 1, es: 1, ar: 1 } };

const versionOf = (locales: readonly string[]) =>
  `${stored.main}.${locales
    .map(
      code =>
        `${code}:${stored.languages[code as keyof typeof stored.languages]}`
    )
    .join(",")}`;

/** Whether `version` names the document and each of `locales` as stored, whatever else it names. */
function isCurrent(
  version: PublishPartsChoice["version"],
  locales: readonly string[]
): boolean {
  if (typeof version !== "string") return false;
  const [main, languages = ""] = version.split(".");
  const named = languages.split(",");
  return (
    main === String(stored.main) &&
    locales.every(code => named.includes(versionOf([code]).split(".")[1] ?? ""))
  );
}

/** The route: described as stored, and moved only from the version stored. */
function route(choice: PublishPartsChoice): Promise<PublishPartsResult> {
  const locales = choice.locales === "all" ? LANGUAGES : choice.locales;
  const counterOf = (code: string) =>
    String(stored.languages[code as keyof typeof stored.languages]);
  if (choice.describe !== true && !isCurrent(choice.version, locales)) {
    return Promise.reject(
      parseApiError(
        {
          error: {
            code: "STALE_VERSION",
            message: "This document changed since you opened it.",
            requestId: "r1",
            data: { currentVersion: versionOf(locales) },
          },
        },
        409
      )
    );
  }
  return Promise.resolve({
    id: "post-1",
    languages: locales.map(locale => ({ locale, outcome: "goes-live" })),
    shared: { changes: false, added: false },
    ...(choice.describe === true
      ? {
          _rev: versionOf(locales),
          marks: {
            languages: Object.fromEntries(
              locales.map(code => [code, counterOf(code)])
            ),
            rest: LANGUAGES.filter(code => !locales.includes(code))
              .map(counterOf)
              .join(),
          },
        }
      : {}),
  });
}

/** What the dialog moved, in order: the version each was sent with. */
const sent = () =>
  (
    api.publishParts.mock.calls as [
      string,
      string,
      string,
      PublishPartsChoice,
    ][]
  )
    .map(([, , , choice]) => choice)
    .filter(choice => choice.describe !== true)
    .map(choice => choice.version);

function open(over: Partial<ComponentProps<typeof PublishPartsDialog>> = {}) {
  return render(
    <PublishPartsDialog
      open
      onOpenChange={() => undefined}
      target={{ kind: "collection", slug: "posts", id: "post-1" }}
      direction="publish"
      languages={LANGUAGES}
      labelOf={labelOf}
      initialChoice={{ locales: ["en", "es"], shared: false }}
      currentLocale="en"
      {...over}
    />
  );
}

const confirm = () => screen.getByRole("button", { name: "Publish selected" });
const described = () =>
  screen.findByText("Goes live for the first time: readers of Spanish see it.");

beforeEach(() => {
  stored = { main: 7, languages: { en: 1, es: 1, ar: 1 } };
  api.publishParts.mockReset();
  api.publishParts.mockImplementation(
    (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
      route(choice)
  );
  // A read of every language, whose version is always the one stored by then.
  api.findByID.mockReset();
  api.findByID.mockImplementation(() =>
    Promise.resolve({ id: "post-1", _rev: versionOf(LANGUAGES) })
  );
});

describe("a publish of what was described", () => {
  it("goes through with one confirmation where nothing changed, from the version described", async () => {
    const onOpenChange = vi.fn();
    open({ onOpenChange });
    await described();
    await pressConfirm(confirm());

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sent()).toEqual(["7.en:1,es:1"]);
    // Nothing is read to find a version to send.
    expect(api.findByID).not.toHaveBeenCalled();
  });

  it("is refused where a chosen part changed, names it, and publishes only once confirmed again", async () => {
    const onOpenChange = vi.fn();
    open({ onOpenChange });
    await described();
    stored.languages.es = 2;
    await pressConfirm(confirm());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Spanish changed since this was shown. Check what each part does now, then publish again."
    );
    // Refused once, and not sent again by itself.
    expect(sent()).toEqual(["7.en:1,es:1"]);
    expect(onOpenChange).not.toHaveBeenCalled();

    await pressConfirm(confirm());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(sent()).toEqual(["7.en:1,es:1", "7.en:1,es:2"]);
  });

  it("says it was something else where only a part not chosen changed", async () => {
    open();
    await described();
    // A draft held in Arabic moves the document's own counter too.
    stored.main = 8;
    stored.languages.ar = 2;
    await pressConfirm(confirm());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^Something else in this document changed since this was shown\./
    );
  });

  it("no longer says what changed once the choice is another", async () => {
    open();
    await described();
    stored.languages.es = 2;
    await pressConfirm(confirm());
    await screen.findByText(/^Spanish changed since/);

    await userEvent.click(screen.getByRole("checkbox", { name: "English" }));
    await waitFor(() =>
      expect(screen.queryByText(/changed since this was shown/)).toBeNull()
    );
  });

  it("is refused from an editor whose language changed before the parts were described, and says so", async () => {
    // Opened at version 6; saved since, and described as it is now.
    api.findByID.mockResolvedValue({ id: "post-1", _rev: "7.en:1" });
    open({ shown: () => ({ version: "6.en:1", locale: "en", draft: true }) });
    await described();
    await pressConfirm(confirm());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This document changed since you opened it. Review the latest version, then try again."
    );
    expect(sent()).toEqual([]);
  });
});
