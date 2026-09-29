import { describe, expect, it } from "vitest";
import { generateOutreachMessage } from "@/modules/outreach/prompts/generator";
import { OUTREACH_TEMPLATES } from "@/modules/outreach/prompts/templates";
import { replaceVariables, unresolvedVariables } from "@/modules/outreach/prompts/variables";

const context = {
  creator: { displayName: "Ana", niche: "Moda" },
  product: { name: "Hoodie" },
  campaign: { name: "Lançamento" },
  trend: { keyword: "streetwear" },
};

describe("Outreach variable parser", () => {
  it("replaces every supported primitive", () => {
    expect(replaceVariables("{{a}}/{{b}}/{{c}}", { a: "x", b: 2, c: true })).toBe("x/2/true");
  });
  it("accepts whitespace inside tokens", () => {
    expect(replaceVariables("Oi {{ creatorName }}", { creatorName: "Ana" })).toBe("Oi Ana");
  });
  it("renders nullish known values as empty", () => {
    expect(replaceVariables("a{{x}}b{{y}}c", { x: null, y: undefined })).toBe("abc");
  });
  it("keeps unknown tokens visible", () => {
    expect(replaceVariables("{{known}} {{unknown}}", { known: "ok" })).toBe("ok {{unknown}}");
  });
  it("does not resolve inherited prototype values", () => {
    expect(replaceVariables("{{toString}}", {})).toBe("{{toString}}");
  });
  it("never evaluates JavaScript expressions", () => {
    expect(replaceVariables("{{constructor.constructor}}", {})).toBe("{{constructor.constructor}}");
  });
  it("reports unresolved variable names", () => {
    expect(unresolvedVariables("{{one}} and {{ two }} and {{one}}")).toEqual(["one", "two", "one"]);
  });
  it("rejects non-string templates", () => {
    expect(() => replaceVariables(null as never, {})).toThrow(TypeError);
  });
});

describe("Outreach templates", () => {
  it("ships exactly eight canonical templates", () => expect(OUTREACH_TEMPLATES).toHaveLength(8));
  it.each([
    ["FIRST_CONTACT", 3],
    ["FOLLOW_UP", 2],
    ["NEGOTIATION", 2],
    ["REENGAGEMENT", 1],
  ] as const)("ships %s templates in the required amount", (type, amount) => {
    expect(OUTREACH_TEMPLATES.filter((template) => template.type === type)).toHaveLength(amount);
  });
  it("uses unique names", () => {
    expect(new Set(OUTREACH_TEMPLATES.map((template) => template.name)).size).toBe(8);
  });
  it("only contains the five supported variables", () => {
    const allowed = new Set([
      "creatorName",
      "niche",
      "productName",
      "campaignName",
      "trendKeyword",
    ]);
    for (const template of OUTREACH_TEMPLATES) {
      expect(unresolvedVariables(template.content).every((token) => allowed.has(token))).toBe(true);
    }
  });
});

describe("Prompt Engine", () => {
  it("generates a deterministic first contact with the default template", () => {
    const first = generateOutreachMessage(context);
    expect(generateOutreachMessage(context)).toBe(first);
    expect(first).toContain("Ana");
  });
  it("replaces all five mandatory variables", () => {
    expect(
      generateOutreachMessage({
        ...context,
        template: "{{creatorName}}|{{niche}}|{{productName}}|{{campaignName}}|{{trendKeyword}}",
      }),
    ).toBe("Ana|Moda|Hoodie|Lançamento|streetwear");
  });
  it.each(OUTREACH_TEMPLATES)("renders $name without unresolved variables", (template) => {
    expect(
      unresolvedVariables(generateOutreachMessage({ ...context, template: template.content })),
    ).toEqual([]);
  });

  const contextualCases = OUTREACH_TEMPLATES.flatMap((template, templateIndex) =>
    Array.from({ length: 8 }, (_, contextIndex) => ({
      label: `${template.type}-${templateIndex + 1}-context-${contextIndex + 1}`,
      template: template.content,
      input: {
        creator: { displayName: `Creator ${contextIndex}`, niche: `Niche ${contextIndex}` },
        product: { name: `Product ${contextIndex}` },
        campaign: { name: `Campaign ${contextIndex}` },
        trend: { keyword: `Trend ${contextIndex}` },
      },
    })),
  );

  it.each(contextualCases)("renders a safe, complete message for $label", ({ template, input }) => {
    const generated = generateOutreachMessage({ ...input, template });
    expect(generated).toContain(input.creator.displayName);
    expect(unresolvedVariables(generated)).toEqual([]);
    expect(generated).not.toMatch(/\beval\s*\(/);
  });
});
