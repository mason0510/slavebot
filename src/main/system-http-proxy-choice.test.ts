import { describe, expect, it } from "vitest";
import { proxyRefreshAction } from "./system-http-proxy-choice";

describe("proxyRefreshAction", () => {
  const clash = { kind: "http" as const, host: "127.0.0.1", port: 7890 };

  it("keeps a session that already matches the accepting hop", () => {
    expect(proxyRefreshAction("http:127.0.0.1:7890", clash)).toBe("keep");
  });

  it("keeps direct when no hop is applied and none accepts", () => {
    expect(proxyRefreshAction(null, null)).toBe("keep");
  });

  it("clears a dead hop instead of keeping it", () => {
    expect(proxyRefreshAction("http:127.0.0.1:17890", null)).toBe("direct");
  });

  it("applies a newly accepting hop", () => {
    expect(proxyRefreshAction("http:127.0.0.1:17890", clash)).toBe("apply");
    expect(proxyRefreshAction(null, clash)).toBe("apply");
  });
});
