/**
 * The review workflow's people, documents and steps, for the workflow specs.
 *
 * Every spec works on the playground's `reviewed-notes` collection, which the
 * preset `review` workflow holds (Drafting → In review → Approved; approving
 * and asking for changes need `approve-reviewed-notes`; an edit to approved
 * content goes back to In review). It is registered only for the e2e run, by
 * the fixture switch the suite's config sets.
 *
 * Each person is a role holding exactly the permissions their part in the
 * workflow needs, and a user holding that role, signed into a browser of
 * their own (`./limited-user`). The file's own account, a super-admin, only
 * seeds: it holds every step, so nothing it does could be refused.
 *
 * Documents and steps are written through the same REST routes the editor
 * uses, each document under a stamp of its own, so a spec reads back exactly
 * what it wrote.
 *
 * @module e2e/tests/support/workflow
 */
import {
  expect,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

import { gotoAdmin, type Theme } from "./admin";
import { expectNoAxeViolations } from "./axe";
import { signInWithRoles } from "./limited-user";
import type { Requester } from "./releases-api";

const API = "/admin/api";

/** The collection the review workflow holds in the playground. */
export const REVIEWED_NOTES = "reviewed-notes";

/** Its entries' REST address. */
export const NOTES = `${API}/collections/${REVIEWED_NOTES}/entries`;

/** The preset workflow's slug, whose settings the reset below clears. */
const REVIEW_WORKFLOW = "review";

/**
 * Who does what in the workflow, by the permissions they hold:
 *
 * - a writer creates and changes notes, and submits them (submitting needs
 *   update);
 * - a reviewer may also approve, or ask for changes;
 * - a read-and-approve reviewer may approve but never change the content;
 * - a publisher may change and publish a note, but not approve one;
 * - an emergency publisher may also publish past the workflow, with a reason.
 */
export const PEOPLE = {
  writer: [
    "read-reviewed-notes",
    "create-reviewed-notes",
    "update-reviewed-notes",
  ],
  reviewer: [
    "read-reviewed-notes",
    "update-reviewed-notes",
    "approve-reviewed-notes",
  ],
  readAndApprove: ["read-reviewed-notes", "approve-reviewed-notes"],
  publisher: [
    "read-reviewed-notes",
    "update-reviewed-notes",
    "publish-reviewed-notes",
  ],
  emergency: [
    "read-reviewed-notes",
    "update-reviewed-notes",
    "publish-reviewed-notes",
    "publish-without-review-reviewed-notes",
  ],
} as const satisfies Record<string, readonly string[]>;

export type Person = keyof typeof PEOPLE;

/** A person signed into a browser of their own, with a page open in it. */
export interface SignedInPerson {
  page: Page;
  /** Their own session's requests, for a step taken as them. */
  request: APIRequestContext;
  close: () => Promise<void>;
}

/**
 * Signs `who` in, as a user holding one role with exactly their permissions.
 * Signing in spends auth attempts, so a spec signs each person in once.
 */
export async function signInAs(
  browser: Browser,
  admin: APIRequestContext,
  baseURL: string,
  who: Person
): Promise<SignedInPerson> {
  const { context } = await signInWithRoles(browser, admin, baseURL, [
    PEOPLE[who],
  ]);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  return { page, request: context.request, close: () => context.close() };
}

/** A new reviewed note, by its id; it starts in Drafting. */
export async function reviewedNote(
  by: Requester,
  stamp: string,
  data: { summary?: string } = {}
): Promise<string> {
  const created = await by.request.post(NOTES, {
    data: {
      title: `Workflow note ${stamp}`,
      summary: data.summary ?? `What changes for readers, ${stamp}.`,
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const { item } = (await created.json()) as { item: { id: string } };
  return String(item.id);
}

/** One part of a document's review state, as `GET /workflows/review-state` answers it. */
export interface PartState {
  part: string | null;
  stage: string | null;
  stageLabel: string | null;
  publishable: boolean;
  revision: number;
  version: string | null;
  approval: { versionNo: number } | null;
}

/**
 * The note's shared part as the review state reads it now: a note is not
 * translated, so the shared part is its only one.
 */
export async function sharedPartOf(
  by: Requester,
  id: string,
  collection: string = REVIEWED_NOTES
): Promise<PartState> {
  const search = new URLSearchParams({ collection, id });
  const read = await by.request.get(
    `${API}/workflows/review-state?${search.toString()}`
  );
  expect(read.ok(), await read.text()).toBe(true);
  const { parts } = (await read.json()) as { parts: PartState[] };
  const shared = parts.find(part => part.part === null);
  if (shared === undefined) {
    throw new Error(`[e2e] No shared part in the review state of ${id}.`);
  }
  return shared;
}

/**
 * Takes `step` on the note's shared part as `by`, sent with the revision and
 * version it reads now, as the editor sends what it showed.
 */
export async function step(
  by: Requester,
  id: string,
  name: "submit" | "approve" | "requestChanges",
  comment?: string
): Promise<void> {
  const part = await sharedPartOf(by, id);
  expect(part.version, `the note ${id} has a saved version`).not.toBeNull();
  const taken = await by.request.post(`${API}/workflows/steps`, {
    data: {
      document: { collection: REVIEWED_NOTES, id },
      step: name,
      parts: [null],
      seen: [{ part: null, revision: part.revision, version: part.version }],
      ...(comment === undefined ? {} : { comment }),
    },
  });
  expect(taken.ok(), await taken.text()).toBe(true);
}

/** Polls the note's shared part until it stands in `stage`, for a step the browser took. */
export async function expectStage(
  by: Requester,
  id: string,
  stage: string | null
): Promise<void> {
  await expect
    .poll(async () => (await sharedPartOf(by, id)).stage, {
      message: `the note ${id} stands in ${String(stage)}`,
      timeout: 15_000,
    })
    .toBe(stage);
}

/**
 * Clears the review workflow's default reviewers and its stage labels, which
 * the Settings › Workflows screen changes: "waiting for …" and every stage's
 * name follow them, and these specs assert both. Called under
 * `LOCK.reviewWorkflow`, which every spec writing them holds.
 */
export async function resetReviewSettings(admin: Requester): Promise<void> {
  const address = `${API}/workflows/${REVIEW_WORKFLOW}/settings`;
  const read = await admin.request.get(address);
  expect(read.ok(), await read.text()).toBe(true);
  const settings = (await read.json()) as {
    revision: number;
    defaultReviewers: Record<string, unknown>;
    labels: Record<string, unknown>;
  };
  const cleared = (names: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(names).map(name => [name, null]));
  const defaultReviewers = cleared(settings.defaultReviewers);
  const labels = cleared(settings.labels);
  // Nothing set: nothing to write, and no revision spent.
  if (
    Object.keys(defaultReviewers).length === 0 &&
    Object.keys(labels).length === 0
  ) {
    return;
  }
  const saved = await admin.request.patch(address, {
    data: { revision: settings.revision, defaultReviewers, labels },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
}

/** Opens a note's editor, in `theme`, and waits for its header. */
export async function openNote(
  page: Page,
  id: string,
  theme: Theme = "light"
): Promise<void> {
  await gotoAdmin(page, `/collections/${REVIEWED_NOTES}/${id}`, theme);
  await expect(page.getByTestId("document-bar")).toBeVisible({
    timeout: 30_000,
  });
}

/** The line under the title that says where the note stands in its review. */
export function statusLine(page: Page): Locator {
  return page.getByTestId("review-status-line");
}

/** The header's leading action, whatever it is. */
export function leading(page: Page): Locator {
  return page.locator('[data-primary="true"]');
}

/** A step's control in the header, by the step's name. */
export function stepControl(page: Page, name: string): Locator {
  return page.locator(`[data-action="review-step:${name}"]`);
}

/** Publish, wherever the header draws it: leading, or in the toolbar beside a step. */
export function publishControl(page: Page): Locator {
  return page.locator('[data-action="publish"]');
}

/**
 * Publish held until the note is approved, as the header draws it: greyed and
 * `aria-disabled`, yet focusable and read with its reason; pressed, it opens
 * "Ready to publish?", which Escape closes again.
 */
export async function expectPublishHeldForReview(
  page: Page,
  reason: RegExp
): Promise<void> {
  const held = publishControl(page);
  await expect(held).toHaveAttribute("aria-disabled", "true");
  // Not the native `disabled`, which would take it out of the Tab order.
  expect(
    await held.evaluate(element => (element as HTMLButtonElement).disabled)
  ).toBe(false);
  await held.focus();
  await expect(held).toBeFocused();
  await expect(held).toHaveAccessibleDescription(reason);
  await held.click();
  const ready = page
    .locator("[data-publish-parts-dialog]")
    .getByRole("region", { name: "Ready to publish?" });
  await expect(ready).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ready).toBeHidden();
}

/**
 * The review's own polite status region, which says each step to assistive
 * technology. By its id, since a toast is a status region too and says the
 * same words: a locator by role would match both.
 */
export function reviewAnnouncer(page: Page): Locator {
  return page.locator(
    '#nextly-review-announcer[role="status"][aria-live="polite"]'
  );
}

/**
 * The editor's screens a workflow changes, each held to WCAG 2.2 AA: the
 * header, the line under the title and the side panel, which holds the
 * Review section.
 */
export async function expectEditorAccessible(page: Page): Promise<void> {
  for (const include of EDITOR_SCOPES) {
    await expectNoAxeViolations(page, { include });
  }
}

/** Where the editor draws the workflow: the header, the status line, the side panel. */
const EDITOR_SCOPES = [
  '[data-testid="document-bar"]',
  '[data-testid="review-status-line"]',
  '[data-testid="document-panel-sections"]',
];
