/**
 * The editor's reads of its form routes: kept a short while per person, a
 * failed or malformed read never kept, and a picked form asked by its
 * provider, reference and language.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({ readPluginRoute: read }));

import {
  EDITOR_FORM_ROUTE_PATH,
  EDITOR_FORMS_ROUTE_PATH,
} from "../forms/editor-forms-contract";

import {
  EDITOR_FORMS_KEPT_MS,
  editorFormPath,
  forgetEditorForms,
  readEditorForm,
  readEditorForms,
} from "./editor-forms-client";

const LISTED = {
  providers: [{ id: "forms", label: "Forms", forms: [] }],
};

beforeEach(() => {
  vi.useFakeTimers();
  read.mockReset();
  forgetEditorForms();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("listing the site's forms", () => {
  it("is read once while kept, and again once it has aged", async () => {
    read.mockResolvedValue(LISTED);
    expect(await readEditorForms("u1")).toEqual(LISTED.providers);
    vi.advanceTimersByTime(EDITOR_FORMS_KEPT_MS - 1);
    await readEditorForms("u1");
    expect(read).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await readEditorForms("u1");
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith({
      plugin: "@nextlyhq/plugin-page-builder",
      path: EDITOR_FORMS_ROUTE_PATH,
    });
  });

  it("is never handed from one person to the next", async () => {
    read.mockResolvedValue(LISTED);
    await readEditorForms("u1");
    await readEditorForms("u2");
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("refuses an answer that is not a list, and keeps no failure", async () => {
    read.mockResolvedValueOnce({ nope: true });
    await expect(readEditorForms("u1")).rejects.toThrow(/could not be listed/);
    read.mockResolvedValueOnce(LISTED);
    expect(await readEditorForms("u1")).toEqual(LISTED.providers);
  });
});

describe("reading a picked form", () => {
  it("asks by provider, reference and language", () => {
    expect(editorFormPath({ provider: "forms", ref: "7 a" }, "fr")).toBe(
      `${EDITOR_FORM_ROUTE_PATH}?provider=forms&ref=7+a&locale=fr`
    );
    expect(editorFormPath({ provider: "forms", ref: "7" }, undefined)).toBe(
      `${EDITOR_FORM_ROUTE_PATH}?provider=forms&ref=7`
    );
  });

  it("passes on each state the route answers", async () => {
    read.mockResolvedValueOnce({ state: "missing" });
    expect(
      await readEditorForm({ provider: "forms", ref: "1" }, undefined, "u1")
    ).toEqual({ state: "missing" });
    const drawing = { ref: "2", fields: [] };
    read.mockResolvedValueOnce({ state: "draft", drawing });
    expect(
      await readEditorForm({ provider: "forms", ref: "2" }, undefined, "u1")
    ).toEqual({ state: "draft", drawing });
  });

  it("refuses a malformed answer rather than call the form deleted", async () => {
    read.mockResolvedValueOnce({ state: "published" });
    await expect(
      readEditorForm({ provider: "forms", ref: "3" }, undefined, "u1")
    ).rejects.toThrow(/could not be read/);
  });
});
