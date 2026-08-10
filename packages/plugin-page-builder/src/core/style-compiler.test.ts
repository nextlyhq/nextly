import { describe, it, expect } from "vitest";

import { nodeClassName } from "@nextlyhq/blocks-engine";

import {
  nodeClass,
  compileDocumentBlockCss,
  compileNodeCss,
  compileDocumentCss,
  compileTokensCss,
  documentNodeClasses,
  documentNodeIds,
  isAllowedRemoteUrl,
  safeValue,
  DEFAULT_BREAKPOINTS,
  documentKey,
  refNodeClass,
  refScopedKey,
} from "./style-compiler";
import { makeNode } from "./tree";

describe("nodeClass", () => {
  it("is deterministic and prefixed", () => {
    expect(nodeClass("pb-abc")).toBe(nodeClass("pb-abc"));
    expect(nodeClass("pb-abc")).toMatch(/^nx-pb-[a-z0-9]+$/);
    expect(nodeClass("pb-abc")).not.toBe(nodeClass("pb-def"));
  });

  it("uses the engine's digest, not a second one under the same prefix", () => {
    // Both sides once emitted `nx-pb-` from different digests, so the compiler and the engine
    // could name one node two ways. What has to hold is that there is ONE hash — the plugin
    // composes a KEY and hands it to the engine, rather than hashing anything itself.
    //
    // Asserted through the key rather than the raw id, because a document node is named from
    // `documentKey(id)` so its name cannot collide with a library node named from a ref. Comparing
    // `nodeClass(id)` to `nodeClassName(id)` would now be comparing two different questions.
    expect(nodeClass("pb-abc")).toBe(nodeClassName(documentKey("pb-abc")));
    expect(refNodeClass("r1", "pb-abc")).toBe(
      nodeClassName(refScopedKey("r1", "pb-abc"))
    );
  });

  it("names a document node and a library node of the same id apart", () => {
    // The collision the key space exists to close, stated directly.
    expect(nodeClass("shared")).not.toBe(refNodeClass("r1", "shared"));
  });

  it("cannot be collided by a document id shaped like a ref key", () => {
    // A node id is any non-empty string, so a document can carry the literal id a ref key
    // generates. Prefixing only the ref side would give both the same class.
    const generated = refScopedKey("r1", "same");
    expect(nodeClass(generated)).not.toBe(refNodeClass("r1", "same"));
  });
});

describe("document node classes", () => {
  const leaf = makeNode("core/heading", { text: "Hi" });
  const doc = {
    version: 1 as const,
    root: makeNode("core/container", {}, undefined, { default: [leaf] }),
  };

  it("covers every node the document walk reaches", () => {
    expect(documentNodeIds(doc)).toEqual([doc.root.id, leaf.id]);
    expect([...documentNodeClasses(doc).keys()].sort()).toEqual(
      [documentKey(doc.root.id), documentKey(leaf.id)].sort()
    );
  });

  it("names a node in the stylesheet from the map it is given", () => {
    // The map is what makes a collision resolvable, so a compiler that computed
    // the class itself would emit a selector the markup never carries. A map
    // holding a name the default would never produce is the only way to tell
    // "consulted it" apart from "happened to agree with it".
    const classes = new Map([[documentKey(leaf.id), "nx-pb-from-the-map"]]);
    const styled = { ...leaf, style: { base: { backgroundColor: "#111" } } };
    expect(compileNodeCss(styled, { classes })).toContain(
      ".nx-pb-from-the-map"
    );
  });

  it("names a node in its custom CSS from the same map", () => {
    // The other half of the same rule: per-block custom CSS is anchored to the
    // node class too, and anchoring it to a different one scopes an author's
    // CSS to a selector nothing on the page matches.
    const withCss = { ...leaf, customCss: "selector { color: red }" };
    const scoped = {
      version: 1 as const,
      root: makeNode("core/container", {}, undefined, { default: [withCss] }),
    };
    const classes = new Map([[documentKey(withCss.id), "nx-pb-from-the-map"]]);
    expect(compileDocumentBlockCss(scoped, classes)).toContain(
      ".nx-pb-from-the-map"
    );
  });

  it("compiles a whole document through one map without being handed one", () => {
    const styled = { ...leaf, style: { base: { backgroundColor: "#111" } } };
    const tree = {
      version: 1 as const,
      root: makeNode("core/container", {}, undefined, { default: [styled] }),
    };
    expect(compileDocumentCss(tree)).toContain(
      `.${documentNodeClasses(tree).get(documentKey(styled.id))}`
    );
  });
});

describe("style compiler", () => {
  it("emits base declarations under the node's class", () => {
    const n = makeNode(
      "core/container",
      {},
      {
        base: { padding: { top: "24px" }, backgroundColor: "#111" },
      }
    );
    const css = compileNodeCss(n);
    expect(css).toContain(`.${nodeClass(n.id)}`);
    expect(css).toContain("padding-top: 24px");
    expect(css).toContain("background-color: #111");
  });

  it("compiles a token palette into CSS custom properties on the root", () => {
    const css = compileTokensCss("nx-pb-page", { "color.primary": "#7c3aed" });
    expect(css).toContain(".nx-pb-page");
    expect(css).toContain("--nx-color-primary: #7c3aed");
  });

  it("emits :hover rules + a transition from styleHover", () => {
    const n = makeNode(
      "core/button",
      {},
      { base: { backgroundColor: "#333" } }
    );
    n.styleHover = { base: { backgroundColor: "#4f46e5" } };
    const css = compileNodeCss(n);
    const cls = nodeClass(n.id);
    expect(css).toContain(`.${cls}:hover`);
    expect(css).toContain("background-color: #4f46e5");
    expect(css).toContain("transition:");
  });

  it("resolves design-token references to CSS vars", () => {
    const n = makeNode(
      "core/heading",
      {},
      {
        base: { color: { token: "color.primary" } },
      }
    );
    expect(compileNodeCss(n)).toContain("color: var(--nx-color-primary)");
  });

  it("wraps tablet/mobile overrides in max-width media queries (desktop-first)", () => {
    const n = makeNode(
      "core/container",
      {},
      { mobile: { padding: { top: "8px" } } }
    );
    const css = compileNodeCss(n);
    const mobile = DEFAULT_BREAKPOINTS.find(b => b.id === "mobile")!;
    expect(css).toContain(`@media (max-width: ${mobile.maxWidth}px)`);
    expect(css).toContain("padding-top: 8px");
  });

  it("drops a style value that tries to break out of the declaration block", () => {
    const n = makeNode(
      "core/container",
      {},
      {
        base: { color: "red } body { display:none", backgroundColor: "#fff" },
      }
    );
    const css = compileNodeCss(n);
    expect(css).not.toContain("display:none");
    expect(css).toContain("background-color: #fff"); // safe value still emitted
  });

  it("emits a background-image url() safely and rejects javascript: urls", () => {
    const ok = compileNodeCss(
      makeNode("core/container", {}, { base: { backgroundImage: "/a.jpg" } })
    );
    expect(ok).toContain('background-image: url("/a.jpg")');
    const bad = compileNodeCss(
      makeNode(
        "core/container",
        {},
        { base: { backgroundImage: "javascript:alert(1)" } }
      )
    );
    expect(bad).not.toContain("javascript:");
  });

  it("refuses a remote background image unless its host is declared", () => {
    // A remote image is a REQUEST, and custom CSS lands in the same stylesheet
    // and can suppress the declaration conditionally — so an image on an
    // undeclared host is a channel an author can gate on a secret selector and
    // read back by the request's absence, not merely an unexpected picture.
    const node = makeNode(
      "core/container",
      {},
      { base: { backgroundImage: "https://evil.example/a.png" } }
    );
    expect(compileNodeCss(node)).not.toContain("evil.example");

    // Declared, so allowed: the escape hatch has to work or the restriction is
    // just a removed feature.
    expect(
      compileNodeCss(node, {
        remotePatterns: [{ protocol: "https", hostname: "evil.example" }],
      })
    ).toContain('background-image: url("https://evil.example/a.png")');

    // Same-origin never needs declaring.
    expect(
      compileNodeCss(
        makeNode("core/container", {}, { base: { backgroundImage: "/a.jpg" } })
      )
    ).toContain('background-image: url("/a.jpg")');
  });

  it("applies the origin policy to every value, not a list of properties", () => {
    // `filter: url(…#f)` is a request, and it reached the page because `filter`
    // went through the plain-value path while only `backgroundImage` was
    // checked. A hand-kept list of fetch-capable properties is the same losing
    // shape as a hand-kept list of dangerous schemes.
    const filtered = makeNode(
      "core/container",
      {},
      { base: { filters: 'url("https://evil.example/f.svg#x")' } }
    );
    expect(compileNodeCss(filtered)).not.toContain("evil.example");
    // Declared, so allowed — the value is not simply banned.
    expect(
      compileNodeCss(filtered, {
        remotePatterns: [{ protocol: "https", hostname: "evil.example" }],
      })
    ).toContain("evil.example");
    // A filter with no URL in it is untouched.
    expect(
      compileNodeCss(
        makeNode("core/container", {}, { base: { filters: "blur(2px)" } })
      )
    ).toContain("blur(2px)");
  });

  it("checks a string image source, which carries no url() at all", () => {
    // `image-set("https://…" 1x)` is a request and contains no `url()`, so a
    // Url-only walk accepted it. Which strings can fetch had already been
    // worked out for custom CSS; the compiler was answering it separately and
    // less well.
    for (const value of [
      'image-set("https://evil.example/a.png" 1x)',
      '-webkit-image-set("https://evil.example/b.png" 1x)',
    ]) {
      const node = makeNode(
        "core/container",
        {},
        { base: { backgroundGradient: value } }
      );
      expect(compileNodeCss(node)).not.toContain("evil.example");
      expect(
        compileNodeCss(node, {
          remotePatterns: [{ protocol: "https", hostname: "evil.example" }],
        })
      ).toContain("evil.example");
    }
    // A string that is text rather than an image source is untouched: the rule
    // is about position, not about the presence of a URL-shaped string.
    expect(
      compileNodeCss(
        makeNode(
          "core/container",
          {},
          { base: { backgroundGradient: "linear-gradient(red, blue)" } }
        )
      )
    ).toContain("linear-gradient");
  });

  it("reads a structured URL the way the browser will, not as written", () => {
    // A leading U+0001 survives `trim()`, and the URL parser strips it. The
    // compiler had its own origin check that used `trim()` and a scheme regexp
    // while the sanitizer followed the WHATWG steps, so the same value was
    // refused in one and emitted by the other.
    const node = makeNode(
      "core/container",
      {},
      { base: { backgroundImage: "\u0001https://evil.example/a.png" } }
    );
    expect(compileNodeCss(node)).not.toContain("evil.example");
  });

  it("refuses a protocol-relative url, which reaches another host too", () => {
    // `//evil.example/a.png` carries no scheme and still leaves the origin,
    // inheriting only the page's protocol.
    const node = makeNode(
      "core/container",
      {},
      { base: { backgroundImage: "//evil.example/a.png" } }
    );
    expect(compileNodeCss(node)).not.toContain("evil.example");
  });

  it("compileDocumentCss includes rules for every node", () => {
    const doc = {
      version: 1 as const,
      root: makeNode(
        "core/container",
        {},
        { base: { color: "#fff" } },
        {
          default: [
            makeNode("core/paragraph", {}, { base: { color: "#000" } }),
          ],
        }
      ),
    };
    const css = compileDocumentCss(doc);
    expect(css).toContain("#fff");
    expect(css).toContain("#000");
  });
});

describe("compileNodeCss — extended scalars", () => {
  it("emits extended typography + dimensions", () => {
    const n = makeNode(
      "core/heading",
      {},
      {
        base: {
          fontWeight: "700",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          minHeight: "200px",
          objectFit: "cover",
          overflow: "hidden",
          opacity: "0.5",
        },
      }
    );
    const css = compileNodeCss(n);
    expect(css).toContain("font-weight: 700");
    expect(css).toContain("letter-spacing: 0.05em");
    expect(css).toContain("text-transform: uppercase");
    expect(css).toContain("min-height: 200px");
    expect(css).toContain("object-fit: cover");
    expect(css).toContain("overflow: hidden");
    expect(css).toContain("opacity: 0.5");
  });

  it("drops values that fail css-tree validation", () => {
    const n = makeNode(
      "core/heading",
      {},
      { base: { fontWeight: "700; color:red" } }
    );
    expect(compileNodeCss(n)).not.toContain("color:red");
  });
});

describe("safeValue — attr() in a fetch position", () => {
  // Against `safeValue` directly rather than through a style property. Every
  // image-bearing key on the structured surface today is `backgroundImage`,
  // which takes the URL-shaped path and never reaches here, so no property
  // reproduces this yet. The rule still belongs in the value checker: it is
  // what a NEW structured value taking an image would inherit, and a test
  // routed through a property that cannot express the shape would assert the
  // property's own rejection instead of this one.
  it("refuses a value whose URL comes from a DOM attribute", () => {
    for (const value of [
      "image-set(attr(data-probe) 1x)",
      "-webkit-image-set(attr(data-probe) 1x)",
      "image(attr(data-probe))",
    ]) {
      expect(safeValue(value), value).toBeNull();
      // An allowlist cannot rescue it: there is no host here to match against,
      // which is precisely why it is refused rather than compared.
      expect(
        safeValue(value, [{ protocol: "https", hostname: "**" }]),
        value
      ).toBeNull();
    }
  });

  it("keeps attr() where it is read as text", () => {
    expect(safeValue("attr(data-label)")).toBe("attr(data-label)");
    expect(safeValue("local(attr(data-face))")).toBe("local(attr(data-face))");
  });
});

describe("compileNodeCss — structured values", () => {
  it("emits per-side border + style + color", () => {
    const css = compileNodeCss(
      makeNode(
        "core/container",
        {},
        {
          base: {
            border: {
              width: { top: "2px", bottom: "2px" },
              style: "solid",
              color: "#333",
            },
          },
        }
      )
    );
    expect(css).toContain("border-top-width: 2px");
    expect(css).toContain("border-bottom-width: 2px");
    expect(css).toContain("border-style: solid");
    expect(css).toContain("border-color: #333");
  });

  it("emits position with offsets and z-index", () => {
    const css = compileNodeCss(
      makeNode(
        "core/container",
        {},
        {
          base: {
            position: { type: "absolute", top: "10px", left: "0", zIndex: "5" },
          },
        }
      )
    );
    expect(css).toContain("position: absolute");
    expect(css).toContain("top: 10px");
    expect(css).toContain("left: 0");
    expect(css).toContain("z-index: 5");
  });

  it("emits background image object + gradient", () => {
    const css = compileNodeCss(
      makeNode(
        "core/container",
        {},
        {
          base: {
            backgroundImageObj: {
              url: "/x.jpg",
              position: "center",
              size: "cover",
              repeat: "no-repeat",
            },
            backgroundGradient: "linear-gradient(90deg, #fff, #000)",
          },
        }
      )
    );
    expect(css).toContain('background-image: url("/x.jpg")');
    expect(css).toContain("background-position: center");
    expect(css).toContain("background-size: cover");
    expect(css).toContain("background-repeat: no-repeat");
    expect(css).toMatch(/background-image: linear-gradient/);
  });

  it("rejects a javascript: url in the background object", () => {
    const css = compileNodeCss(
      makeNode(
        "core/container",
        {},
        { base: { backgroundImageObj: { url: "javascript:alert(1)" } } }
      )
    );
    expect(css).not.toContain("javascript");
  });
});

describe("compileNodeCss — visibility", () => {
  it("hides at a breakpoint via display:none media query", () => {
    const n = makeNode("core/heading", {});
    n.visibility = { mobile: false };
    const css = compileNodeCss(n);
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toMatch(/\.nx-pb-[a-z0-9]+ \{ display: none; \}/);
  });

  it("does not emit anything when the breakpoint is visible", () => {
    const n = makeNode("core/heading", {});
    n.visibility = { mobile: true };
    expect(compileNodeCss(n)).toBe("");
  });
});

describe("compileNodeCss — width alignment + link colors", () => {
  it("emits wide/full width alignment", () => {
    expect(
      compileNodeCss(
        makeNode("core/heading", {}, { base: { widthAlign: "wide" } })
      )
    ).toContain("max-width: 1100px");
    expect(
      compileNodeCss(
        makeNode("core/container", {}, { base: { widthAlign: "full" } })
      )
    ).toContain("width: 100%");
  });

  it("emits descendant link colors on .cls a and :hover", () => {
    const css = compileNodeCss(
      makeNode(
        "core/container",
        {},
        { base: { linkColor: "#f00", linkColorHover: "#0f0" } }
      )
    );
    expect(css).toMatch(/\.nx-pb-[a-z0-9]+ a \{ color: #f00; \}/);
    expect(css).toMatch(/\.nx-pb-[a-z0-9]+ a:hover \{ color: #0f0; \}/);
  });

  it("emits link colors per breakpoint, not only from base", () => {
    // The inspector offers the Link controls whatever device is selected, and writes the value
    // under that device — so reading only `base` stored the tablet and mobile values and compiled
    // nothing from them.
    const css = compileNodeCss(
      makeNode(
        "core/container",
        {},
        {
          base: { linkColor: "#f00" },
          mobile: { linkColor: "#00f", linkColorHover: "#0ff" },
        }
      )
    );

    // Positive control: the base value still compiles, so this is about the breakpoint values.
    expect(css).toMatch(/\.nx-pb-[a-z0-9]+ a \{ color: #f00; \}/);
    expect(css).toMatch(
      /@media \(max-width: 640px\) \{ \.nx-pb-[a-z0-9]+ a \{ color: #00f; \} \}/
    );
    expect(css).toMatch(
      /@media \(max-width: 640px\) \{ \.nx-pb-[a-z0-9]+ a:hover \{ color: #0ff; \} \}/
    );
  });
});

describe("isAllowedRemoteUrl", () => {
  it("matches protocol, host, port and path as Next.js does", () => {
    const p = [
      {
        protocol: "https" as const,
        hostname: "cdn.example.com",
        pathname: "/img/**",
      },
    ];
    expect(isAllowedRemoteUrl("https://cdn.example.com/img/a.png", p)).toBe(
      true
    );
    // Wrong protocol, wrong host, and a path outside the declared prefix.
    expect(isAllowedRemoteUrl("http://cdn.example.com/img/a.png", p)).toBe(
      false
    );
    expect(isAllowedRemoteUrl("https://other.example.com/img/a.png", p)).toBe(
      false
    );
    expect(isAllowedRemoteUrl("https://cdn.example.com/other/a.png", p)).toBe(
      false
    );
  });

  it("does not let a declared host be a suffix of an attacker's", () => {
    // The check that a naive `endsWith` fails: `evilexample.com` ends with
    // neither a dot nor the declared label boundary, and
    // `cdn.example.com.evil.test` is a different site entirely.
    const p = [{ hostname: "example.com" }];
    expect(isAllowedRemoteUrl("https://evilexample.com/a.png", p)).toBe(false);
    expect(isAllowedRemoteUrl("https://example.com.evil.test/a.png", p)).toBe(
      false
    );
    expect(isAllowedRemoteUrl("https://example.com/a.png", p)).toBe(true);
  });

  it("reads a hostname glob exactly as next/image does", () => {
    // Verified against the picomatch build Next.js ships and calls from
    // `matchRemotePattern`. `*` is NOT one label here — picomatch has no path
    // separator to stop at in a hostname, so it spans dots. An earlier
    // hand-rolled matcher made `*` single-label, which is a defensible reading
    // and the wrong one: this type says a `next.config` entry can be copied
    // across, so matching has to be what that entry already means.
    const one = [{ hostname: "*.example.com" }];
    expect(isAllowedRemoteUrl("https://a.example.com/x", one)).toBe(true);
    expect(isAllowedRemoteUrl("https://a.b.example.com/x", one)).toBe(true);

    const deep = [{ hostname: "**.example.com" }];
    expect(isAllowedRemoteUrl("https://a.b.example.com/x", deep)).toBe(true);
    // Neither form matches the bare apex, which is what the leading dot says.
    expect(isAllowedRemoteUrl("https://example.com/x", deep)).toBe(false);
  });

  it("matches a terminal ** against the prefix path itself", () => {
    // `/img/**` accepts `/img` in Next.js, and a matcher that required a
    // remaining segment dropped a background the published config allowed.
    const p = [{ hostname: "cdn.example", pathname: "/img/**" }];
    for (const url of [
      "https://cdn.example/img",
      "https://cdn.example/img/",
      "https://cdn.example/img/a.png",
      "https://cdn.example/img/a/b.png",
    ]) {
      expect(isAllowedRemoteUrl(url, p), url).toBe(true);
    }
    // But not a sibling that merely starts with the same characters.
    expect(isAllowedRemoteUrl("https://cdn.example/imgfoo", p)).toBe(false);
  });

  it("admits only http and https, even when the pattern names neither", () => {
    // `RemotePattern.protocol` can only say http or https, so omitting it means
    // "either of those" rather than "any scheme". Skipping the check when it
    // was omitted let a host-only pattern admit schemes the type cannot even
    // express.
    const hostOnly = [{ hostname: "example.com" }];
    for (const url of [
      "ftp://example.com/x",
      "file://example.com/x",
      "ws://example.com/x",
    ]) {
      expect(isAllowedRemoteUrl(url, hostOnly)).toBe(false);
    }
    expect(isAllowedRemoteUrl("https://example.com/x", hostOnly)).toBe(true);
    expect(isAllowedRemoteUrl("http://example.com/x", hostOnly)).toBe(true);
  });

  it("reads a pathname wildcard as Next.js does", () => {
    // `pathname: "/img/*"` is a shape Next.js accepts, and this type advertises
    // that a config copies straight across. Treating anything without a
    // trailing `/**` as a literal made that config silently stop matching, and
    // the image vanished with no explanation.
    const one = [{ hostname: "cdn.example", pathname: "/img/*" }];
    expect(isAllowedRemoteUrl("https://cdn.example/img/a.png", one)).toBe(true);
    expect(isAllowedRemoteUrl("https://cdn.example/img/a/b.png", one)).toBe(
      false
    );
    const deep = [{ hostname: "cdn.example", pathname: "/img/**" }];
    expect(isAllowedRemoteUrl("https://cdn.example/img/a/b.png", deep)).toBe(
      true
    );
  });

  it("refuses a value whose fallback it could not read", () => {
    // `var(--missing, url("https://…"))` puts the fallback in a `Raw` node, and
    // the browser substitutes it in. A walk that skipped `Raw` emitted the
    // request while reporting the value clean.
    const node = makeNode(
      "core/container",
      {},
      {
        base: {
          filters: 'var(--missing, url("https://evil.example/f.svg#x"))',
        },
      }
    );
    expect(compileNodeCss(node)).not.toContain("evil.example");
    expect(
      compileNodeCss(node, {
        remotePatterns: [{ protocol: "https", hostname: "evil.example" }],
      })
    ).toContain("evil.example");
    // Nested one level further, since the re-parse recurses.
    expect(
      compileNodeCss(
        makeNode(
          "core/container",
          {},
          {
            base: {
              filters: 'var(--a, var(--b, url("https://evil.example/g.svg")))',
            },
          }
        )
      )
    ).not.toContain("evil.example");
    // A fallback with nothing remote in it survives.
    expect(
      compileNodeCss(
        makeNode(
          "core/container",
          {},
          { base: { filters: "var(--blur, blur(2px))" } }
        )
      )
    ).toContain("var(--blur, blur(2px))");
  });

  it("accepts a URL entry, as next.config does", () => {
    // `remotePatterns: [new URL("https://cdn.example/img/**")]` is a supported
    // Next.js form, and a URL already carries every field this matches on. Its
    // protocol keeps a trailing colon, so the comparison strips one from both
    // sides rather than appending one.
    const p = [new URL("https://cdn.example/img/**")];
    expect(isAllowedRemoteUrl("https://cdn.example/img/a.png", p)).toBe(true);
    expect(isAllowedRemoteUrl("https://cdn.example/other/a.png", p)).toBe(
      false
    );
    expect(isAllowedRemoteUrl("http://cdn.example/img/a.png", p)).toBe(false);
    expect(isAllowedRemoteUrl("https://other.example/img/a.png", p)).toBe(
      false
    );
  });

  it("allows nothing when nothing is declared", () => {
    expect(isAllowedRemoteUrl("https://cdn.example.com/a.png", [])).toBe(false);
  });
});
