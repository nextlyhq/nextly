// @vitest-environment jsdom
/**
 * The plugin's own script on a page drawing one of its forms, run in a
 * document: what it does before Google's or Cloudflare's script has loaded,
 * and the browser token it makes for one response per browser.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { BOT_CHECK_SCRIPT } from "./bot-check-script";

// A browser runs the module once per page; these tests run it once per test
// in one document. Each run's observer is recorded so it stops with its test,
// rather than readying the next test's forms as a second instance.
const observers: MutationObserver[] = [];
const NativeObserver = window.MutationObserver;
window.MutationObserver = class extends NativeObserver {
  constructor(callback: MutationCallback) {
    super(callback);
    observers.push(this);
  }
};

afterEach(() => {
  for (const observer of observers.splice(0)) observer.disconnect();
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

  it("readies a form that arrives after it runs, and readies each form once", async () => {
    // The module is async and may be cached, so it can run before the body
    // is parsed or a streamed form arrives: forms added later still get their
    // browser token and their held send.
    const send = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => undefined);
    run();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<form><input type="hidden" name="nextly-browser-token" value="" data-forms-browser-token=""><input type="hidden" name="g-recaptcha-response" value="" data-forms-bot-check="recaptcha" data-forms-site-key="site-1"></form>`
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    const token = document.querySelector(
      "input[data-forms-browser-token]"
    ) as HTMLInputElement;
    expect(token.value).not.toBe("");
    const form = document.querySelector("form") as HTMLFormElement;
    const early = new Event("submit", { cancelable: true });
    form.dispatchEvent(early);
    expect(early.defaultPrevented).toBe(true);
    // Another change to the page readies nothing twice: one listener, so
    // one send once the token is made.
    document.body.append(document.createElement("p"));
    await new Promise(resolve => setTimeout(resolve, 0));
    (window as unknown as Record<string, unknown>).grecaptcha = {
      ready: (callback: () => void) => callback(),
      execute: async () => "token-1",
    };
    document.head.querySelector("script")?.dispatchEvent(new Event("load"));
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(send.mock.calls.length).toBe(1);
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

describe("a Turnstile token that expires", () => {
  it("is cleared, so a send made before the next token is held, not posted stale", async () => {
    document.body.innerHTML = `<form><input type="hidden" name="cf-turnstile-response" value="" data-forms-bot-check="turnstile" data-forms-site-key="site-1"></form>`;
    const form = document.querySelector("form") as HTMLFormElement;
    const input = document.querySelector("input") as HTMLInputElement;
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(
      () => undefined
    );
    let options: Record<string, (token?: string) => void> = {};
    (window as unknown as Record<string, unknown>).turnstile = {
      render: (_box: HTMLElement, given: typeof options) => {
        options = given;
      },
    };
    run();
    document.head.querySelector("script")?.dispatchEvent(new Event("load"));
    await new Promise(resolve => setTimeout(resolve, 0));
    options.callback?.("token-1");
    expect(input.value).toBe("token-1");
    // The token lapses: it must not be posted, since the server refuses it
    // and keeps the send as spam.
    options["expired-callback"]?.();
    expect(input.value).toBe("");
    const send = new Event("submit", { cancelable: true });
    form.dispatchEvent(send);
    expect(send.defaultPrevented).toBe(true);
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
