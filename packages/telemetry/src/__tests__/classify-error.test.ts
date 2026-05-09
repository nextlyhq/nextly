import { describe, it, expect } from "vitest";

import { classifyError } from "../classify-error.js";

describe("classifyError", () => {
  it("maps ETIMEDOUT to install_network", () => {
    const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    expect(classifyError(err, "install")).toBe("install_network");
  });
  it("maps ENOTFOUND to install_network", () => {
    const err = Object.assign(new Error("dns"), { code: "ENOTFOUND" });
    expect(classifyError(err, "install")).toBe("install_network");
  });
  it("maps ECONNRESET to install_network", () => {
    const err = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    expect(classifyError(err, "install")).toBe("install_network");
  });
  it("maps EACCES to install_permission", () => {
    const err = Object.assign(new Error("perm"), { code: "EACCES" });
    expect(classifyError(err, "install")).toBe("install_permission");
  });
  it("maps EPERM to install_permission", () => {
    const err = Object.assign(new Error("perm"), { code: "EPERM" });
    expect(classifyError(err, "install")).toBe("install_permission");
  });
  it("maps ENOSPC to install_disk_full", () => {
    const err = Object.assign(new Error("full"), { code: "ENOSPC" });
    expect(classifyError(err, "install")).toBe("install_disk_full");
  });
  it("falls through to install_failed for unknown install errors", () => {
    expect(classifyError(new Error("who knows"), "install")).toBe(
      "install_failed"
    );
  });
  it("returns template_download_failed for the template-download scope", () => {
    expect(classifyError(new Error("x"), "template-download")).toBe(
      "template_download_failed"
    );
  });
  it("returns template_parse_failed for the template-parse scope", () => {
    expect(classifyError(new Error("x"), "template-parse")).toBe(
      "template_parse_failed"
    );
  });
  it("returns config_generation_failed for the config scope", () => {
    expect(classifyError(new Error("x"), "config")).toBe(
      "config_generation_failed"
    );
  });
  it("returns db_connection_failed for the db scope", () => {
    expect(classifyError(new Error("x"), "db")).toBe("db_connection_failed");
  });
  it("returns migration_conflict for the migration scope", () => {
    expect(classifyError(new Error("x"), "migration")).toBe(
      "migration_conflict"
    );
  });
  it("returns unknown for unrecognized scope and message", () => {
    expect(classifyError(new Error("x"), "other")).toBe("unknown");
  });
  it("handles non-Error values defensively", () => {
    expect(classifyError("string-err", "install")).toBe("install_failed");
    expect(classifyError(null, "install")).toBe("install_failed");
    expect(classifyError(undefined, "other")).toBe("unknown");
  });
});
