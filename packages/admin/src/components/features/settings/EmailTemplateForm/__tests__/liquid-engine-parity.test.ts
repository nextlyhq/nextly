/**
 * The editor's engine and the server's agree on what an email can use.
 *
 * Completion offers the tags and filters the admin's engine registers, and
 * the problems it marks come from that engine too. The server's engine is the
 * one a save meets; if the two disagreed, the editor would offer what a save
 * refuses, or mark as a problem what a save accepts. Read from the server's
 * module itself, so a change to either side's policy fails here.
 */
import { describe, expect, it } from "vitest";

import {
  liquidFilterNames as serverFilters,
  liquidTagNames as serverTags,
} from "../../../../../../../nextly/src/domains/email/services/liquid-engine";
import { liquidFilterNames, liquidTagNames } from "../liquid/liquid-problems";

describe("the editor's Liquid", () => {
  it("has the tags the server's engine has", () => {
    expect(liquidTagNames()).toEqual(serverTags());
  });

  it("has the filters the server's engine has", () => {
    expect(liquidFilterNames()).toEqual(serverFilters());
  });
});
