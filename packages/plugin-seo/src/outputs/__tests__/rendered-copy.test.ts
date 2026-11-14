/**
 * A page's plain-text copy made from its rendered HTML: the words of its
 * main content as Markdown, and nothing a reader never sees.
 *
 * What each case pins:
 * - headings, paragraphs, lists (nested, numbered), links, quotes, code,
 *   tables and described images are written as Markdown, in order;
 * - scripts, styles, navigation, forms, dialogs and hidden elements are
 *   left out, and a page with no `<main>` loses its shared header and footer;
 * - every address is made whole against the page, an image Next.js resizes
 *   is linked at its original address, and an image with no words is left out;
 * - the longest `<main>` is read where a streamed page renders two, and a
 *   heading placed above `<main>` still begins the copy;
 * - the head's title and description are read for the front matter.
 */
import { describe, expect, it } from "vitest";

import { renderedCopyOf } from "../rendered-copy";

const BASE = "https://acme.example/pricing";

const page = (head: string, body: string) =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("a copy made from the rendered page", () => {
  it("writes the main content's blocks as Markdown, in order", () => {
    const html = page(
      "<title>Pricing | Acme</title><meta name=\"description\" content=\"Plans &amp; prices.\">",
      `<nav><a href="/">Home</a></nav>
       <main>
         <h1>Pricing</h1>
         <p>Plans for <strong>every</strong> team, <em>billed</em> monthly. See <a href="/faq">the FAQ</a>.</p>
         <ul><li>One<ul><li>One a</li></ul></li><li>Two</li></ul>
         <ol><li>First</li><li>Second</li></ol>
         <blockquote><p>Worth it.</p></blockquote>
         <pre><code>npm i acme</code></pre>
         <p>Run <code>acme init</code>.</p>
         <table><tr><th>Plan</th><th>Price</th></tr><tr><td>Starter</td><td>$9</td></tr></table>
         <img src="/_next/image?url=%2Fmedia%2Fchart.png&amp;w=640&amp;q=75" alt="A chart">
         <img src="/media/divider.png" alt="">
         <hr>
         <p>Questions? <a href="mailto:hi@acme.example">Write to us</a></p>
       </main>
       <footer>Footer words</footer>`
    );
    const copy = renderedCopyOf(html, BASE);
    expect(copy.title).toBe("Pricing | Acme");
    expect(copy.description).toBe("Plans & prices.");
    expect(copy.body).toBe(
      [
        "# Pricing",
        "Plans for **every** team, *billed* monthly. See [the FAQ](https://acme.example/faq).",
        "- One\n  - One a\n- Two",
        "1. First\n2. Second",
        "> Worth it.",
        "```\nnpm i acme\n```",
        "Run `acme init`.",
        "| Plan | Price |\n| --- | --- |\n| Starter | $9 |",
        "![A chart](https://acme.example/media/chart.png)",
        "---",
        "Questions? [Write to us](mailto:hi@acme.example)",
      ].join("\n\n")
    );
  });

  it("marks emphasis on part of a word so Markdown still reads it", () => {
    const html = page(
      "",
      "<main><p>A pre<em>fix</em>, a <i>whole</i> word, <b><i>both</i></b>.</p></main>"
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      "A pre*fix*, a *whole* word, ***both***."
    );
  });

  it("leaves out what no reader sees", () => {
    const html = page(
      "",
      `<main>
         <p>Shown.</p>
         <script>var hidden = 1;</script><style>p{}</style>
         <form><label>Email</label><input name="e"><button>Send</button></form>
         <div hidden>Hidden.</div><div aria-hidden="true">Decor.</div>
         <svg><text>Icon</text></svg>
         <dialog><p>Later.</p></dialog>
       </main>`
    );
    expect(renderedCopyOf(html, BASE).body).toBe("Shown.");
  });

  it("reads the body without its shared header and footer where there is no main", () => {
    const html = page(
      "",
      "<header>Site name</header><article><h2>Notes</h2><p>Words.</p></article><footer>Copyright</footer>"
    );
    expect(renderedCopyOf(html, BASE).body).toBe("## Notes\n\nWords.");
  });

  it("reads the longest main of a streamed page, and begins with a heading set above it", () => {
    const html = page(
      "",
      `<header><h1>Features</h1></header>
       <main><p>Loading…</p></main>
       <main><p>Keyword research before every article.</p><p>More words here.</p></main>`
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      "# Features\n\nKeyword research before every article.\n\nMore words here."
    );
  });

  it("escapes what Markdown would read as markup, and drops emphasis around a whole heading", () => {
    const html = page(
      "",
      "<main><h2><strong>Why</strong></h2><p>Put it in the &lt;head&gt; of *every* page.</p></main>"
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      "## Why\n\nPut it in the \\<head\\> of \\*every\\* page."
    );
  });

  it("keeps emphasis on parts of a heading that is not emphasised whole", () => {
    const html = page(
      "",
      "<main><h2><b>Fast</b> and <b>safe</b></h2><h3><b><i>Both</i></b></h3></main>"
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      "## **Fast** and **safe**\n\n### Both"
    );
  });
});
