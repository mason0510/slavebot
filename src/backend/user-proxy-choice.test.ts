import { describe, expect, it } from "vitest";
import {
  chooseAutoHop,
  decodeStoredProxy,
  parseManualProxy,
  proxyChildEnvironment,
  proxyEndpoint,
  sessionDecision,
  type StoredUserProxy,
} from "./user-proxy-choice";

const JP_SCUTIL = `
HTTPSEnable : 1
HTTPSProxy : 31.58.223.134
HTTPSPort : 1080
HTTPEnable : 1
HTTPProxy : 31.58.223.94
HTTPPort : 1080
SOCKSEnable : 1
SOCKSProxy : 31.58.223.134
SOCKSPort : 1080
`;

describe("parseManualProxy", () => {
  it("rejects a remote host, including a Japan node", () => {
    expect(parseManualProxy("31.58.223.134:1080", "socks5")).toEqual({ ok: false, error: "remote" });
    expect(parseManualProxy("socks5://31.58.223.94:1080", "http")).toEqual({ ok: false, error: "remote" });
  });

  it("rejects credentials and does not save them", () => {
    expect(parseManualProxy("user:pass@127.0.0.1:7890", "socks5")).toEqual({ ok: false, error: "invalid" });
    expect(parseManualProxy("http://user:pass@127.0.0.1:7890", "socks5")).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("lets a URL scheme win over the selected scheme", () => {
    expect(parseManualProxy("socks5://127.0.0.1:7890", "http")).toEqual({
      ok: true,
      scheme: "socks5",
      host: "127.0.0.1",
      port: 7890,
    });
  });

  it("accepts a loopback host:port with the selected scheme", () => {
    expect(parseManualProxy("127.0.0.1:7890", "socks5")).toEqual({
      ok: true,
      scheme: "socks5",
      host: "127.0.0.1",
      port: 7890,
    });
  });

  it("stores https as http because a mixed port accepts HTTP CONNECT", () => {
    expect(parseManualProxy("https://127.0.0.1:7890", "socks5")).toEqual({
      ok: true,
      scheme: "http",
      host: "127.0.0.1",
      port: 7890,
    });
  });
});

describe("proxyEndpoint", () => {
  it("brackets an IPv6 host so the port is not part of the address", () => {
    expect(proxyEndpoint("::1", 7890)).toBe("[::1]:7890");
  });
});

describe("sessionDecision", () => {
  const saved: StoredUserProxy = {
    enabled: true,
    source: "manual",
    scheme: "socks5",
    host: "127.0.0.1",
    port: 7890,
  };

  it("forces direct for a Japan host even when that port accepts", () => {
    expect(sessionDecision({ ...saved, host: "31.58.223.134", port: 1080 }, () => true)).toEqual({ kind: "direct" });
  });

  it("defers to the OS when the switch is off", () => {
    expect(sessionDecision({ ...saved, enabled: false }, () => true)).toBeNull();
  });

  it("forces direct when the saved port is closed", () => {
    expect(sessionDecision(saved, () => false)).toEqual({ kind: "direct" });
  });

  it("returns an accepting loopback hop", () => {
    expect(sessionDecision(saved, () => true)).toEqual({ kind: "socks", host: "127.0.0.1", port: 7890 });
  });
});

describe("chooseAutoHop", () => {
  it("ignores a Japan system proxy and uses Clash only when that port accepts", () => {
    const open = new Set<string>(["127.0.0.1:7890"]);
    expect(chooseAutoHop(JP_SCUTIL, (host, port) => open.has(`${host}:${port}`))).toEqual({
      scheme: "socks5",
      host: "127.0.0.1",
      port: 7890,
    });
  });

  it("returns null when the system list is only remote and Clash is closed", () => {
    expect(chooseAutoHop(JP_SCUTIL, () => false)).toBeNull();
  });
});

describe("proxyChildEnvironment", () => {
  it("uses an HTTP URL for HTTPS_PROXY even when the hop is SOCKS5", () => {
    expect(proxyChildEnvironment({ scheme: "socks5", host: "127.0.0.1", port: 7890 })).toMatchObject({
      HTTPS_PROXY: "http://127.0.0.1:7890",
      HTTP_PROXY: "http://127.0.0.1:7890",
      ALL_PROXY: "socks5://127.0.0.1:7890",
      NO_PROXY: "localhost,127.0.0.1,::1",
    });
  });
});

describe("decodeStoredProxy", () => {
  it("drops a tampered remote host instead of applying it", () => {
    expect(
      decodeStoredProxy({
        version: 1,
        enabled: true,
        source: "manual",
        scheme: "socks5",
        host: "31.58.223.134",
        port: 1080,
      }),
    ).toBeNull();
  });
});
