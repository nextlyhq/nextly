/**
 * The two cases every edit form's lock is held to, written once and declared
 * by each form's spec (`entry-lock`, `single-lock`), so each test is reported
 * under the spec that runs it.
 *
 * - A second editor finds the document read-only, names who holds it, and can
 *   ask for access, which the holder hears about at their next heartbeat.
 * - A takeover moves the document to the second editor, as stored; the first
 *   is told, keeps their unsaved edit on screen, read-only, and has it back,
 *   editable, when they take the document back.
 *
 * The Page Builder screen's own two cases are `builder-lock.spec.ts`: they
 * read a canvas rather than a field.
 */
import {
  expect,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

import { gotoAdmin } from "./admin";
import {
  claimedBy,
  expectHeldBy,
  SECOND_EDITOR,
  secondEditor,
  type LockedDocument,
} from "./two-editors";

/** One edit form, and a document on it with a known stored value. */
export interface LockedScreen {
  /**
   * Stores a value of the run's own in the field, and returns the document's
   * lock reference, its admin address and the value stored.
   */
  prepare(
    api: APIRequestContext
  ): Promise<{ document: LockedDocument; address: string; stored: string }>;
  /** The field the cases edit, on the screen's form. */
  field(page: Page): Locator;
}

/** What a case is run with: the test's first editor, browser and address. */
interface CaseContext {
  page: Page;
  browser: Browser;
  baseURL: string | undefined;
}

/**
 * A second editor finds the document read-only, names who holds it, and can
 * ask for access, which the holder hears about at their next heartbeat.
 */
export async function secondEditorFindsItHeld(
  screen: LockedScreen,
  { page, browser, baseURL }: CaseContext
): Promise<void> {
  const { document, address, stored } = await screen.prepare(page.request);
  await gotoAdmin(page, address);
  await expect(screen.field(page)).toHaveValue(stored, { timeout: 30_000 });
  await expect(screen.field(page)).toBeEditable();
  const holder = await claimedBy(page.request, document);

  const other = await secondEditor(browser, page, baseURL);
  try {
    await gotoAdmin(other.page, address);
    await expect(
      other.page.getByText(`${holder} is editing this document.`)
    ).toBeVisible({ timeout: 30_000 });
    // Read-only, and still the document: the value is there to read.
    await expect(screen.field(other.page)).toHaveValue(stored);
    await expect(screen.field(other.page)).not.toBeEditable();

    await other.page
      .getByRole("button", { name: "Request edit access" })
      .click();
    // The holder learns at its next heartbeat that someone is waiting.
    await expect(
      page.getByText("Someone is waiting to edit this document.")
    ).toBeVisible({ timeout: 45_000 });
    // Asking moved nothing: the holder still edits.
    await expect(screen.field(page)).toBeEditable();
  } finally {
    await other.context.close();
  }
}

/**
 * A takeover moves the document to the second editor, as stored; the first is
 * told, keeps their unsaved edit on screen, read-only, and has it back,
 * editable, when they take the document back.
 */
export async function takeoverKeepsUnsavedEdits(
  screen: LockedScreen,
  { page, browser, baseURL }: CaseContext
): Promise<void> {
  const { document, address, stored } = await screen.prepare(page.request);
  await gotoAdmin(page, address);
  await expect(screen.field(page)).toHaveValue(stored, { timeout: 30_000 });
  const first = await claimedBy(page.request, document);
  const unsaved = `${stored}, edited and not saved`;
  await screen.field(page).fill(unsaved);

  const other = await secondEditor(browser, page, baseURL);
  try {
    await gotoAdmin(other.page, address);
    await other.page.getByRole("button", { name: "Take over" }).click();
    // The new holder edits the document as stored: the first editor's edit
    // was never saved, so it is not theirs to see.
    await expect(screen.field(other.page)).toBeEditable({ timeout: 30_000 });
    await expect(screen.field(other.page)).toHaveValue(stored);
    // And the server agrees: the takeover is recorded, not only drawn.
    await expectHeldBy(page.request, document, SECOND_EDITOR);

    // The first editor is told, by name, and their edit is still in their
    // form, which no longer saves.
    await expect(
      page.getByText(
        `${SECOND_EDITOR} took over this document. Your unsaved changes are still here`
      )
    ).toBeVisible({ timeout: 45_000 });
    await expect(screen.field(page)).toHaveValue(unsaved);
    await expect(screen.field(page)).not.toBeEditable();

    // Taking it back gives them the form again, edit and all.
    await page.getByRole("button", { name: "Take it back" }).click();
    await expect(screen.field(page)).toBeEditable({ timeout: 30_000 });
    await expect(screen.field(page)).toHaveValue(unsaved);
    await expectHeldBy(page.request, document, first);
  } finally {
    await other.context.close();
  }
}
