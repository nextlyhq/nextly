// @vitest-environment jsdom
/**
 * The plugin's own script on a page drawing one of its forms, run in a
 * document: what it does before Google's or Cloudflare's script has loaded,
 * and the browser token it makes for one response per browser.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { BOT_CHECK_SCRIPT } from "./bot-check-script";

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).turnstile;
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  delete (window as unknown as Record<string, unknown>).grecaptcha;
  localStorage.clear();
});

/** Run the module's body in this document. */
function run(): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(BOT_CHECK_SCRIPT)();
}

describe("the forms plugin's page script", () => {
  it("holds a reCAPTCHA form's send until its token is made, even before Google's script loads", async () => {
    document.body.innerHTML = `<form><input type="hidden" name="g-recaptcha-response" value="" data-forms-bot-check="recaptcha" data-forms-site-key="site-1"></form>`;
    const form = document.querySelector("form") as HTMLFormElement;
    const send = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => undefined);
    const posted = () => send.mock.calls.length;
    run();
    // Sent before the widget's script has loaded: held, not posted empty.
    const early = new Event("submit", { cancelable: true });
    form.dispatchEvent(early);
    expect(early.defaultPrevented).toBe(true);
    expect(posted()).toBe(0);

    // The script arrives; the send goes on with its token.
    (window as unknown as Record<string, unknown>).grecaptcha = {
      ready: (callback: () => void) => callback(),
      execute: async () => "token-1",
    };
    const tag = document.head.querySelector("script");
    tag?.dispatchEvent(new Event("load"));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect((document.querySelector("input") as HTMLInputElement).value).toBe(
      "token-1"
    );
    expect(posted()).toBe(1);
  });

  it("fills a browser token, the same one each time on this browser", () => {
    const draw = () => {
      document.body.innerHTML = `<form><input type="hidden" name="nextly-browser-token" value="" data-forms-browser-token=""></form>`;
      run();
      return (document.querySelector("input") as HTMLInputElement).value;
    };
    const first = draw();
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(draw()).toBe(first);
  });
});

describe("a Turnstile form", () => {
  it("holds a send until the widget gives its token, then sends it once", async () => {
    document.body.innerHTML = `<form><input type="hidden" name="cf-turnstile-response" value="" data-forms-bot-check="turnstile" data-forms-site-key="site-1"></form>`;
    const form = document.querySelector("form") as HTMLFormElement;
    const send = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => undefined);
    const posted = () => send.mock.calls.length;
    let solved: ((token: string) => void) | undefined;
    (window as unknown as Record<string, unknown>).turnstile = {
      render: (
        _box: unknown,
        options: { callback: (token: string) => void }
      ) => {
        solved = options.callback;
      },
    };
    run();
    // Sent while Cloudflare's script loads or its check is pending: held.
    const early = new Event("submit", { cancelable: true });
    form.dispatchEvent(early);
    expect(early.defaultPrevented).toBe(true);
    expect(posted()).toBe(0);

    document.head.querySelector("script")?.dispatchEvent(new Event("load"));
    await new Promise(resolve => setTimeout(resolve, 0));
    solved?.("token-2");
    expect((document.querySelector("input") as HTMLInputElement).value).toBe(
      "token-2"
    );
    expect(posted()).toBe(1);
  });
});

describe("a form with a field named submit", () => {
  it("still sends, through the form's own submit, not the field", async () => {
    const send = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => undefined);
    try {
      document.body.innerHTML = `<form><input name="submit" value="x"><input type="hidden" name="cf-turnstile-response" value="" data-forms-bot-check="turnstile" data-forms-site-key="site-1"></form>`;
      let solved: ((token: string) => void) | undefined;
      (window as unknown as Record<string, unknown>).turnstile = {
        render: (
          _box: unknown,
          options: { callback: (token: string) => void }
        ) => {
          solved = options.callback;
        },
      };
      const form = document.querySelector("form") as HTMLFormElement;
      // As a browser does: a control named `submit` is the form's `submit`.
      Object.defineProperty(form, "submit", {
        value: form.querySelector('input[name="submit"]'),
      });
      run();
      form.dispatchEvent(new Event("submit", { cancelable: true }));
      document.head.querySelector("script")?.dispatchEvent(new Event("load"));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(() => solved?.("token-3")).not.toThrow();
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      send.mockRestore();
      delete (window as unknown as Record<string, unknown>).turnstile;
    }
  });
});
