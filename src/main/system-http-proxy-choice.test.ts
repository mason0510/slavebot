import { describe, expect, it } from "vitest";
import { proxyRefreshAction, sessionHop } from "./system-http-proxy-choice";

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

describe("sessionHop", () => {
  const japan = { kind: "http" as const, host: "31.58.223.134", port: 1080 };
  const clash = { kind: "socks" as const, host: "127.0.0.1", port: 7890 };

  it("ignores a Japan OS hop when the user owns a direct decision", () => {
    expect(sessionHop({ kind: "direct" }, japan)).toBeNull();
  });

  it("defers to the OS hop when the user has not taken the decision", () => {
    expect(sessionHop(null, japan)).toEqual(japan);
  });

  it("uses the user hop and ignores a Japan OS hop", () => {
    expect(sessionHop(clash, japan)).toEqual(clash);
  });
});
