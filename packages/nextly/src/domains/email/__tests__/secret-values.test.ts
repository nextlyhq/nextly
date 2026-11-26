import { describe, expect, it } from "vitest";

import { secretValuesOf, withoutSecrets } from "../secret-values";

const TOKEN = "a-sample-invitation-token-for-this-test-only";
const LINK = `https://shop.example.com/account/invitation?token=${TOKEN}`;

describe("a secret-carrying send's secrets, kept out of a provider's failure", () => {
  it("blanks a link whole, its token alone, and a code, however the failure quotes them", () => {
    const secrets = secretValuesOf({
      link: LINK,
      code: "12345678",
      nested: { cancel: `${LINK}&next=a&b` },
    });
    const failure = [
      `refused: <a href="${LINK}">choose</a>`,
      `token ${TOKEN} rejected`,
      "code 12345678",
      `escaped ${`${LINK}&next=a&b`.replaceAll("&", "&amp;")}`,
    ].join(" | ");

    const blanked = withoutSecrets(failure, secrets);
    expect(blanked).not.toContain(TOKEN);
    expect(blanked).not.toContain("12345678");
    expect(blanked).toContain("refused");
    expect(blanked).toContain("rejected");
  });

  it("leaves a value too short to be a secret, so the failure stays readable", () => {
    const secrets = secretValuesOf({ name: "Ana", count: 3 });
    expect(withoutSecrets("Ana's message was refused", secrets)).toBe(
      "Ana's message was refused"
    );
  });
});
