import { describe, it, expect, vi, afterEach } from "vitest";
import { isTtsEnabled, stripForTts, synthesizeToOgg, TTS_LIMIT } from "./tts.js";

// ---------------------------------------------------------------------------
// isTtsEnabled
// ---------------------------------------------------------------------------

describe("isTtsEnabled", () => {
  afterEach(() => {
    delete process.env.TTS_PROVIDER;
  });

  it("returns false when TTS_PROVIDER is not set", () => {
    expect(isTtsEnabled()).toBe(false);
  });

  it("returns true when TTS_PROVIDER=openai", () => {
    process.env.TTS_PROVIDER = "openai";
    expect(isTtsEnabled()).toBe(true);
  });

  it("is case-insensitive (OpenAI, OPENAI)", () => {
    process.env.TTS_PROVIDER = "OpenAI";
    expect(isTtsEnabled()).toBe(true);
    process.env.TTS_PROVIDER = "OPENAI";
    expect(isTtsEnabled()).toBe(true);
  });

  it("returns false for unknown provider values", () => {
    process.env.TTS_PROVIDER = "elevenlabs";
    expect(isTtsEnabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stripForTts
// ---------------------------------------------------------------------------

describe("stripForTts", () => {
  it("returns plain text unchanged", () => {
    expect(stripForTts("Hello world")).toBe("Hello world");
  });

  it("removes **bold** markers", () => {
    expect(stripForTts("**hello**")).toBe("hello");
  });

  it("removes *bold* single-asterisk markers", () => {
    expect(stripForTts("*hi*")).toBe("hi");
  });

  it("removes _italic_ markers", () => {
    expect(stripForTts("_hello_")).toBe("hello");
  });

  it("removes __underline__ before _italic_", () => {
    expect(stripForTts("__under__")).toBe("under");
  });

  it("removes ~~strikethrough~~ markers", () => {
    expect(stripForTts("~~gone~~")).toBe("gone");
  });

  it("removes ~MarkdownV2 strikethrough~ markers", () => {
    expect(stripForTts("~gone~")).toBe("gone");
  });

  it("removes inline `code` backticks but keeps content", () => {
    expect(stripForTts("`console.log()`")).toBe("console.log()");
  });

  it("removes fenced code block fences but keeps code content", () => {
    expect(stripForTts("```js\nconsole.log('hi');\n```").trim()).toBe("console.log('hi');");
  });

  it("extracts link display text, discards URL", () => {
    expect(stripForTts("[click here](https://example.com)")).toBe("click here");
  });

  it("strips heading # prefixes", () => {
    expect(stripForTts("# Title")).toBe("Title");
    expect(stripForTts("## Subtitle")).toBe("Subtitle");
  });

  it("strips blockquote > markers", () => {
    expect(stripForTts("> quoted text")).toBe("quoted text");
  });

  it("unescapes MarkdownV2 escape sequences", () => {
    expect(stripForTts("Hello\\. World\\!")).toBe("Hello. World!");
  });

  it("strips HTML bold tags", () => {
    expect(stripForTts("<b>bold</b>")).toBe("bold");
  });

  it("strips HTML italic tags", () => {
    expect(stripForTts("<i>italic</i>")).toBe("italic");
  });

  it("strips HTML link tags keeping display text", () => {
    expect(stripForTts('<a href="https://x.com">link</a>')).toBe("link");
  });

  it("strips HTML code and pre tags", () => {
    expect(stripForTts("<code>val</code>")).toBe("val");
    expect(stripForTts("<pre>block</pre>")).toBe("block");
  });

  it("handles mixed formatting", () => {
    const input = "**Summary**: _done_ at [example.com](https://example.com)!";
    expect(stripForTts(input)).toBe("Summary: done at example.com!");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(stripForTts("   ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// synthesizeToOgg — error guards (no network calls)
// ---------------------------------------------------------------------------

describe("synthesizeToOgg error guards", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it("throws when OPENAI_API_KEY is not set", async () => {
    await expect(synthesizeToOgg("hello")).rejects.toThrow("OPENAI_API_KEY");
  });

  it("throws for empty text", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    await expect(synthesizeToOgg("")).rejects.toThrow();
  });

  it("throws for whitespace-only text", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    await expect(synthesizeToOgg("   ")).rejects.toThrow();
  });

  it(`throws when text exceeds TTS_LIMIT (${TTS_LIMIT} chars)`, async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    await expect(synthesizeToOgg("a".repeat(TTS_LIMIT + 1))).rejects.toThrow("TTS input too long");
  });

  it("calls OpenAI API with correct parameters", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TTS_VOICE = "nova";
    process.env.TTS_MODEL = "tts-1-hd";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await synthesizeToOgg("hello");
    expect(Buffer.isBuffer(result)).toBe(true);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(opts.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(opts.body);
    expect(body.input).toBe("hello");
    expect(body.voice).toBe("nova");
    expect(body.model).toBe("tts-1-hd");
    expect(body.response_format).toBe("opus");

    vi.unstubAllGlobals();
    delete process.env.TTS_VOICE;
    delete process.env.TTS_MODEL;
  });

  it("throws a descriptive error when API returns non-ok status", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }));

    await expect(synthesizeToOgg("hello")).rejects.toThrow("401");
    vi.unstubAllGlobals();
  });
});
