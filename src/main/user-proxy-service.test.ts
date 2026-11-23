import { mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { clearUserProxyProcessEnv, userProxyChildEnv } from "../backend/user-proxy-env";
import { UserProxyService } from "./user-proxy-service";

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

const dir = mkdtempSync(join(tmpdir(), "user-proxy-"));

afterEach(() => {
  clearUserProxyProcessEnv();
});

/**
 * A service whose probes never touch the Clash port on this Mac.
 * Guarantees each test writes its own json file. Does not delete the temp directory.
 */
function openService(
  name: string,
  options: {
    portAccepts?: (host: string, port: number) => boolean;
    readScutil?: () => string | null;
    ping?: (host: string, port: number) => Promise<number | null>;
  } = {},
) {
  const path = join(dir, `${name}.json`);
  let changes = 0;
  const service = new UserProxyService({
    path,
    onChanged: () => {
      changes += 1;
    },
    portAccepts: options.portAccepts ?? (() => true),
    readScutil: options.readScutil ?? (() => null),
    ping: options.ping ?? (async () => 12),
  });
  return {
    path,
    service,
    changes: () => changes,
  };
}

describe("UserProxyService", () => {
  it("does not save a remote host, including a Japan node", async () => {
    const { path, service, changes } = openService("remote");
    for (const text of ["31.58.223.134:1080", "socks5://31.58.223.94:1080"]) {
      const view = await service.apply({ action: "manual", text, scheme: "socks5" });
      expect(view.error).toBe("remote");
      expect(view.host).toBe("");
    }
    expect(changes()).toBe(0);
    expect(() => readFileSync(path, "utf8")).toThrow();
  });

  it("detects Clash and does not save the Japan system proxy", async () => {
    const { path, service } = openService("detect", {
      portAccepts: (host, port) => host === "127.0.0.1" && port === 7890,
      readScutil: () => JP_SCUTIL,
    });
    const view = await service.apply({ action: "detect" });
    expect(view).toMatchObject({
      enabled: true,
      source: "auto",
      scheme: "socks5",
      host: "127.0.0.1",
      port: 7890,
      accepting: true,
      error: null,
    });
    expect(userProxyChildEnv()).toMatchObject({
      HTTPS_PROXY: "http://127.0.0.1:7890",
      ALL_PROXY: "socks5://127.0.0.1:7890",
    });
    expect(readFileSync(path, "utf8")).not.toContain("31.58");
    unlinkSync(path);
  });

  it("keeps the previous hop when auto-detect finds nothing", async () => {
    const { path, service, changes } = openService("none", {
      portAccepts: () => false,
      readScutil: () => JP_SCUTIL,
    });
    await service.apply({ action: "manual", text: "127.0.0.1:7890", scheme: "http" });
    const before = changes();
    const view = await service.apply({ action: "detect" });
    expect(view.error).toBe("none-found");
    expect(view.host).toBe("127.0.0.1");
    expect(view.scheme).toBe("http");
    expect(changes()).toBe(before);
    unlinkSync(path);
  });

  it("forces direct when the saved port is closed", async () => {
    const { path, service } = openService("closed", { portAccepts: () => false });
    await service.apply({ action: "manual", text: "127.0.0.1:7890", scheme: "socks5" });
    expect(service.syncEnvironment()).toEqual({ kind: "direct" });
    expect(userProxyChildEnv()).toEqual({});
    unlinkSync(path);
  });

  it("keeps the address and skips the probe when the switch is off", async () => {
    let probes = 0;
    const { path, service } = openService("off", {
      portAccepts: () => {
        probes += 1;
        return true;
      },
    });
    await service.apply({ action: "manual", text: "127.0.0.1:7890", scheme: "socks5" });
    const afterSave = probes;
    await service.apply({ action: "enabled", enabled: false });
    const view = await service.view();
    expect(view.enabled).toBe(false);
    expect(view.host).toBe("127.0.0.1");
    expect(view.scheme).toBe("socks5");
    expect(probes).toBe(afterSave);
    expect(userProxyChildEnv()).toEqual({});
    unlinkSync(path);
  });

  it("does not apply or rewrite a tampered Japan file", async () => {
    const { path, service, changes } = openService("tamper");
    const tampered = JSON.stringify({
      version: 1,
      enabled: true,
      source: "manual",
      scheme: "socks5",
      host: "31.58.223.134",
      port: 1080,
    });
    writeFileSync(path, tampered);
    await Effect.runPromise(service.load());
    expect(changes()).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(tampered);
    const view = await service.view();
    expect(view.host).toBe("");
    expect(view.enabled).toBe(false);
    unlinkSync(path);
  });

  it("does not call onChanged from syncEnvironment", async () => {
    const { path, service, changes } = openService("sync");
    await service.apply({ action: "manual", text: "127.0.0.1:7890", scheme: "socks5" });
    const before = changes();
    service.syncEnvironment();
    expect(changes()).toBe(before);
    unlinkSync(path);
  });
});
