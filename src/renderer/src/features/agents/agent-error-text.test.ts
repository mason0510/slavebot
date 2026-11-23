import { describe, expect, it } from "vitest";
import { providerErrorToastOptions } from "./agent-error-text";

describe("provider error toast", () => {
  it("keeps a key-read failure on one toast for 12 seconds", () => {
    expect(providerErrorToastOptions("grok_key_read_failed")).toEqual({ id: "grok-key-read", duration: 12_000 });
    expect(providerErrorToastOptions("grok_start_failed")).toEqual({});
  });
});
