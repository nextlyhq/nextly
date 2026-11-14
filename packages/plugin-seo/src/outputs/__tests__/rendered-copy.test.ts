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
 * - the head's title and description are read for the front matter;
 * - content a page streams in after its fallback (React Suspense) is read in
 *   the fallback's place, as the browser shows it once loaded;
 * - a list item made of paragraphs keeps its marker, and its later blocks
 *   stay inside it;
 * - a script or style is read as raw text: markup inside it closes nothing,
 *   not even the main content's own closing tag;
 * - a heading taken from above `<main>` is one a reader sees, and a line of
 *   code is never taken for one;
 * - code is copied verbatim, never tidied as prose is, its own blank lines
 *   and trailing spaces kept, and a line break drawn with `<br>` kept;
 * - markup inside code adds no Markdown to it, and a bar in code in a table
 *   cell is escaped, so it does not end the cell;
 * - a `<main>` a reader never sees, hidden itself or by what holds it, is
 *   not the page's main content;
 * - a line break or a list in a table cell keeps the cell's row on one line;
 * - prose that Markdown would read again as a block or a character
 *   reference is escaped;
 * - a list nested in a numbered item is indented to that item's content, at
 *   every depth;
 * - a long page is written in time that grows with its length, not its
 *   square;
 * - an ordered list keeps the number it starts at, a table's header line
 *   has one cell per header cell, and blocks in a cell stay apart.
 */
import { createElement as h, Suspense, type ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderedCopyOf } from "../rendered-copy";

const BASE = "https://acme.example/pricing";

const page = (head: string, body: string) =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("a copy made from the rendered page", () => {
  it("writes the main content's blocks as Markdown, in order", () => {
    const html = page(
      '<title>Pricing | Acme</title><meta name="description" content="Plans &amp; prices.">',
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

  it("reads streamed content in place of its fallback, as the loaded page shows it", async () => {
    // A real streamed render: each Suspense boundary's fallback comes first,
    // its content later in a hidden container React's script moves in.
    const later = (ms: number) => {
      let ready = false;
      const waiting = new Promise<void>(resolve =>
        setTimeout(() => {
          ready = true;
          resolve();
        }, ms)
      );
      return (content: ReactNode) => {
        const Later = (): ReactNode => {
          if (!ready) throw waiting;
          return content;
        };
        return h(Later);
      };
    };
    const prices = later(10);
    const plans = later(20);
    const app = h(
      "html",
      null,
      h(
        "body",
        null,
        h(
          "main",
          null,
          h("h1", null, "Pricing"),
          h(
            Suspense,
            { fallback: h("p", null, "Loading...") },
            prices(
              h(
                "section",
                null,
                h("h2", null, "Plans"),
                h(
                  Suspense,
                  { fallback: h("p", null, "Loading plans...") },
                  plans(h("p", null, "Starter is $9 a month."))
                )
              )
            )
          ),
          h("p", null, "Billed monthly.")
        )
      )
    );
    const html = await new Response(await renderToReadableStream(app)).text();
    expect(html).toContain('<div hidden id="S:0">');
    expect(renderedCopyOf(html, BASE).body).toBe(
      "# Pricing\n\n## Plans\n\nStarter is $9 a month.\n\nBilled monthly."
    );
  });

  it("keeps a list item's marker where the item is made of paragraphs", () => {
    const html = page(
      "",
      `<main>
         <ul><li><p>First</p></li><li><p>Second</p><p>More of it.</p></li></ul>
         <ol><li><div><p>One</p></div></li><li><p>Two</p></li></ol>
       </main>`
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      "- First\n\n- Second\n\n  More of it.\n\n1. One\n\n2. Two"
    );
  });

  it("reads a script or style as raw text, whatever markup it holds", () => {
    const html = page(
      "",
      `<main><div><script>const tag = "</div>"; const greeting = "hello";</script><style>p::after { content: "</p>"; }</style><p>Visible words.</p></div></main>`
    );
    expect(renderedCopyOf(html, BASE).body).toBe("Visible words.");
  });

  it("copies code verbatim, never tidied as prose is", () => {
    const code = "const list = `first  \n-\n1.\n\n\n\nlast`;";
    const html = page(
      "",
      `<main><p>Example:</p><pre><code>${code}</code></pre><blockquote><pre>a\n\nb</pre></blockquote></main>`
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      `Example:\n\n\`\`\`\n${code}\n\`\`\`\n\n> \`\`\`\n> a\n>\n> b\n> \`\`\``
    );
  });

  it("finds the main content past a script that names its closing tag", () => {
    const html = page(
      "",
      '<main><h1>Title</h1><script>const tag = "</main>";</script><p>Visible.</p></main>'
    );
    expect(renderedCopyOf(html, BASE).body).toBe("# Title\n\nVisible.");
  });

  it("begins with a heading from above the main content only where a reader sees it", () => {
    const html = page(
      "",
      `<div hidden><h1>Hidden promotion</h1></div>
       <nav><h1>Menu</h1></nav>
       <header><h1>Shown</h1></header>
       <main><p>Visible.</p></main>`
    );
    expect(renderedCopyOf(html, BASE).body).toBe("# Shown\n\nVisible.");
  });

  it("never takes a line of code for the page's heading", () => {
    const html = page(
      "",
      "<header><h1>Install</h1></header><main><pre># add it\nnpm i acme</pre></main>"
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      "# Install\n\n```\n# add it\nnpm i acme\n```"
    );
  });

  it("keeps code's own leading blank lines and trailing spaces", () => {
    const html = page("", "<main><pre>\n\n  indented  \nlast  \n</pre></main>");
    expect(renderedCopyOf(html, BASE).body).toBe(
      "```\n\n  indented  \nlast  \n```"
    );
  });

  it("never takes a main a reader does not see for the page's content", () => {
    const html = page(
      "",
      `<div hidden><main><h1>Hidden draft</h1><p>Not visible, and longer than the page itself.</p></main></div>
       <main><h1>Shown</h1><p>Visible.</p></main>`
    );
    expect(renderedCopyOf(html, BASE).body).toBe("# Shown\n\nVisible.");
  });

  it("escapes prose Markdown would read again as a block or a character reference", () => {
    const html = page(
      "",
      `<main>
         <p># Literal heading marker</p>
         <p>&amp;copy; stays as written.</p>
         <p>1. Not a list</p>
         <ul><li># Not a heading</li></ul>
       </main>`
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      [
        "\\# Literal heading marker",
        "\\&copy; stays as written.",
        "1\\. Not a list",
        "- \\# Not a heading",
      ].join("\n\n")
    );
  });

  it("keeps an ordered list's starting number", () => {
    const html = page(
      "",
      '<main><ol start="5"><li>Deploy</li><li>Verify</li></ol></main>'
    );
    expect(renderedCopyOf(html, BASE).body).toBe("5. Deploy\n6. Verify");
  });

  it("writes one header line cell per header cell, and keeps blocks in a cell apart", () => {
    const html = page(
      "",
      `<main><table>
         <tr><th>A | B</th><th>C</th></tr>
         <tr><td><p>First paragraph.</p><p>Second paragraph.</p></td><td>2</td></tr>
       </table></main>`
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      "| A \\| B | C |\n| --- | --- |\n| First paragraph. Second paragraph. | 2 |"
    );
  });

  it("indents a list nested in a numbered item to that item's content, at every depth", () => {
    const html = page(
      "",
      "<main><ol><li>Outer<ol><li>Inner<ol><li>Deep</li></ol></li></ol><ul><li>Note</li></ul></li></ol></main>"
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      "1. Outer\n   1. Inner\n      1. Deep\n   - Note"
    );
  });

  it("writes a long page in time that grows with its length, not its square", () => {
    // About 860 KB of paragraphs: well inside the 6 MB a page may be. Read
    // again whole at every block, as one string, it took tens of seconds.
    const words = `<p>${"word ".repeat(20)}</p>`.repeat(8000);
    const started = performance.now();
    const copy = renderedCopyOf(page("", `<main>${words}</main>`), BASE);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(copy.body.split("\n\n")).toHaveLength(8000);
  });

  it("never takes a main hidden itself for the page's content, however long", () => {
    const html = page(
      "",
      "<main><h1>Shown</h1><p>Visible</p></main><main hidden><h1>Hidden longer title</h1><p>Long hidden words should not win</p></main>"
    );
    expect(renderedCopyOf(html, BASE).body).toBe("# Shown\n\nVisible");
  });

  it("keeps a table row on one line where a cell holds a line break", () => {
    const html = page(
      "",
      "<main><table><tr><td>A<br>B</td><td>C</td></tr></table></main>"
    );
    expect(renderedCopyOf(html, BASE).body).toBe("| A B | C |\n| --- | --- |");
  });

  it("keeps the line breaks code draws with <br>, each one", () => {
    const html = page(
      "",
      "<main><pre><code>first<br/>second<br><br>  third</code></pre></main>"
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      "```\nfirst\nsecond\n\n  third\n```"
    );
  });

  it("adds no Markdown to code for the markup inside it", () => {
    const html = page(
      "",
      "<main><pre><code>const <strong>value</strong> = 1;</code></pre><p>Run <code><strong>acme</strong> <em>init</em></code>.</p></main>"
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      "```\nconst value = 1;\n```\n\nRun `acme init`."
    );
  });

  it("escapes a bar in code in a table cell, so the cell holds all of it", () => {
    const html = page(
      "",
      "<main><table><tr><th>Command</th></tr><tr><td><code>echo hello | cat</code></td></tr></table><p><code>a | b</code></p></main>"
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      "| Command |\n| --- |\n| `echo hello \\| cat` |\n\n`a | b`"
    );
  });

  it("keeps a table row on one line where a cell holds a list", () => {
    const html = page(
      "",
      "<main><table><tr><th>Plan</th><th>Features</th></tr><tr><td>Basic</td><td><ul><li>One</li><li>Two</li></ul></td></tr></table></main>"
    );
    expect(renderedCopyOf(html, BASE).body).toBe(
      "| Plan | Features |\n| --- | --- |\n| Basic | - One - Two |"
    );
  });
});
