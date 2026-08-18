/**
 * The one place this package reaches for nodemailer.
 *
 * It is an optional peer dependency, so it can be absent at runtime while the
 * code that needs it is compiled and registered. What matters is that the
 * absence is reported as an instruction rather than as a module-not-found.
 */
import { describe, expect, it } from "vitest";

import {
  NODEMAILER_INSTALL_COMMAND,
  isNodemailerAvailable,
  loadNodemailer,
} from "../services/providers/nodemailer-loader";

describe("the nodemailer loader", () => {
  it("names a command a user can actually run", () => {
    expect(NODEMAILER_INSTALL_COMMAND).toContain("nodemailer");
    expect(NODEMAILER_INSTALL_COMMAND).toMatch(/install|add/);
  });

  it("finds the library here, where it stays a devDependency", () => {
    // The repository keeps testing against the real library after it stops
    // being shipped to users. A false here would mean the SMTP suites are
    // silently exercising nothing.
    expect(isNodemailerAvailable()).toBe(true);
  });

  it("loads a module exposing createTransport", async () => {
    const mailer = await loadNodemailer();

    // Published as CommonJS, so an ESM host may hand back the namespace with
    // the real export on `default`. Asserting the CALLABLE rather than the
    // shape is what catches the interop landing on the wrong branch.
    expect(typeof mailer.createTransport).toBe("function");
  });
});
