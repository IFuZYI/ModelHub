import { describe, it, expect } from "vitest";
import {
  modelDedupeKey,
  distinctModelCount,
  modelVendor,
  vendorLabel,
} from "../app/lib/display";

describe("modelDedupeKey", () => {
  it("strips a provider/ prefix and lowercases", () => {
    expect(modelDedupeKey("openai/gpt-4o")).toBe("gpt-4o");
    expect(modelDedupeKey("gpt-4o")).toBe("gpt-4o");
    expect(modelDedupeKey("GPT-4o")).toBe("gpt-4o");
  });

  it("keeps only the last path segment", () => {
    expect(modelDedupeKey("meta-llama/Llama-3.3-70B-Instruct")).toBe(
      "llama-3.3-70b-instruct"
    );
    expect(modelDedupeKey("accounts/fireworks/models/deepseek-v3")).toBe(
      "deepseek-v3"
    );
  });

  it("trims whitespace", () => {
    expect(modelDedupeKey("  gpt-4o  ")).toBe("gpt-4o");
  });
});

describe("distinctModelCount", () => {
  it("dedupes the same model across providers", () => {
    const n = distinctModelCount([
      ["openai/gpt-4o", "openai/gpt-4o-mini"], // aggregator A
      ["gpt-4o", "gpt-4o-mini"], // official OpenAI
    ]);
    expect(n).toBe(2); // gpt-4o + gpt-4o-mini, not 4
  });

  it("counts genuinely distinct models separately", () => {
    const n = distinctModelCount([
      ["gpt-4o", "claude-sonnet-4"],
      ["deepseek-chat"],
    ]);
    expect(n).toBe(3);
  });

  it("dedupes vendor-path variants against bare names", () => {
    const n = distinctModelCount([
      ["meta-llama/Llama-3.3-70B-Instruct"],
      ["Llama-3.3-70B-Instruct"],
    ]);
    expect(n).toBe(1);
  });

  it("ignores empty entries", () => {
    expect(distinctModelCount([[], [""], ["  "]])).toBe(0);
  });
});

describe("modelVendor", () => {
  it("uses the vendor/ prefix when present", () => {
    expect(modelVendor("openai/gpt-4o")).toBe("openai");
    expect(modelVendor("meta-llama/Llama-3.3-70B")).toBe("meta-llama");
    expect(modelVendor("anthropic/claude-sonnet-4")).toBe("anthropic");
  });

  it("infers vendor from bare model names", () => {
    expect(modelVendor("gpt-4o")).toBe("openai");
    expect(modelVendor("o3")).toBe("openai");
    expect(modelVendor("claude-3-5-sonnet")).toBe("anthropic");
    expect(modelVendor("gemini-2.5-pro")).toBe("google");
    expect(modelVendor("grok-4")).toBe("xai");
    expect(modelVendor("deepseek-chat")).toBe("deepseek");
    expect(modelVendor("qwen-max")).toBe("qwen");
    expect(modelVendor("glm-4-plus")).toBe("zhipu");
    expect(modelVendor("moonshot-v1-8k")).toBe("moonshot");
    expect(modelVendor("mistral-large-latest")).toBe("mistral");
  });

  it("falls back to 其他 for unknown names", () => {
    expect(modelVendor("some-random-model")).toBe("其他");
  });
});

describe("vendorLabel", () => {
  it("maps known vendor keys to human labels", () => {
    expect(vendorLabel("openai")).toBe("OpenAI");
    expect(vendorLabel("qwen")).toBe("通义千问");
    expect(vendorLabel("zhipu")).toBe("智谱 GLM");
  });

  it("passes through unknown keys unchanged", () => {
    expect(vendorLabel("acme")).toBe("acme");
  });
});
