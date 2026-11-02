import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { keyFor, openSaved, readSaved, settingsOf } from "./saved.mjs";

const options = { docs: "1000", iterations: "3000", warmup: "300", "rest-iterations": "600", seed: "1", "max-load": "8", revision: "abc", modes: "main,per-language", dialects: "mysql" };
const folders = [];
afterEach(() => folders.splice(0).forEach(f => rmSync(f, { recursive: true, force: true })));
const fileIn = () => {
  const folder = mkdtempSync(join(tmpdir(), "read-benchmark-saved-"));
  folders.push(folder);
  return join(folder, "measurements.jsonl");
};

describe("the measurements a run keeps as it goes", () => {
  it("records only the settings that make measurements comparable", () => {
    expect(settingsOf(options)).toEqual({ docs: "1000", iterations: "3000", warmup: "300", "rest-iterations": "600", seed: "1", "max-load": "8", revision: "abc", modes: "main,per-language" });
  });

  it("gives back every measurement saved, by database, run and mode", () => {
    const file = fileIn();
    const first = openSaved(file, options);
    expect(first.saved.size).toBe(0);
    first.save("sqlite", 0, "main", { p95: 1 });
    first.save("sqlite", 0, "per-language", { p95: 2 });
    const again = openSaved(file, options);
    expect(again.saved.get(keyFor("sqlite", 0, "main"))).toEqual({ p95: 1 });
    expect(again.saved.get(keyFor("sqlite", 0, "per-language"))).toEqual({ p95: 2 });
    expect(again.saved.has(keyFor("sqlite", 1, "main"))).toBe(false);
    // One header, written once, however often the file is opened.
    expect(readFileSync(file, "utf8").split("\n").filter(l => l.includes('"settings"'))).toHaveLength(1);
  });

  it("refuses measurements taken with other settings", () => {
    const file = fileIn();
    openSaved(file, options).save("mysql", 0, "main", { p95: 1 });
    expect(() => openSaved(file, { ...options, seed: "2" })).toThrow(/were taken with/);
    // A stricter load limit would otherwise reuse measurements taken above it.
    expect(() => openSaved(file, { ...options, "max-load": "4" })).toThrow(/were taken with/);
    // Or measurements taken by other code.
    expect(() => openSaved(file, { ...options, revision: "def" })).toThrow(/were taken with/);
    // Or measurements kept for another pair, whose `main` would be paired with a measurement taken now.
    expect(() => openSaved(file, { ...options, modes: "main,e4" })).toThrow(/were taken with/);
    expect(() => readSaved(`${JSON.stringify({ settings: settingsOf(options) })}\n`, settingsOf({ ...options, docs: "50" }))).toThrow(/were taken with/);
  });

  it("starts a file that exists but is empty with its header", () => {
    // As a path made by `mktemp` is.
    const file = fileIn();
    writeFileSync(file, "");
    openSaved(file, options).save("sqlite", 0, "main", { p95: 1 });
    expect(openSaved(file, options).saved.get(keyFor("sqlite", 0, "main"))).toEqual({ p95: 1 });
  });

  it("keeps nothing when no file is named", () => {
    const store = openSaved(undefined, options);
    store.save("sqlite", 0, "main", { p95: 1 });
    expect(store.saved.size).toBe(0);
  });
});
