/**
 * The brand facts the Organization tab keeps beyond its name, other names,
 * logo and profiles: how they are stored, refused and read back.
 *
 * What each case pins:
 * - every fact the plugin's options can give about the brand, other than
 *   its founders, can be stored, and is read back as structured data takes it;
 * - a contact point is kept as its purpose and one way to reach it, an email
 *   address, a telephone number or a web address, told apart by its form;
 * - a stored value that is not one is refused with a sentence saying why.
 */
import { describe, expect, it } from "vitest";

import {
  brandDetailsOf,
  brandDetailsProblem,
  contactPointOf,
  contactProblem,
} from "../brand-details";

describe("stored brand details", () => {
  it("are read back as structured data takes them, blanks left out", () => {
    expect(
      brandDetailsOf({
        description: " What the company is. ",
        email: "hello@example.com",
        telephone: "",
        foundingDate: "2024",
        contactPoints: [
          { contactType: "customer support", email: "help@example.com" },
          { contactType: "sales", telephone: "+1 555 0100" },
        ],
        parentOrganization: {
          name: "Example Holdings",
          url: "https://holdings.example",
          description: "",
          foundingDate: "2020",
        },
      })
    ).toEqual({
      description: "What the company is.",
      email: "hello@example.com",
      foundingDate: "2024",
      contactPoints: [
        { contactType: "customer support", email: "help@example.com" },
        { contactType: "sales", telephone: "+1 555 0100" },
      ],
      parentOrganization: {
        name: "Example Holdings",
        url: "https://holdings.example",
        foundingDate: "2020",
      },
    });
  });

  it("are nothing where none are stored", () => {
    expect(brandDetailsOf(undefined)).toEqual({});
    expect(brandDetailsOf(null)).toEqual({});
    // A value its rule refuses, edited past the screen, gives nothing.
    expect(brandDetailsOf({ email: "not an address" })).toEqual({});
    expect(brandDetailsProblem(undefined)).toBeNull();
    expect(brandDetailsProblem(null)).toBeNull();
  });

  it.each([
    [[], "must be kept as named facts"],
    [{ email: "not an address" }, "email address"],
    [{ telephone: "call us" }, "telephone number"],
    [{ foundingDate: "last year" }, "year"],
    [{ contactPoints: {} }, "must be a list"],
    [{ contactPoints: [{ email: "help@example.com" }] }, "what it is for"],
    [{ contactPoints: [{ contactType: "sales" }] }, "way to reach"],
    [{ parentOrganization: "Example Holdings" }, "parent organization"],
    [{ parentOrganization: { url: "holdings" } }, "whole address"],
    [{ colour: "blue" }, "colour"],
  ])("refuses %j", (value, said) => {
    expect(brandDetailsProblem(value)).toMatch(said);
  });
});

describe("one way to reach the brand, as typed", () => {
  it("is told apart by its form", () => {
    expect(contactPointOf("customer support", " help@example.com ")).toEqual({
      contactType: "customer support",
      email: "help@example.com",
    });
    expect(contactPointOf("sales", "+44 20 7946 0000")).toEqual({
      contactType: "sales",
      telephone: "+44 20 7946 0000",
    });
    expect(
      contactPointOf("technical support", "https://example.com/help")
    ).toEqual({
      contactType: "technical support",
      url: "https://example.com/help",
    });
  });

  it("says what is wrong with what was typed", () => {
    expect(contactProblem("help@example.com")).toBeNull();
    expect(contactProblem("+1 555 0100")).toBeNull();
    expect(contactProblem("https://example.com/help")).toBeNull();
    expect(contactProblem("help desk")).toMatch(
      /email address, a telephone number or a web address/
    );
  });
});
