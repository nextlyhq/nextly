// @vitest-environment jsdom

/**
 * The Connections tab's "Prove you own the site" card as a person uses it: a
 * code typed or pasted saves as the code alone; a whole tag or a DNS record
 * gives up its code and the box says so; another service's tag offers to
 * move it; markup, a file name or a name Nextly writes itself is refused and
 * holds the save up with the reason beside Save; other services save as a
 * name and a code. Once saved, the box says whether the live home page
 * carries the code. What each save sends is read from the save itself.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  useSingleDocument: vi.fn(),
  useUpdateSingleDocument: vi.fn(),
  usePluginRoute: vi.fn(),
  useMediaItem: vi.fn(() => ({ data: undefined })),
  MediaPickerDialog: () => null,
  toastMutationResult: vi.fn(),
  usePluginClientConfig: vi.fn(() => undefined),
  writePluginRoute: vi.fn(),
  // A move within the admin, as the admin makes it: the address changes and
  // the move is announced.
  navigateTo: vi.fn((href: string) => {
    window.history.pushState(null, "", href);
    window.dispatchEvent(new Event("locationchange"));
  }),
}));

import {
  usePluginRoute,
  useSingleDocument,
  useUpdateSingleDocument,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";

import type { ConnectionsBody } from "../../connections/contract";
import type { VerificationCheckBody } from "../../settings/verification";

import { SeoSettingsPage } from "../SeoSettingsPage";

/** The stored Single, as the fake server holds it between saves. */
let stored: Record<string, unknown>;
/** Every body a save sent, in order. */
let sent: Record<string, unknown>[];
let connections: ConnectionsBody;
let report: undefined;
let rereads: number;

function serving(
  document: Record<string, unknown>,
  state: ConnectionsBody = {
    searchConsole: { configured: true },
    indexNow: {},
  }
): void {
  connections = state;
  report = undefined;
  rereads = 0;
  stored = { id: "s1", updatedAt: "", setupStep: 3, ...document };
  sent = [];
  const refetch = vi.fn(async () => ({ data: stored }));
  vi.mocked(useSingleDocument).mockImplementation(
    () =>
      ({ data: stored, error: null, refetch }) as unknown as ReturnType<
        typeof useSingleDocument
      >
  );
  vi.mocked(useUpdateSingleDocument).mockImplementation(
    () =>
      ({
        mutateAsync: vi.fn(async (body: Record<string, unknown>) => {
          sent.push(body);
          const { _rev: _read, _overwrite: _replace, ...values } = body;
          const revision = Number(stored._rev ?? 0) + 1;
          stored = { ...stored, ...values, _rev: String(revision) };
          return stored;
        }),
      }) as unknown as ReturnType<typeof useUpdateSingleDocument>
  );
  vi.mocked(usePluginRoute).mockImplementation(
    request =>
      ({
        data: request.path.endsWith("/document")
          ? { single: "seo-settings" }
          : request.path === "/connections"
            ? connections
            : request.path.endsWith("/report")
              ? report
              : { items: [] },
        pending: false,
        error: null,
        refetch: () => {
          rereads += 1;
        },
        fetching: false,
      }) as ReturnType<typeof usePluginRoute>
  );
}

/** Waits for every pending save and the re-read after it. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  window.history.replaceState(
    null,
    "",
    "/admin/plugins/nextlyhq-plugin-seo/settings"
  );
});

/** Opens one of the screen's tabs by its link. */
const openTab = (name: string) =>
  fireEvent.click(screen.getByRole("link", { name }));

const BING = "8A2F61C4D0E9B7A35F0C19D2E6B4A7C9";
const box = (name: string) =>
  screen.getByRole("textbox", { name: `${name} verification code` });
const type = (element: HTMLElement, value: string) =>
  fireEvent.change(element, { target: { value } });
const saveButton = () =>
  screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement;

/** What the live check answers, unless a test says otherwise. */
let checked: VerificationCheckBody | undefined;
let checks: number;

beforeEach(() => {
  checked = undefined;
  checks = 0;
  vi.mocked(writePluginRoute).mockImplementation((async () => {
    checks += 1;
    return checked;
  }) as typeof writePluginRoute);
});

/**
 * Each test's settings as a document of their own: an unsaved draft is kept
 * for the document it was made on, so one test's edits never reach the next.
 */
let version = 100;

function openConnections(document: Record<string, unknown> = {}): void {
  version += 1;
  serving({
    id: `s${version}`,
    _rev: String(version),
    productionAddresses: ["https://nextlyhq.com"],
    ...document,
  });
  render(<SeoSettingsPage />);
  openTab("Connections");
}

describe("the verification codes", () => {
  it("lists each service with the meta name it reads, and says where codes go", () => {
    openConnections();
    expect(
      screen.getByRole("heading", { name: "Prove you own the site" })
    ).toBeTruthy();
    for (const name of [
      "google-site-verification",
      "msvalidate.01",
      "p:domain_verify",
      "yandex-verification",
      "baidu-site-verification",
    ]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(
      screen.getByText(
        /Saved codes go into the head of your home page, nextlyhq\.com\./
      )
    ).toBeTruthy();
  });

  it("saves a pasted code as the code alone", async () => {
    openConnections();
    type(box("Bing"), `  ${BING} `);
    fireEvent.click(saveButton());
    await settle();
    expect(sent).toEqual([
      { verificationCodes: { bing: BING }, _rev: String(version) },
    ]);
  });

  it("keeps only the code of a pasted tag, and says so", async () => {
    openConnections();
    type(box("Bing"), `<meta name="msvalidate.01" content="${BING}" />`);
    expect((box("Bing") as HTMLInputElement).value).toBe(BING);
    expect(
      screen.getByText("Took the code from the tag you pasted.")
    ).toBeTruthy();
    fireEvent.click(saveButton());
    await settle();
    expect(sent).toEqual([
      { verificationCodes: { bing: BING }, _rev: String(version) },
    ]);
  });

  it("takes the code from a DNS record, and says so", () => {
    openConnections();
    type(box("Google"), "google-site-verification=Kq3v9X_ab12CdEf34");
    expect((box("Google") as HTMLInputElement).value).toBe("Kq3v9X_ab12CdEf34");
    expect(
      screen.getByText("That was the DNS form. Took the code after the = sign.")
    ).toBeTruthy();
  });

  it("offers to move another service's tag to its own box", async () => {
    openConnections();
    type(box("Google"), `<meta name="msvalidate.01" content="${BING}">`);
    expect(screen.getByText("That's Bing's tag.")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText("Fix the Google code first.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Move it to Bing" }));
    expect((box("Google") as HTMLInputElement).value).toBe("");
    expect((box("Bing") as HTMLInputElement).value).toBe(BING);
    fireEvent.click(saveButton());
    await settle();
    expect(sent).toEqual([
      { verificationCodes: { bing: BING }, _rev: String(version) },
    ]);
  });

  it("refuses a script, and holds the save up", () => {
    openConnections();
    type(box("Pinterest"), '<script src="https://s.pinimg.com/ct/core.js">');
    expect(
      screen.getByText(
        "Only a code or a <meta> tag can go here. Scripts and other HTML are refused."
      )
    ).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText("Fix the Pinterest code first.")).toBeTruthy();
  });

  it("refuses a file name, saying which way to verify to choose", () => {
    openConnections();
    type(box("Yandex"), "yandex_6f1c2a9b8e7d4c30.html");
    expect(
      screen.getByText(
        'That\'s a file name. This box takes the meta tag: choose "Meta tag" on Yandex and paste what it shows.'
      )
    ).toBeTruthy();
  });

  it("saves another service's tag as its name and code, from a pasted tag", async () => {
    openConnections();
    type(
      screen.getByRole("textbox", { name: "Other service 1: code" }),
      '<meta name="facebook-domain-verification" content="q3x9k2m8a7c1v5b0n4" />'
    );
    expect(
      (
        screen.getByRole("textbox", {
          name: "Other service 1: name",
        }) as HTMLInputElement
      ).value
    ).toBe("facebook-domain-verification");
    fireEvent.click(saveButton());
    await settle();
    expect(sent).toEqual([
      {
        verificationCodes: {
          others: [
            {
              name: "facebook-domain-verification",
              code: "q3x9k2m8a7c1v5b0n4",
            },
          ],
        },
        _rev: String(version),
      },
    ]);
  });

  it("refuses a name Nextly writes itself, and a tag with no code", () => {
    openConnections();
    type(
      screen.getByRole("textbox", { name: "Other service 1: name" }),
      "description"
    );
    type(
      screen.getByRole("textbox", { name: "Other service 1: code" }),
      "Our site"
    );
    expect(
      screen.getByText(
        "Nextly already writes the description tag. This box is for verification tags only."
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a tag" }));
    type(
      screen.getByRole("textbox", { name: "Other service 2: name" }),
      "norton-safeweb-site-verification"
    );
    expect(screen.getByText("A tag needs a name and a code.")).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    expect(
      screen.getByText("Fix the other services' tags first.")
    ).toBeTruthy();
  });

  it("clears a saved code when its box is emptied", async () => {
    openConnections({ verificationCodes: { bing: BING } });
    expect((box("Bing") as HTMLInputElement).value).toBe(BING);
    type(box("Bing"), "");
    fireEvent.click(saveButton());
    await settle();
    expect(sent).toEqual([{ verificationCodes: null, _rev: String(version) }]);
  });

  it("opens with every box empty for settings saved before codes existed", () => {
    openConnections({ verificationCodes: undefined });
    expect((box("Google") as HTMLInputElement).value).toBe("");
    expect(saveButton().disabled).toBe(true);
    expect(checks).toBe(0);
  });
});

describe("the live home page", () => {
  it("says a saved code is on the live home page", async () => {
    checked = {
      checkedAt: "2026-11-13T14:02:00.000Z",
      homePages: [{ address: "https://nextlyhq.com", read: true }],
      tags: [{ name: "msvalidate.01", foundAt: ["https://nextlyhq.com"] }],
    };
    openConnections({ verificationCodes: { bing: BING } });
    await settle();
    expect(checks).toBe(1);
    expect(
      screen.getByText(
        /Found on the live home page at .*\. Now press Verify in Bing Webmaster Tools\./
      )
    ).toBeTruthy();
  });

  it("says a saved code is not there yet, and checks again when asked", async () => {
    checked = {
      checkedAt: "2026-11-13T14:02:00.000Z",
      homePages: [{ address: "https://nextlyhq.com", read: true }],
      tags: [{ name: "p:domain_verify", foundAt: [] }],
    };
    openConnections({ verificationCodes: { pinterest: "a91c7e04b2d35f68" } });
    await settle();
    expect(
      screen.getByText(
        /Not on the live home page yet\. If pages are cached, it shows after the next deploy or cache refresh\./
      )
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await settle();
    expect(checks).toBe(2);
  });

  it("checks after a save that changes the codes, not before", async () => {
    openConnections();
    type(box("Bing"), BING);
    await settle();
    expect(checks).toBe(0);
    fireEvent.click(saveButton());
    await settle();
    expect(checks).toBe(1);
  });
});

describe("after a pasted tag is saved", () => {
  it("shows the live home page's answer, not the note about the paste", async () => {
    checked = {
      checkedAt: "2026-11-13T14:02:00.000Z",
      homePages: [{ address: "https://nextlyhq.com", read: true }],
      tags: [{ name: "msvalidate.01", foundAt: ["https://nextlyhq.com"] }],
    };
    openConnections();
    type(box("Bing"), `<meta name="msvalidate.01" content="${BING}" />`);
    expect(
      screen.getByText("Took the code from the tag you pasted.")
    ).toBeTruthy();
    fireEvent.click(saveButton());
    await settle();
    expect(
      screen.queryByText("Took the code from the tag you pasted.")
    ).toBeNull();
    expect(
      screen.getByText(
        /Found on the live home page at .*\. Now press Verify in Bing Webmaster Tools\./
      )
    ).toBeTruthy();
  });
});

describe("a full Other services", () => {
  const full = Array.from({ length: 20 }, (_, index) => ({
    name: `service-${index}-verification`,
    code: `code${index}`,
  }));

  it("offers no move of another tag there, and says why", () => {
    openConnections({ verificationCodes: { others: full } });
    type(
      box("Google"),
      '<meta name="facebook-domain-verification" content="q3x9k2m8a7c1v5b0n4" />'
    );
    expect(
      screen.queryByRole("button", { name: "Move it to Other services" })
    ).toBeNull();
    expect(
      screen.getByText(/Other services already holds 20 tags/)
    ).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });
});

describe("a database not migrated for the new settings", () => {
  it("says what to run, in plain words, instead of the raw error", () => {
    serving({});
    const notMigrated = Object.assign(
      new Error(
        'The database has not been migrated for the field "verificationCodes" of the Single "seo-settings". Run `nextly migrate`.'
      ),
      { status: 409, code: "ENTITY_NOT_MIGRATED" }
    );
    vi.mocked(useSingleDocument).mockImplementation(
      () =>
        ({
          data: undefined,
          error: notMigrated,
          refetch: vi.fn(),
        }) as unknown as ReturnType<typeof useSingleDocument>
    );
    render(<SeoSettingsPage />);
    expect(
      screen.getByText(
        /The database needs `nextly migrate` for the new SEO settings\./
      )
    ).toBeTruthy();
    expect(
      screen.queryByText(/has not been migrated for the field/)
    ).toBeNull();
  });
});
