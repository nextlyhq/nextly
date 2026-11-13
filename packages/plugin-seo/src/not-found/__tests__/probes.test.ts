/**
 * Bots' probes for other systems' admin pages, config files and scripts are
 * told apart from addresses a person followed a link to, which stay in the
 * not-found log however close their names.
 */
import { describe, expect, it } from "vitest";

import { isBotProbe } from "../probes";

describe("isBotProbe", () => {
  it("knows the addresses bots ask every site for", () => {
    for (const path of [
      "/wp-login.php",
      "/wp-admin/install.php",
      "/blog/wp-content/plugins/x.js",
      "/xmlrpc.php",
      "/phpmyadmin/index.php",
      "/.env",
      "/app/.env.production",
      "/.git/config",
      "/cgi-bin/luci",
      "/backup.sql",
      "/WP-LOGIN.PHP",
    ]) {
      expect(isBotProbe(path), path).toBe(true);
    }
  });

  it("leaves alone the addresses a person may have followed a link to", () => {
    for (const path of [
      "/pricing-plans",
      "/blog/wordpress-tips",
      "/docs/environment",
      "/index.php",
      "/about/admin-team",
      "/git-guide",
      "/",
    ]) {
      expect(isBotProbe(path), path).toBe(false);
    }
  });
});
