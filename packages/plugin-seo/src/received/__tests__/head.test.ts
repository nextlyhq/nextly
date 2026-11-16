/**
 * What a crawler reads from a page's HTML: its title, description, social
 * card, official address and robots rules, as the page served them.
 */
import { describe, expect, it } from "vitest";

import { readHead } from "../head";

/** A page's head as a Next.js site serves it, with some body after it. */
const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Surfer SEO vs Rext AI: Which Fits? | Rext AI</title>
<meta name="description" content="Surfer scores a draft; Rext AI writes it &amp; links its sources."/>
<meta name="robots" content="index, follow"/>
<link rel="canonical" href="https://rext.ai/blog/surfer-seo-vs-rext-ai"/>
<meta property="og:title" content="Surfer SEO vs Rext AI: Which Fits?"/>
<meta property="og:description" content="Shared description"/>
<meta property="og:image" content="https://rext.ai/media/share.jpg"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="Surfer SEO vs Rext AI: Which Fits?"/>
<meta name="twitter:image" content="https://rext.ai/media/share.jpg"/>
<script>self.__next_f.push([1,"<title>Not this one</title>"])</script>
</head><body><svg><title>An icon</title></svg><h1>Surfer SEO vs Rext AI</h1></body></html>`;

describe("reading a page's head", () => {
  it("reads every value a crawler reads", () => {
    expect(readHead(PAGE)).toEqual({
      title: "Surfer SEO vs Rext AI: Which Fits? | Rext AI",
      description:
        "Surfer scores a draft; Rext AI writes it & links its sources.",
      canonical: "https://rext.ai/blog/surfer-seo-vs-rext-ai",
      robots: ["index", "follow"],
      og: {
        title: "Surfer SEO vs Rext AI: Which Fits?",
        description: "Shared description",
        image: "https://rext.ai/media/share.jpg",
        imageWidth: 1200,
        imageHeight: 630,
      },
      twitter: {
        title: "Surfer SEO vs Rext AI: Which Fits?",
        image: "https://rext.ai/media/share.jpg",
      },
    });
  });

  it("reads nothing a page does not say", () => {
    expect(readHead("<html><head></head><body>Hi</body></html>")).toEqual({
      robots: [],
      og: {},
      twitter: {},
    });
  });

  it("takes the first of a value said twice, as crawlers do", () => {
    const head = readHead(
      `<title>First</title><title>Second</title>
       <meta name="description" content="One"><meta name="description" content="Two">
       <link rel="canonical" href="/a"><link rel="canonical" href="/b">`
    );
    expect(head).toMatchObject({
      title: "First",
      description: "One",
      canonical: "/a",
    });
  });

  it("never takes a title from a script, an icon, a style or a comment", () => {
    const head = readHead(
      `<!-- <title>Commented</title> -->
       <style>/* <title>Styled</title> */</style>
       <script type="application/ld+json">{"name":"<title>Scripted</title>"}</script>
       <svg viewBox="0 0 1 1"><title>Icon</title></svg>
       <noscript><title>Noscript</title></noscript>
       <title>The page's own</title>`
    );
    expect(head.title).toBe("The page's own");
  });

  it("reads attributes however they are quoted or cased", () => {
    const head = readHead(
      `<TITLE>  Spaced
         title  </TITLE>
       <META NAME='Description' CONTENT='Single &quot;quoted&quot; &#x27;text&#39;'>
       <meta content=unquoted name=twitter:description>
       <link href="https://rext.ai/x" rel="alternate canonical">
       <meta name="googlebot" content="noindex">`
    );
    expect(head).toMatchObject({
      title: "Spaced title",
      description: `Single "quoted" 'text'`,
      canonical: "https://rext.ai/x",
      robots: ["noindex"],
      twitter: { description: "unquoted" },
    });
  });

  it("reads named characters as the characters they name", () => {
    const head = readHead(
      `<title>Caf&eacute; &ndash; news &amp; more&hellip;</title>
       <meta name="description" content="&ldquo;Fast&rdquo; &mdash; &copy; 2026 &euro;5 &nbsp;x &unknownname;">`
    );
    expect(head).toMatchObject({
      title: "Café – news & more…",
      description: "“Fast” — © 2026 €5 x &unknownname;",
    });
  });

  it("keeps a name that only an object's own methods share as written", () => {
    const head = readHead(
      `<title>The &constructor; and &toString; &hasOwnProperty; names</title>`
    );
    expect(head.title).toBe(
      "The &constructor; and &toString; &hasOwnProperty; names"
    );
  });

  it("reads a quoted value with a > in it whole", () => {
    const head = readHead(
      `<meta name="description" content="Surfer > Rext? A -> B">
       <meta property='og:title' content='Fast > slow'>
       <link href="https://rext.ai/a?b>c" rel="canonical">`
    );
    expect(head).toMatchObject({
      description: "Surfer > Rext? A -> B",
      canonical: "https://rext.ai/a?b>c",
      og: { title: "Fast > slow" },
    });
  });

  it("reads the robots rules of every robots and googlebot tag", () => {
    const head = readHead(
      `<meta name="robots" content="NOINDEX, follow"><meta name="googlebot" content="nosnippet">`
    );
    expect(head.robots).toEqual(["noindex", "follow", "nosnippet"]);
  });
});
