/**
 * What a person pastes into a verification box, read as the screen and the
 * Single both read it: a bare code is kept, a whole tag gives up its code, a
 * DNS record's code is taken after its `=`, another service's tag is named so
 * it can be moved, and anything else (markup, a file name, a half tag, a name
 * Nextly writes itself) is refused with a reason. Only codes are stored, and
 * the stored value's own check refuses what the screen would.
 */
import { describe, expect, it } from "vitest";

import {
  readOtherName,
  readPasted,
  VERIFICATION_SERVICES,
} from "../verification";
import {
  verificationProblem,
  verificationTagsOf,
} from "../verification-stored";

const BING = "8A2F61C4D0E9B7A35F0C19D2E6B4A7C9";

describe("readPasted", () => {
  it("keeps a bare code as it is, trimmed", () => {
    expect(readPasted(`  ${BING} `, "bing")).toEqual({
      kind: "code",
      code: BING,
    });
  });

  it("is empty for nothing but spaces", () => {
    expect(readPasted("   ", "bing")).toEqual({ kind: "empty" });
  });

  it("takes the code from the box's own whole tag, and says so", () => {
    expect(
      readPasted(`<meta name="msvalidate.01" content="${BING}" />`, "bing")
    ).toEqual({ kind: "code", code: BING, from: "tag" });
  });

  it("reads a tag whatever its attribute order, quotes or case", () => {
    expect(
      readPasted(`<META CONTENT='${BING}' Name='MSVALIDATE.01'>`, "bing")
    ).toEqual({ kind: "code", code: BING, from: "tag" });
  });

  it("names the service a tag belongs to when it is pasted in another's box", () => {
    expect(
      readPasted(`<meta name="msvalidate.01" content="${BING}">`, "google")
    ).toEqual({ kind: "elsewhere", service: "bing", code: BING });
  });

  it("offers Other services for a tag of a service with no box", () => {
    expect(
      readPasted(
        '<meta name="facebook-domain-verification" content="q3x9k2m8a7c1v5b0n4" />',
        "google"
      )
    ).toEqual({
      kind: "other",
      name: "facebook-domain-verification",
      code: "q3x9k2m8a7c1v5b0n4",
    });
  });

  it("takes the code after the = of a DNS record, and says so", () => {
    expect(
      readPasted(
        "google-site-verification=Kq3v9X_ab12CdEf34GhIj56KlMn78OpQr90StUvWx",
        "google"
      )
    ).toEqual({
      kind: "code",
      code: "Kq3v9X_ab12CdEf34GhIj56KlMn78OpQr90StUvWx",
      from: "dns",
    });
  });

  it("reads a DNS record pasted with its quotes", () => {
    expect(
      readPasted('"yandex-verification: 6f1c2a9b8e7d4c30"', "yandex")
    ).toEqual({ kind: "code", code: "6f1c2a9b8e7d4c30", from: "dns" });
  });

  it.each([
    ['<script src="https://s.pinimg.com/ct/core.js">', "script"],
    ['<link rel="me" href="https://example.com">', "link"],
    ['<meta name="p:domain_verify" content="a91c"><script>x()</script>', "two"],
    [
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      "equiv",
    ],
  ])("refuses markup that is not one meta tag (%s)", input => {
    const read = readPasted(input, "pinterest");
    expect(read.kind).toBe("refused");
    expect(read.kind === "refused" && read.message).toBe(
      "Only a code or a <meta> tag can go here. Scripts and other HTML are refused."
    );
  });

  it("refuses a file name, saying which way to verify to choose", () => {
    const read = readPasted("yandex_6f1c2a9b8e7d4c30.html", "yandex");
    expect(read).toEqual({
      kind: "refused",
      message:
        'That\'s a file name. This box takes the meta tag: choose "Meta tag" on Yandex and paste what it shows.',
    });
  });

  it("refuses a tag with no code", () => {
    const read = readPasted('<meta name="msvalidate.01">', "bing");
    expect(read).toEqual({
      kind: "refused",
      message: "That tag is missing its code. Copy the whole tag again.",
    });
  });

  it("refuses a tag cut off before its end", () => {
    const read = readPasted('<meta name="msvalidate.01" content="8A2F', "bing");
    expect(read.kind).toBe("refused");
    expect(read.kind === "refused" && read.message).toBe(
      "That tag is cut off. Copy the whole tag again."
    );
  });

  it("refuses a tag Nextly writes itself", () => {
    const read = readPasted('<meta name="robots" content="noindex">', "google");
    expect(read).toEqual({
      kind: "refused",
      message:
        "Nextly already writes the robots tag. This box is for verification tags only.",
    });
  });

  it("refuses a code holding characters a code never has", () => {
    const read = readPasted('abc"><img src=x>', "google");
    expect(read.kind).toBe("refused");
    const spaced = readPasted("two words", "google");
    expect(spaced.kind).toBe("refused");
  });

  it("refuses a code inside a tag that holds markup", () => {
    const read = readPasted(
      '<meta name="msvalidate.01" content="a&quot;&gt;&lt;script&gt;">',
      "bing"
    );
    expect(read.kind).toBe("refused");
  });
});

describe("readOtherName", () => {
  it("accepts a service's own name", () => {
    expect(readOtherName("facebook-domain-verification")).toBeNull();
    expect(readOtherName("norton-safeweb-site-verification")).toBeNull();
  });

  it.each([
    "description",
    "robots",
    "googlebot",
    "viewport",
    "og:title",
    "twitter:card",
    "OG:Image",
  ])("refuses %s, a name Nextly writes itself", name => {
    expect(readOtherName(name)).toEqual({
      kind: "refused",
      message: `Nextly already writes the ${name.toLowerCase()} tag. This box is for verification tags only.`,
    });
  });

  it("names the service whose box a known name belongs in", () => {
    expect(readOtherName("msvalidate.01")).toEqual({
      kind: "elsewhere",
      service: "bing",
    });
  });

  it("refuses a name with characters a meta name never has", () => {
    expect(readOtherName('a"b')?.kind).toBe("refused");
    expect(readOtherName("two words")?.kind).toBe("refused");
  });
});

describe("verificationProblem (the stored value's rule)", () => {
  it("accepts nothing stored, and an empty set", () => {
    expect(verificationProblem(null)).toBeNull();
    expect(verificationProblem(undefined)).toBeNull();
    expect(verificationProblem({})).toBeNull();
  });

  it("accepts codes and other services' tags", () => {
    expect(
      verificationProblem({
        google: "Kq3v9X_ab12CdEf34",
        bing: BING,
        others: [{ name: "facebook-domain-verification", code: "q3x9k2" }],
      })
    ).toBeNull();
  });

  it.each([
    [{ google: '"><script>alert(1)</script>' }, "markup in a code"],
    [{ google: "" }, "an empty code"],
    [{ bing: 42 }, "a code that is not text"],
    [{ unknown: "abc" }, "a service it does not know"],
    [{ others: [{ name: "robots", code: "noindex" }] }, "a name Nextly writes"],
    [
      { others: [{ name: "msvalidate.01", code: "abc" }] },
      "a service's own name",
    ],
    [{ others: [{ name: "a b", code: "abc" }] }, "a name with a space"],
    [{ others: [{ name: "x-verify" }] }, "a tag without its code"],
    [
      {
        others: [
          { name: "x-verify", code: "a" },
          { name: "X-Verify", code: "b" },
        ],
      },
      "a name twice",
    ],
    [{ others: "x" }, "others that are not a list"],
  ])("refuses %j (%s)", value => {
    expect(verificationProblem(value)).toEqual(expect.any(String));
  });

  it("refuses more other services than the screen offers room for", () => {
    const others = Array.from({ length: 21 }, (_, index) => ({
      name: `service-${index}-verification`,
      code: "abc",
    }));
    expect(verificationProblem({ others })).toEqual(expect.any(String));
  });
});

describe("verificationTagsOf", () => {
  it("is each service's meta name and code, then the other services'", () => {
    expect(
      verificationTagsOf({
        pinterest: "a91c7e04b2d35f68",
        google: "Kq3v9X",
        others: [{ name: "facebook-domain-verification", code: "q3x9k2" }],
      })
    ).toEqual({
      "google-site-verification": "Kq3v9X",
      "p:domain_verify": "a91c7e04b2d35f68",
      "facebook-domain-verification": "q3x9k2",
    });
  });

  it("is nothing for a value its rule refuses, so no tag is half-trusted", () => {
    expect(
      verificationTagsOf({ google: '"><script>alert(1)</script>' })
    ).toEqual({});
    expect(verificationTagsOf("garbage")).toEqual({});
  });

  it("is nothing where nothing is stored, as before the field existed", () => {
    expect(verificationTagsOf(undefined)).toEqual({});
    expect(verificationTagsOf(null)).toEqual({});
  });
});

describe("VERIFICATION_SERVICES", () => {
  it("lists each service with the meta name it reads", () => {
    expect(
      VERIFICATION_SERVICES.map(service => [service.name, service.metaName])
    ).toEqual([
      ["Google", "google-site-verification"],
      ["Bing", "msvalidate.01"],
      ["Pinterest", "p:domain_verify"],
      ["Yandex", "yandex-verification"],
      ["Baidu", "baidu-site-verification"],
    ]);
  });
});
