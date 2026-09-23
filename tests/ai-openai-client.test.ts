import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `modules/ai/openai/client.ts` — the OpenAI Responses API client.
 *
 * NO real network call is ever made: `fetch` is fully mocked. This test
 * suite verifies the client's contract (endpoint, auth header, payload
 * shape, error handling, extraction) without touching OpenAI.
 */

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("callOpenAiResponses()", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, OPENAI_API_KEY: "sk-test-key" };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws OpenAiConfigurationError when OPENAI_API_KEY is missing", async () => {
    process.env.OPENAI_API_KEY = "";
    const { callOpenAiResponses, OpenAiConfigurationError } =
      await import("@/modules/ai/openai/client");
    await expect(callOpenAiResponses({ instructions: "x", input: "y" })).rejects.toBeInstanceOf(
      OpenAiConfigurationError,
    );
  });

  it("calls the Responses API endpoint with the Bearer token and JSON body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        model: "gpt-4o-mini",
        output_text: '{"title":"t","message":"m","hashtags":["#a"],"cta":"c"}',
        usage: { input_tokens: 42, output_tokens: 17 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { callOpenAiResponses } = await import("@/modules/ai/openai/client");
    const result = await callOpenAiResponses({
      instructions: "system instructions",
      input: "user input",
      model: "gpt-4o-mini",
      temperature: 0.5,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer sk-test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.instructions).toBe("system instructions");
    expect(body.input).toBe("user input");
    expect(body.temperature).toBe(0.5);

    expect(result.outputText).toContain('"title":"t"');
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.inputTokens).toBe(42);
    expect(result.outputTokens).toBe(17);
  });

  it("defaults to gpt-4o-mini and temperature 0.7 when omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ output_text: "{}" }));
    vi.stubGlobal("fetch", fetchMock);
    const { callOpenAiResponses } = await import("@/modules/ai/openai/client");
    await callOpenAiResponses({ instructions: "i", input: "u" });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.temperature).toBe(0.7);
  });

  it("attaches a strict json_schema format when jsonSchema is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ output_text: "{}" }));
    vi.stubGlobal("fetch", fetchMock);
    const { callOpenAiResponses } = await import("@/modules/ai/openai/client");
    await callOpenAiResponses({
      instructions: "i",
      input: "u",
      jsonSchema: { name: "schema_name", schema: { type: "object" } },
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.text.format).toEqual({
      type: "json_schema",
      name: "schema_name",
      schema: { type: "object" },
      strict: true,
    });
  });

  it("throws OpenAiRequestError with the status code on a non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "boom" }, 429));
    vi.stubGlobal("fetch", fetchMock);
    const { callOpenAiResponses, OpenAiRequestError } = await import("@/modules/ai/openai/client");
    await expect(callOpenAiResponses({ instructions: "i", input: "u" })).rejects.toMatchObject({
      status: 429,
    });
    await expect(callOpenAiResponses({ instructions: "i", input: "u" })).rejects.toBeInstanceOf(
      OpenAiRequestError,
    );
  });

  it("never calls fetch when the API key is missing (no accidental network access)", async () => {
    process.env.OPENAI_API_KEY = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { callOpenAiResponses } = await import("@/modules/ai/openai/client");
    await expect(callOpenAiResponses({ instructions: "i", input: "u" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("extractOutputText()", () => {
  it("prefers the top-level output_text field", async () => {
    const { extractOutputText } = await import("@/modules/ai/openai/client");
    expect(extractOutputText({ output_text: "hello" })).toBe("hello");
  });

  it("falls back to walking the output[].content[].text structure", async () => {
    const { extractOutputText } = await import("@/modules/ai/openai/client");
    const payload = {
      output: [
        { content: [{ text: "part1" }, { text: "part2" }] },
        { content: [{ text: "part3" }] },
      ],
    };
    expect(extractOutputText(payload)).toBe("part1part2part3");
  });

  it("returns an empty string for an unrecognized payload shape", async () => {
    const { extractOutputText } = await import("@/modules/ai/openai/client");
    expect(extractOutputText({})).toBe("");
    expect(extractOutputText(null)).toBe("");
    expect(extractOutputText("not an object")).toBe("");
  });
});
