import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from "vitest";
import { isTtsEnabled, stripForTts, normalizeCapsForTts, synthesizeToOgg, fetchVoiceList, TTS_LIMIT, _resetLocalPipeline, _resetElevenSpeedWarning } from "./tts.js";

// Mock @huggingface/transformers so no model is downloaded during tests
vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  env: {},
}));

// Mock the OGG encoder to avoid WASM loading in tests
vi.mock("./ogg-opus-encoder.js", () => ({
  pcmToOggOpus: vi.fn(),
}));

vi.mock("audio-decode", () => ({
  default: vi.fn(),
}));

type LocalSynthesizer = (text: string) => Promise<{
  audio: Float32Array;
  sampling_rate: number;
}>;

// ---------------------------------------------------------------------------
// isTtsEnabled
// ---------------------------------------------------------------------------

describe("isTtsEnabled", () => {
  it("always returns true — local provider is always available", () => {
    expect(isTtsEnabled()).toBe(true);
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

  it("normalizes literal \\n sequences to real newlines (MCP transport)", () => {
    // When text arrives over MCP with literal backslash-n, it should become a space/newline, not be spoken as "backslash n"
    expect(stripForTts("line one\\nline two")).toBe("line one\nline two");
  });

  it("normalizes backslash-escaped quotes (MCP transport)", () => {
    expect(stripForTts('use \\"claw\\" and \\"provisioner\\"')).toBe('use "claw" and "provisioner"');
  });
});

// ---------------------------------------------------------------------------
// normalizeCapsForTts
// ---------------------------------------------------------------------------

describe("normalizeCapsForTts", () => {
  beforeEach(() => { delete process.env.TTS_CAPS_NORMALIZE; });
  afterEach(() => {
    delete process.env.TTS_CAPS_NORMALIZE;
  });

  it("transforms SESSION_JOINED → \"session joined\"", () => {
    expect(normalizeCapsForTts("SESSION_JOINED")).toBe('"session joined"');
  });

  it("transforms PASS_WITH_FINDINGS → \"pass with findings\"", () => {
    expect(normalizeCapsForTts("PASS_WITH_FINDINGS")).toBe('"pass with findings"');
  });

  it("transforms MD_FAIL → \"md fail\"", () => {
    expect(normalizeCapsForTts("MD_FAIL")).toBe('"md fail"');
  });

  it("leaves lowercase session_joined unchanged", () => {
    expect(normalizeCapsForTts("session_joined")).toBe("session_joined");
  });

  it("leaves lowercase behavior_nudge_first_message unchanged", () => {
    expect(normalizeCapsForTts("behavior_nudge_first_message")).toBe("behavior_nudge_first_message");
  });

  it("transforms only the ALL-CAPS token in a mixed sentence", () => {
    expect(normalizeCapsForTts("Status is PASS_WITH_FINDINGS")).toBe('Status is "pass with findings"');
  });

  it("leaves ALLCAPS with no underscore unchanged", () => {
    expect(normalizeCapsForTts("ALLCAPS")).toBe("ALLCAPS");
  });

  it("transforms A_B (single letter before underscore)", () => {
    expect(normalizeCapsForTts("A_B")).toBe('"a b"');
  });

  it("skips transformation when TTS_CAPS_NORMALIZE=false", () => {
    process.env.TTS_CAPS_NORMALIZE = "false";
    expect(normalizeCapsForTts("SESSION_JOINED")).toBe("SESSION_JOINED");
  });

  it("skips transformation when TTS_CAPS_NORMALIZE=0", () => {
    process.env.TTS_CAPS_NORMALIZE = "0";
    expect(normalizeCapsForTts("MD_FAIL")).toBe("MD_FAIL");
  });

  it("transforms when TTS_CAPS_NORMALIZE is unset (default enabled)", () => {
    delete process.env.TTS_CAPS_NORMALIZE;
    expect(normalizeCapsForTts("SESSION_JOINED")).toBe('"session joined"');
  });

  it("skips transformation when TTS_CAPS_NORMALIZE=no", () => {
    process.env.TTS_CAPS_NORMALIZE = "no";
    expect(normalizeCapsForTts("SESSION_JOINED")).toBe("SESSION_JOINED");
  });

  it("skips transformation when TTS_CAPS_NORMALIZE=off", () => {
    process.env.TTS_CAPS_NORMALIZE = "off";
    expect(normalizeCapsForTts("SESSION_JOINED")).toBe("SESSION_JOINED");
  });

  it("skips transformation when TTS_CAPS_NORMALIZE=FALSE (case-insensitive)", () => {
    process.env.TTS_CAPS_NORMALIZE = "FALSE";
    expect(normalizeCapsForTts("SESSION_JOINED")).toBe("SESSION_JOINED");
  });
});

// ---------------------------------------------------------------------------
// stripForTts + normalizeCapsForTts integration
// ---------------------------------------------------------------------------

describe("stripForTts normalizeCapsForTts integration", () => {
  beforeEach(() => { delete process.env.TTS_CAPS_NORMALIZE; });
  afterEach(() => {
    delete process.env.TTS_CAPS_NORMALIZE;
  });

  it("applies normalization end-to-end: Result: PASS_WITH_FINDINGS → Result: \"pass with findings\"", () => {
    expect(stripForTts("Result: PASS_WITH_FINDINGS")).toBe('Result: "pass with findings"');
  });

  it("normalizes SESSION_JOINED inside <code> tags (TTS pronounces content, not renders it)", () => {
    expect(stripForTts("<code>SESSION_JOINED</code>")).toBe('"session joined"');
  });

  it("normalizes SESSION_JOINED inside <pre> tags (TTS pronounces content, not renders it)", () => {
    expect(stripForTts("<pre>SESSION_JOINED</pre>")).toBe('"session joined"');
  });

  it("normalizes SESSION_JOINED inside backtick inline code", () => {
    expect(stripForTts("`SESSION_JOINED`")).toBe('"session joined"');
  });

  it("normalizes SESSION_JOINED inside fenced code block", () => {
    expect(stripForTts("```\nSESSION_JOINED\n```")).toBe('"session joined"');
  });
});

// ---------------------------------------------------------------------------
// synthesizeToOgg — shared input guards (provider-agnostic)
// ---------------------------------------------------------------------------

describe("synthesizeToOgg input guards", () => {
  it("throws for empty text (before provider check)", async () => {
    await expect(synthesizeToOgg("")).rejects.toThrow("must not be empty");
  });

  it("throws for whitespace-only text", async () => {
    await expect(synthesizeToOgg("   ")).rejects.toThrow("must not be empty");
  });

  it(`throws when text exceeds TTS_LIMIT (${TTS_LIMIT} chars)`, async () => {
    await expect(synthesizeToOgg("a".repeat(TTS_LIMIT + 1))).rejects.toThrow("TTS input too long");
  });
});

// ---------------------------------------------------------------------------
// synthesizeToOgg — OpenAI provider (no network calls)
// ---------------------------------------------------------------------------

describe("synthesizeToOgg (openai provider)", () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
  });

  it("routes to OpenAI when OPENAI_API_KEY is set (no TTS_HOST)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.TTS_VOICE = "nova";
    process.env.TTS_MODEL = "tts-1-hd";

    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakePcm = new Float32Array([0.05, -0.05, 0.0]);
    vi.mocked(decode).mockResolvedValue({
      sampleRate: 24000,
      channelData: [fakePcm],
    });
    const fakeOgg = Buffer.from("fake-ogg");
    vi.mocked(pcmToOggOpus).mockResolvedValue(fakeOgg);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await synthesizeToOgg("hello");
    expect(result).toBe(fakeOgg);
    expect(pcmToOggOpus).toHaveBeenCalledWith(fakePcm, 24000);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(opts.headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(opts.body);
    expect(body.input).toBe("hello");
    expect(body.voice).toBe("nova");
    expect(body.model).toBe("tts-1-hd");
    expect(body.response_format).toBe("wav");

    delete process.env.TTS_VOICE;
    delete process.env.TTS_MODEL;
  });

  it("throws a descriptive error when API returns non-ok status", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    }));

    await expect(synthesizeToOgg("hello")).rejects.toThrow("401");
  });
});

// ---------------------------------------------------------------------------
// synthesizeToOgg — HTTP provider (TTS_HOST)
// ---------------------------------------------------------------------------

describe("synthesizeToOgg (TTS_HOST provider)", () => {
  afterEach(() => {
    delete process.env.TTS_HOST;
    delete process.env.TTS_VOICE;
    delete process.env.TTS_MODEL;
    delete process.env.TTS_FORMAT;
    vi.unstubAllGlobals();
  });

  it("calls TTS_HOST /v1/audio/speech with model and voice when set", async () => {
    process.env.TTS_HOST = "http://myserver.local:8080";
    process.env.TTS_MODEL = "chatterbox";
    process.env.TTS_VOICE = "default";

    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakePcm = new Float32Array([0.1, -0.1, 0.0]);
    vi.mocked(decode).mockResolvedValue({
      sampleRate: 24000,
      channelData: [fakePcm],
    });
    const fakeOgg = Buffer.from("fake-ogg");
    vi.mocked(pcmToOggOpus).mockResolvedValue(fakeOgg);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await synthesizeToOgg("hello");
    expect(result).toBe(fakeOgg);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://myserver.local:8080/v1/audio/speech");
    const body = JSON.parse(opts.body);
    expect(body.input).toBe("hello");
    expect(body.model).toBe("chatterbox");
    expect(body.voice).toBe("default");
    expect(body.response_format).toBe("wav");
  });

  it("strips trailing slash from TTS_HOST", async () => {
    process.env.TTS_HOST = "http://myserver.local/";

    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    vi.mocked(decode).mockResolvedValue({
      sampleRate: 24000,
      channelData: [new Float32Array(1)],
    });
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("test");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://myserver.local/v1/audio/speech");
  });

  it("omits model and voice from body when not set", async () => {
    process.env.TTS_HOST = "http://myserver.local";
    // TTS_MODEL and TTS_VOICE not set

    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(decode).mockResolvedValue({ sampleRate: 24000, channelData: [new Float32Array(1)] });
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    const mockFetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("test");

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.model).toBeUndefined();
    expect(body.voice).toBeUndefined();
  });

  it("throws a descriptive error when TTS_HOST returns non-ok status", async () => {
    process.env.TTS_HOST = "http://myserver.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    }));

    await expect(synthesizeToOgg("hello")).rejects.toThrow("500");
  });

  it("returns buffer directly when TTS_FORMAT=opus (skips decode+re-encode)", async () => {
    process.env.TTS_HOST = "http://myserver.local";
    process.env.TTS_FORMAT = "opus";

    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.clearAllMocks(); // reset call counts from prior tests

    // Use an isolated ArrayBuffer so Buffer.from(arrayBuffer) in the impl
    // produces exactly the same bytes (pooled buffers have extra padding).
    const bytes = Buffer.from("fake-native-ogg");
    const arrBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const fakeOgg = Buffer.from(arrBuf);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrBuf),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await synthesizeToOgg("hello");

    // Buffer returned directly — decode and pcmToOggOpus must NOT be called
    expect(decode).not.toHaveBeenCalled();
    expect(pcmToOggOpus).not.toHaveBeenCalled();
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).response_format).toBe("opus");
    expect(result).toEqual(fakeOgg);
  });

  it("returns buffer directly when TTS_FORMAT=ogg", async () => {
    process.env.TTS_HOST = "http://myserver.local";
    process.env.TTS_FORMAT = "ogg";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(Buffer.from("fake-ogg").buffer),
    });
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("hello");

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).response_format).toBe("ogg");
  });

  it("works with Kokoro: base path in TTS_HOST, ogg format, voice, no model", async () => {
    // Mirrors a Kokoro config:
    //   TTS_HOST=http://your-kokoro-server/kokoro
    //   TTS_FORMAT=ogg
    //   TTS_VOICE=af_heart
    // Expected URL: POST http://your-kokoro-server/kokoro/v1/audio/speech
    // Expected body: { input, response_format: "ogg", voice: "af_heart" }  — no model field
    process.env.TTS_HOST = "http://your-kokoro-server/kokoro";
    process.env.TTS_FORMAT = "ogg";
    process.env.TTS_VOICE = "af_heart";

    const bytes = Buffer.from("fake-kokoro-ogg");
    const arrBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: () => Promise.resolve(arrBuf) });
    vi.stubGlobal("fetch", mockFetch);

    const result = await synthesizeToOgg("hello kokoro");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("http://your-kokoro-server/kokoro/v1/audio/speech");
    const body = JSON.parse(opts.body);
    expect(body.input).toBe("hello kokoro");
    expect(body.response_format).toBe("ogg");
    expect(body.voice).toBe("af_heart");
    expect(body.model).toBeUndefined();
    expect(opts.headers["Authorization"]).toBeUndefined();
    // OGG passthrough — result is the raw buffer from the server
    expect(result).toEqual(Buffer.from(arrBuf));
  });

  it("includes speed in the request body when speed is provided and not 1.0", async () => {
    process.env.TTS_HOST = "http://myserver.local";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);
    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(decode).mockResolvedValue({ sampleRate: 24000, channelData: [new Float32Array(1)] });
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    await synthesizeToOgg("hello", undefined, 1.5);

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.speed).toBe(1.5);
  });

  it("omits speed from the request body when speed is not provided", async () => {
    process.env.TTS_HOST = "http://myserver.local";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);
    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(decode).mockResolvedValue({ sampleRate: 24000, channelData: [new Float32Array(1)] });
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    await synthesizeToOgg("hello");

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.speed).toBeUndefined();
  });

  it("omits speed from the request body when speed is exactly 1.0", async () => {
    process.env.TTS_HOST = "http://myserver.local";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);
    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(decode).mockResolvedValue({ sampleRate: 24000, channelData: [new Float32Array(1)] });
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    await synthesizeToOgg("hello", undefined, 1.0);

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.speed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// synthesizeToOgg — local provider (mocked HF + OGG encoder)
// ---------------------------------------------------------------------------

describe("synthesizeToOgg (local provider)", () => {
  beforeEach(() => {
    _resetLocalPipeline();
  });

  afterEach(() => {
    delete process.env.TTS_MODEL_LOCAL;
    _resetLocalPipeline();
    vi.clearAllMocks();
  });

  it("calls HuggingFace pipeline and pcmToOggOpus, returns a Buffer", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakePcm = new Float32Array([0.1, -0.1, 0.0]);
    const fakeSynthesizer = vi.fn().mockResolvedValue({ audio: fakePcm, sampling_rate: 16000 });
    (vi.mocked(pipeline) as unknown as Mock<(...args: unknown[]) => Promise<unknown>>)
      .mockResolvedValue(fakeSynthesizer as unknown as LocalSynthesizer);

    const fakeOgg = Buffer.from("fake-ogg");
    vi.mocked(pcmToOggOpus).mockResolvedValue(fakeOgg);

    const result = await synthesizeToOgg("hello");

    expect(fakeSynthesizer).toHaveBeenCalledWith("hello");
    expect(pcmToOggOpus).toHaveBeenCalledWith(fakePcm, 16000);
    expect(result).toBe(fakeOgg);
  });

  it("passes TTS_MODEL_LOCAL to the pipeline constructor", async () => {
    process.env.TTS_MODEL_LOCAL = "custom/model";
    const { pipeline } = await import("@huggingface/transformers");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakeSynthesizer = vi.fn<LocalSynthesizer>().mockResolvedValue({
      audio: new Float32Array(1),
      sampling_rate: 22050,
    });
    (vi.mocked(pipeline) as unknown as Mock<(...args: unknown[]) => Promise<unknown>>)
      .mockResolvedValue(fakeSynthesizer as unknown as LocalSynthesizer);
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    await synthesizeToOgg("test");

    expect(pipeline).toHaveBeenCalledWith("text-to-speech", "custom/model");
  });

  it("reuses the pipeline singleton across calls", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakeSynthesizer = vi.fn<LocalSynthesizer>().mockResolvedValue({
      audio: new Float32Array(1),
      sampling_rate: 16000,
    });
    (vi.mocked(pipeline) as unknown as Mock<(...args: unknown[]) => Promise<unknown>>)
      .mockResolvedValue(fakeSynthesizer as unknown as LocalSynthesizer);
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    await synthesizeToOgg("first call");
    await synthesizeToOgg("second call");

    // pipeline() constructor must be called only once (singleton)
    expect(pipeline).toHaveBeenCalledTimes(1);
    // but the synthesizer itself is called once per synthesis
    expect(fakeSynthesizer).toHaveBeenCalledTimes(2);
  });

  it("uses local provider when neither TTS_HOST nor OPENAI_API_KEY is set", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");

    const fakeSynthesizer = vi.fn<LocalSynthesizer>().mockResolvedValue({
      audio: new Float32Array(1),
      sampling_rate: 16000,
    });
    (vi.mocked(pipeline) as unknown as Mock<(...args: unknown[]) => Promise<unknown>>)
      .mockResolvedValue(fakeSynthesizer as unknown as LocalSynthesizer);
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    const result = await synthesizeToOgg("hello");
    expect(fakeSynthesizer).toHaveBeenCalledWith("hello");
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchVoiceList
// ---------------------------------------------------------------------------

describe("fetchVoiceList", () => {
  afterEach(() => {
    delete process.env.TTS_HOST;
    delete process.env.TTS_VOICES_URL;
    vi.unstubAllGlobals();
  });

  it("returns empty array when TTS_HOST is not set", async () => {
    const result = await fetchVoiceList();
    expect(result).toEqual([]);
  });

  it("returns empty array when fetch returns non-ok status", async () => {
    process.env.TTS_HOST = "http://kokoro.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const result = await fetchVoiceList();
    expect(result).toEqual([]);
  });

  it("returns empty array when fetch throws", async () => {
    process.env.TTS_HOST = "http://kokoro.local";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const result = await fetchVoiceList();
    expect(result).toEqual([]);
  });

  it("uses TTS_VOICES_URL override when set", async () => {
    process.env.TTS_HOST = "http://kokoro.local";
    process.env.TTS_VOICES_URL = "http://other-host/voices";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    vi.stubGlobal("fetch", mockFetch);
    await fetchVoiceList();
    expect(mockFetch.mock.calls[0][0]).toBe("http://other-host/voices");
  });

  it("parses { voices: [{ voice_id, name, language, gender }] } (Kokoro-style)", async () => {
    process.env.TTS_HOST = "http://kokoro.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        voices: [{ voice_id: "af_heart", name: "Heart", language: "en", gender: "female" }],
      }),
    }));
    const result = await fetchVoiceList();
    expect(result).toEqual([{ name: "af_heart", description: "Heart", language: "en", gender: "female" }]);
  });

  it("parses { voices: [{ name }] } (plain objects)", async () => {
    process.env.TTS_HOST = "http://kokoro.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ voices: [{ name: "nova" }, { name: "echo" }] }),
    }));
    const result = await fetchVoiceList();
    expect(result.map(v => v.name)).toEqual(["nova", "echo"]);
  });

  it("parses { voices: ['name', ...] } (string list)", async () => {
    process.env.TTS_HOST = "http://kokoro.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ voices: ["alloy", "shimmer"] }),
    }));
    const result = await fetchVoiceList();
    expect(result.map(v => v.name)).toEqual(["alloy", "shimmer"]);
  });

  it("parses bare array [{ id }] (OpenAI models-style via data key)", async () => {
    process.env.TTS_HOST = "http://openai.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: "tts-1" }, { id: "tts-1-hd" }] }),
    }));
    const result = await fetchVoiceList();
    expect(result.map(v => v.name)).toEqual(["tts-1", "tts-1-hd"]);
  });

  it("parses bare string array", async () => {
    process.env.TTS_HOST = "http://myserver.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(["voice-a", "voice-b"]),
    }));
    const result = await fetchVoiceList();
    expect(result.map(v => v.name)).toEqual(["voice-a", "voice-b"]);
  });

  it("returns empty array for unknown response shape", async () => {
    process.env.TTS_HOST = "http://myserver.local";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ unknown: "structure" }),
    }));
    const result = await fetchVoiceList();
    expect(result).toEqual([]);
  });

  it("strips trailing slash from TTS_HOST before building voices URL", async () => {
    process.env.TTS_HOST = "http://kokoro.local/";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    vi.stubGlobal("fetch", mockFetch);
    await fetchVoiceList();
    expect(mockFetch.mock.calls[0][0]).toBe("http://kokoro.local/v1/audio/voices");
  });
});

// ---------------------------------------------------------------------------
// ElevenLabs provider
// ---------------------------------------------------------------------------

describe("synthesizeToOgg (ElevenLabs provider)", () => {
  beforeEach(() => {
    _resetElevenSpeedWarning();
  });

  afterEach(() => {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_VOICE_ID;
    delete process.env.ELEVENLABS_MODEL_ID;
    delete process.env.ELEVENLABS_DEFAULT_SPEED;
    // Make sure no fallback provider env vars leak in either direction
    delete process.env.TTS_HOST;
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
  });

  /** Build a minimal valid PCM-16 LE buffer (4 samples). */
  function fakePcmResponse(): { arrayBuffer: () => Promise<ArrayBuffer>; ok: true } {
    // 4 int16 samples LE: [100, -200, 0, 32000]
    const buf = Buffer.from([100, 0, 0x38, 0xff, 0, 0, 0x00, 0x7d]);
    const arr = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return { ok: true, arrayBuffer: () => Promise.resolve(arr) };
  }

  it("routes to ElevenLabs when ELEVENLABS_API_KEY is set, even with TTS_HOST also set", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";
    process.env.TTS_HOST = "http://kokoro.local"; // would otherwise win

    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.from("eleven-ogg"));

    const mockFetch = vi.fn().mockResolvedValue(fakePcmResponse());
    vi.stubGlobal("fetch", mockFetch);

    const result = await synthesizeToOgg("hello", "voice123abcvoice123abcv");

    expect(result).toEqual(Buffer.from("eleven-ogg"));
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice123abcvoice123abcv?output_format=pcm_16000"
    );
    expect(opts.headers["xi-api-key"]).toBe("sk_eleven_test");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(opts.body);
    expect(body.text).toBe("hello");
    expect(body.model_id).toBe("eleven_multilingual_v2");
    // Default ElevenLabs speed is 1.2 (configurable via ELEVENLABS_DEFAULT_SPEED).
    expect(body.voice_settings.speed).toBe(1.2);
  });

  it("uses ELEVENLABS_VOICE_ID when no voice arg is passed", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";
    process.env.ELEVENLABS_VOICE_ID = "envVoiceId";

    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.from("ogg"));
    const mockFetch = vi.fn().mockResolvedValue(fakePcmResponse());
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("hi");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/v1/text-to-speech/envVoiceId");
  });

  it("falls back to hardcoded Rachel when no voice arg and no ELEVENLABS_VOICE_ID", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";

    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.from("ogg"));
    const mockFetch = vi.fn().mockResolvedValue(fakePcmResponse());
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("hi");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM");
  });

  it("uses ELEVENLABS_MODEL_ID override when set", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";
    process.env.ELEVENLABS_MODEL_ID = "eleven_turbo_v2_5";

    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.from("ogg"));
    const mockFetch = vi.fn().mockResolvedValue(fakePcmResponse());
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("hi");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model_id).toBe("eleven_turbo_v2_5");
  });

  it("clamps speed below 0.7 and above 1.2 silently (with one stderr warning)", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";

    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.from("ogg"));
    const mockFetch = vi.fn().mockResolvedValue(fakePcmResponse());
    vi.stubGlobal("fetch", mockFetch);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await synthesizeToOgg("a", undefined, 4.0);
    await synthesizeToOgg("b", undefined, 0.1);
    await synthesizeToOgg("c", undefined, 1.0); // in-range — no warning

    const speeds = mockFetch.mock.calls.map(c => JSON.parse((c[1] as { body: string }).body).voice_settings.speed);
    expect(speeds).toEqual([1.2, 0.7, 1.0]);
    // Exactly one clamp warning (the second clamp is silenced)
    const clampWarnings = stderrSpy.mock.calls.filter(c => String(c[0]).includes("speed clamped"));
    expect(clampWarnings).toHaveLength(1);

    stderrSpy.mockRestore();
  });

  it("uses ELEVENLABS_DEFAULT_SPEED env override when speed is not specified", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";
    process.env.ELEVENLABS_DEFAULT_SPEED = "0.9";

    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.from("ogg"));
    const mockFetch = vi.fn().mockResolvedValue(fakePcmResponse());
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("hi");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.voice_settings.speed).toBe(0.9);
  });

  it("clamps an out-of-range ELEVENLABS_DEFAULT_SPEED into the supported window", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";
    process.env.ELEVENLABS_DEFAULT_SPEED = "5.0"; // way over 1.2

    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.from("ogg"));
    const mockFetch = vi.fn().mockResolvedValue(fakePcmResponse());
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("hi");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.voice_settings.speed).toBe(1.2);
  });

  it("ignores a non-numeric ELEVENLABS_DEFAULT_SPEED and falls back to 1.2", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";
    process.env.ELEVENLABS_DEFAULT_SPEED = "fast"; // junk

    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.from("ogg"));
    const mockFetch = vi.fn().mockResolvedValue(fakePcmResponse());
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("hi");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.voice_settings.speed).toBe(1.2);
  });

  it("converts PCM-16 LE bytes to Float32 [-1, 1] before encoding", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";

    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(pcmToOggOpus).mockClear();
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.from("ogg"));

    // 2 samples: [16384, -16384] in LE bytes
    const pcm = Buffer.from([0x00, 0x40, 0x00, 0xc0]);
    const arr = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(arr),
    });
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("hi");

    expect(pcmToOggOpus).toHaveBeenCalledTimes(1);
    const [floatArr, sampleRate] = vi.mocked(pcmToOggOpus).mock.calls[0];
    expect(sampleRate).toBe(16000);
    expect(floatArr).toBeInstanceOf(Float32Array);
    expect(floatArr.length).toBe(2);
    // 16384 / 32768 = 0.5; -16384 / 32768 = -0.5
    expect(floatArr[0]).toBeCloseTo(0.5, 4);
    expect(floatArr[1]).toBeCloseTo(-0.5, 4);
  });

  it("throws a clear 401 message when API key is invalid", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_bad";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("invalid api key"),
    }));
    // Silence stderr error log during this expected-failure case
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(synthesizeToOgg("hi")).rejects.toThrow("ElevenLabs auth failed");
  });

  it("throws an unknown-voice error on 422", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: () => Promise.resolve('{"detail": "voice_not_found"}'),
    }));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(synthesizeToOgg("hi", "fake-voice")).rejects.toThrow("ElevenLabs validation error");
  });

  it("does NOT route to ElevenLabs when ELEVENLABS_API_KEY is unset", async () => {
    // Defensive — TTS_HOST should win
    process.env.TTS_HOST = "http://kokoro.local";

    const { default: decode } = await import("audio-decode");
    const { pcmToOggOpus } = await import("./ogg-opus-encoder.js");
    vi.mocked(decode).mockResolvedValue({ sampleRate: 24000, channelData: [new Float32Array(1)] });
    vi.mocked(pcmToOggOpus).mockResolvedValue(Buffer.alloc(4));

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
    vi.stubGlobal("fetch", mockFetch);

    await synthesizeToOgg("hi");

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("http://kokoro.local/v1/audio/speech"); // not the ElevenLabs URL
  });
});

describe("fetchVoiceList (ElevenLabs)", () => {
  afterEach(() => {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.TTS_HOST;
    vi.unstubAllGlobals();
  });

  it("returns merged personal+premade voices, deduped by voice_id, when ELEVENLABS_API_KEY is set", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";
    process.env.TTS_HOST = "http://kokoro.local"; // ignored

    const personalResp = {
      voices: [
        {
          voice_id: "VID_PERSONAL_A",
          name: "MyClonedVoice",
          labels: { gender: "female" },
          verified_languages: [{ language: "English" }],
        },
        {
          voice_id: "VID_SHARED_X", // also appears in premade — should de-dup
          name: "Rachel",
        },
      ],
    };
    const premadeResp = {
      voices: [
        { voice_id: "VID_SHARED_X", name: "Rachel" },
        { voice_id: "VID_PREMADE_B", name: "Adam", labels: { gender: "male" } },
      ],
    };

    const mockFetch = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(personalResp) }))
      .mockImplementationOnce(() => Promise.resolve({ ok: true, json: () => Promise.resolve(premadeResp) }));
    vi.stubGlobal("fetch", mockFetch);

    const result = await fetchVoiceList();

    expect(result).toEqual([
      {
        name: "VID_PERSONAL_A",
        description: "MyClonedVoice",
        language: "English",
        gender: "female",
      },
      { name: "VID_SHARED_X", description: "Rachel" },
      { name: "VID_PREMADE_B", description: "Adam", gender: "male" },
    ]);

    // Confirm both endpoints were hit with xi-api-key and the right query params
    const calls = mockFetch.mock.calls.map(c => c[0] as string);
    expect(calls.some(u => u.includes("voice_type=non-community"))).toBe(true);
    expect(calls.some(u => u.includes("category=premade"))).toBe(true);
    for (const c of mockFetch.mock.calls) {
      expect((c[1] as { headers: Record<string, string> }).headers["xi-api-key"]).toBe("sk_eleven_test");
    }
  });

  it("returns empty array when ElevenLabs returns non-ok for both queries", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const result = await fetchVoiceList();
    expect(result).toEqual([]);
  });

  it("returns empty array when ElevenLabs fetch throws on both queries", async () => {
    process.env.ELEVENLABS_API_KEY = "sk_eleven_test";

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const result = await fetchVoiceList();
    expect(result).toEqual([]);
  });
});
