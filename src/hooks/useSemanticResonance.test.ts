import { describe, expect, it } from "vitest";
import {
  MAX_CONTEXT_CHARS,
  MIN_CONTEXT_CHARS,
  buildSemanticContext,
  getAdaptiveDebounceMs,
} from "./useSemanticResonance";

describe("semantic resonance helpers", () => {
  it("keeps short content untouched", () => {
    const content = "Short focused note";
    expect(buildSemanticContext(content)).toBe(content);
  });

  it("keeps context within the configured max length", () => {
    const longContent = [
      "# Heading A",
      "intro ".repeat(120),
      "## Heading B",
      "details ".repeat(180),
      "### Heading C",
      "recent ".repeat(240),
    ].join("\n\n");

    const context = buildSemanticContext(longContent);
    expect(context.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    expect(context.length).toBeGreaterThanOrEqual(MIN_CONTEXT_CHARS);
    expect(context).toContain("Heading");
  });

  it("uses shorter debounce for smaller notes and longer debounce for bigger notes", () => {
    expect(getAdaptiveDebounceMs(120)).toBe(900);
    expect(getAdaptiveDebounceMs(900)).toBe(1500);
    expect(getAdaptiveDebounceMs(2600)).toBe(2200);
    expect(getAdaptiveDebounceMs(5000)).toBe(2800);
  });
});
