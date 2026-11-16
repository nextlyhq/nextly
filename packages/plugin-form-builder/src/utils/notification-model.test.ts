/**
 * How a stored notification reads: typed addresses into a list, a rule's
 * single address and single condition as lists, all/any over several
 * conditions, and which file fields a notification attaches, a rule saved
 * before the choice existed attaching exactly the fields marked to.
 */
import { describe, expect, it } from "vitest";

import type { AnyFormField, FormNotification } from "../types";

import {
  attachFieldsOf,
  attachmentsFrom,
  conditionsMet,
  conditionsOf,
  parseAddressList,
  teamAddressesOf,
} from "./notification-model";

const RULE: FormNotification = {
  id: "team",
  name: "Team",
  enabled: true,
  recipientType: "static",
  to: "events@example.com",
  cc: [],
  bcc: [],
};

describe("typed addresses", () => {
  it("split on commas, semicolons, spaces and new lines", () => {
    expect(
      parseAddressList(" a@x.test, b@x.test;c@x.test\nd@x.test  e@x.test ")
    ).toEqual(["a@x.test", "b@x.test", "c@x.test", "d@x.test", "e@x.test"]);
  });

  it("drop blanks and repeats, whatever their case", () => {
    expect(parseAddressList("a@x.test,, A@X.test ;")).toEqual(["a@x.test"]);
    expect(parseAddressList("   ")).toEqual([]);
  });
});

describe("a team notification's addresses", () => {
  it("are its list", () => {
    expect(
      teamAddressesOf({ ...RULE, recipients: [" a@x.test ", "", "b@x.test"] })
    ).toEqual(["a@x.test", "b@x.test"]);
  });

  it("are the single address a rule was saved with", () => {
    expect(teamAddressesOf(RULE)).toEqual(["events@example.com"]);
    expect(teamAddressesOf({ ...RULE, to: "  " })).toEqual([]);
  });
});

describe("a notification's conditions", () => {
  const access = {
    field: "access",
    comparison: "equals" as const,
    value: true,
  };
  const online = {
    field: "join",
    comparison: "equals" as const,
    value: "online",
  };

  it("read a single condition as a list of one under all", () => {
    expect(conditionsOf({ ...RULE, condition: access })).toEqual({
      match: "all",
      list: [access],
    });
    expect(conditionsOf(RULE)).toEqual({ match: "all", list: [] });
  });

  it("hold when all hold, or when any one does", () => {
    const data = { access: true, join: "in_person" };
    expect(conditionsMet({ match: "all", list: [access, online] }, data)).toBe(
      false
    );
    expect(conditionsMet({ match: "any", list: [access, online] }, data)).toBe(
      true
    );
    expect(
      conditionsMet(
        { match: "all", list: [access, online] },
        { access: true, join: "online" }
      )
    ).toBe(true);
    expect(conditionsMet({ match: "any", list: [online] }, data)).toBe(false);
  });

  it("send every time when there are none", () => {
    expect(conditionsMet({ match: "any", list: [] }, {})).toBe(true);
  });

  it("read several stored conditions with their match", () => {
    expect(
      conditionsOf({
        ...RULE,
        condition: access,
        conditions: { match: "any", list: [online] },
      })
    ).toEqual({ match: "any", list: [online] });
  });
});

describe("a notification's attachments", () => {
  const fields: AnyFormField[] = [
    { type: "file", name: "cv", label: "CV", attachToEmail: true },
    { type: "file", name: "photo", label: "Photo" },
  ];

  it("are the fields marked to attach for a rule saved before the choice", () => {
    expect(attachFieldsOf(RULE, fields)).toEqual(["cv"]);
  });

  it("are the notification's own choice, even none", () => {
    expect(
      attachFieldsOf({ ...RULE, attachFields: ["photo"] }, fields)
    ).toEqual(["photo"]);
    expect(attachFieldsOf({ ...RULE, attachFields: [] }, fields)).toEqual([]);
  });

  it("are the media ids the submission holds under those fields", () => {
    expect(
      attachmentsFrom(["cv", "photo"], { cv: "m1", photo: ["m2", "", 3] })
    ).toEqual([{ mediaId: "m1" }, { mediaId: "m2" }]);
  });
});
