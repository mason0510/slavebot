import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GrokKeyInjectionError,
  grokApiKeyInjected,
  grokKeyFailureText,
  grokKeyInjectionNotice,
  grokMustNotAskSignIn,
  grokStatusWithoutSignIn,
} from "./provider-client-effects";
import {
  CHAINFUEL_GROK_API_KEY,
  type GrokKeyExportLoader,
  ensureGrokApiKeyInjected,
  grokChildHasInjectedKey,
  grokChildKeyEnv,
  grokKeyLoadFailed,
  parseChainfuelGrokKeyExport,
  resetGrokKeyInjectionState,
  retryGrokKeyLoad,
  setGrokKeyExportLoader,
} from "./grok-key-injection";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFileSync: vi.fn(() => {
      throw new Error("keychain must not run");
    }),
  };
});

/** A fixture value. It is not a credential and must not be replaced with a real key. */
const FAKE_KEY = "kf-test-not-a-secret";

/**
 * Saves credential-shaped variables so a test can delete them and put them back.
 * Guarantees: every `*GROK_API_KEY*`, `XAI_API_KEY`, and `VITEST` present at the call is recorded.
 * Does not guarantee: a variable added after the snapshot is restored. The values are not logged.
 */
function snapshotCredentialEnv(): Map<string, string | undefined> {
  const saved = new Map<string, string | undefined>();
  for (const name of Object.keys(process.env)) {
    if (name.includes("GROK_API_KEY") || name === "XAI_API_KEY" || name === "VITEST") saved.set(name, process.env[name]);
  }
  if (!saved.has("VITEST")) saved.set("VITEST", process.env.VITEST);
  return saved;
}

/**
 * Puts the snapshot back and drops names the test added.
 * Guarantees: a name in the snapshot returns to that value, including absence. A Grok key name added later is removed.
 * Does not guarantee: unrelated variables. Values are not logged.
 */
function restoreCredentialEnv(saved: Map<string, string | undefined>): void {
  for (const name of Object.keys(process.env)) {
    if ((name.includes("GROK_API_KEY") || name === "XAI_API_KEY") && !saved.has(name)) delete process.env[name];
  }
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

/**
 * Removes Grok and xAI key variables from the live process.
 * Guarantees: those names are absent afterwards. Does not guarantee: Keychain was read. Nothing is logged.
 */
function deleteLiveGrokKeys(): void {
  for (const name of Object.keys(process.env)) {
    if (name.includes("GROK_API_KEY") || name === "XAI_API_KEY") delete process.env[name];
  }
}

/** One `export` line for the ChainFuel name. The value is not evaluated. */
function exportLine(value: string): string {
  return `export ${CHAINFUEL_GROK_API_KEY}='${value}'`;
}

describe("Grok key injection", () => {
  let savedEnv: Map<string, string | undefined>;

  beforeEach(() => {
    savedEnv = snapshotCredentialEnv();
    deleteLiveGrokKeys();
    resetGrokKeyInjectionState();
    vi.mocked(execFileSync).mockReset();
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error("keychain must not run");
    });
  });

  afterEach(() => {
    resetGrokKeyInjectionState();
    restoreCredentialEnv(savedEnv);
  });

  it("parses a single-quoted, double-quoted, bare, or bash-escaped export and rejects the rest", () => {
    expect(parseChainfuelGrokKeyExport(exportLine(FAKE_KEY))).toBe(FAKE_KEY);
    expect(parseChainfuelGrokKeyExport(`export ${CHAINFUEL_GROK_API_KEY}="${FAKE_KEY}"`)).toBe(FAKE_KEY);
    expect(parseChainfuelGrokKeyExport(`export ${CHAINFUEL_GROK_API_KEY}=${FAKE_KEY}`)).toBe(FAKE_KEY);
    expect(parseChainfuelGrokKeyExport(`export ${CHAINFUEL_GROK_API_KEY}='kf-te'\\''st'`)).toBe("kf-te'st");
    expect(parseChainfuelGrokKeyExport(`export OTHER_GROK_API_KEY='${FAKE_KEY}'`)).toBeNull();
    expect(parseChainfuelGrokKeyExport(`export ${CHAINFUEL_GROK_API_KEY}=''`)).toBeNull();
    expect(parseChainfuelGrokKeyExport(`export ${CHAINFUEL_GROK_API_KEY}='${FAKE_KEY}`)).toBeNull();
    expect(parseChainfuelGrokKeyExport(`export ${CHAINFUEL_GROK_API_KEY}='$(echo ${FAKE_KEY})'`)).toBe(
      `$(echo ${FAKE_KEY})`,
    );
  });

  it("does not read Keychain when the env already holds a Grok key", () => {
    const loader = vi.fn<GrokKeyExportLoader>(() => ({ exitCode: 0, stdout: exportLine(FAKE_KEY) }));
    setGrokKeyExportLoader(loader);
    expect(ensureGrokApiKeyInjected({ XAI_API_KEY: "xai-test-not-a-secret" })).toBe(true);
    expect(ensureGrokApiKeyInjected({ [CHAINFUEL_GROK_API_KEY]: FAKE_KEY })).toBe(true);
    expect(grokChildKeyEnv({ [CHAINFUEL_GROK_API_KEY]: FAKE_KEY })).toEqual({});
    expect(loader).not.toHaveBeenCalled();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("loads one fake export into the Grok child and not into process.env", () => {
    let reads = 0;
    setGrokKeyExportLoader(() => {
      reads += 1;
      return { exitCode: 0, stdout: exportLine(FAKE_KEY) };
    });
    expect(grokChildKeyEnv()).toEqual({ [CHAINFUEL_GROK_API_KEY]: FAKE_KEY });
    expect(grokChildHasInjectedKey()).toBe(true);
    expect(grokChildKeyEnv()).toEqual({ [CHAINFUEL_GROK_API_KEY]: FAKE_KEY });
    expect(reads).toBe(1);
    expect(process.env[CHAINFUEL_GROK_API_KEY]).toBeUndefined();
    expect(grokApiKeyInjected()).toBe(true);
    expect(grokApiKeyInjected({})).toBe(false);
    expect(grokChildKeyEnv({})).toEqual({});
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("keeps a failed or empty export from counting as injected", () => {
    const failed = vi.fn<GrokKeyExportLoader>(() => ({ exitCode: 1, stdout: exportLine(FAKE_KEY) }));
    setGrokKeyExportLoader(failed);
    expect(ensureGrokApiKeyInjected()).toBe(false);
    expect(grokChildKeyEnv()).toEqual({});
    expect(grokApiKeyInjected()).toBe(false);
    expect(grokKeyLoadFailed()).toBe(true);
    expect(grokMustNotAskSignIn()).toBe(true);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(ensureGrokApiKeyInjected()).toBe(false);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(
      grokStatusWithoutSignIn("grok", {
        state: "sign-in-required",
        version: null,
        message: "需要登录",
        email: null,
      }).state,
    ).toBe("error");
    expect(retryGrokKeyLoad()).toBe(true);
    expect(grokKeyLoadFailed()).toBe(false);
    expect(ensureGrokApiKeyInjected()).toBe(false);
    expect(failed).toHaveBeenCalledTimes(2);

    resetGrokKeyInjectionState();
    setGrokKeyExportLoader(() => {
      throw new Error("loader failed");
    });
    expect(ensureGrokApiKeyInjected()).toBe(false);
    expect(grokApiKeyInjected()).toBe(false);

    resetGrokKeyInjectionState();
    setGrokKeyExportLoader(() => ({ exitCode: 0, stdout: "" }));
    expect(ensureGrokApiKeyInjected()).toBe(false);
    expect(grokChildKeyEnv()).toEqual({});
    expect(grokKeyLoadFailed()).toBe(false);
    expect(retryGrokKeyLoad()).toBe(false);
    expect(
      grokStatusWithoutSignIn("grok", {
        state: "sign-in-required",
        version: null,
        message: "需要登录",
        email: null,
      }).state,
    ).toBe("sign-in-required");
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it("uses the Keychain command only when Vitest is not set and no loader is installed", () => {
    // The module mock must be the callee. Deleting VITEST before that check would reach the real binary.
    expect(vi.isMockFunction(execFileSync)).toBe(true);
    delete process.env.VITEST;
    expect(grokApiKeyInjected()).toBe(false);
    expect(execFileSync).toHaveBeenCalledTimes(1);
    expect(execFileSync).toHaveBeenCalledWith(
      "/usr/local/bin/keychain-cli",
      ["load", "--keys", CHAINFUEL_GROK_API_KEY, "--format", "export"],
      expect.objectContaining({ encoding: "utf8", timeout: 5_000, windowsHide: true }),
    );

    resetGrokKeyInjectionState();
    vi.mocked(execFileSync).mockReturnValueOnce(`${exportLine(FAKE_KEY)}\n`);
    expect(grokChildKeyEnv()).toEqual({ [CHAINFUEL_GROK_API_KEY]: FAKE_KEY });
    expect(process.env[CHAINFUEL_GROK_API_KEY]).toBeUndefined();
  });

  it("does not publish sign-in-required after a key is injected", () => {
    const signedOut = {
      state: "sign-in-required" as const,
      version: "1.0.88",
      message: "需要登录",
      email: null,
    };
    expect(grokStatusWithoutSignIn("grok", signedOut)).toEqual(signedOut);
    expect(execFileSync).not.toHaveBeenCalled();

    setGrokKeyExportLoader(() => ({ exitCode: 0, stdout: exportLine(FAKE_KEY) }));
    expect(grokApiKeyInjected()).toBe(true);
    const blocked = grokStatusWithoutSignIn("grok", signedOut);
    expect(blocked.state).toBe("error");
    expect(blocked.message).toContain("does not need a sign-in");
    expect(blocked.message).not.toContain(FAKE_KEY);
    expect(grokStatusWithoutSignIn("codex", signedOut).state).toBe("sign-in-required");
  });

  it("names a failed keychain read and keeps that sentence for a toast", () => {
    setGrokKeyExportLoader(() => ({ exitCode: 1, stdout: "" }));
    expect(ensureGrokApiKeyInjected()).toBe(false);
    const status = grokStatusWithoutSignIn("grok", {
      state: "sign-in-required",
      version: null,
      message: "需要登录",
      email: null,
    });
    expect(status.state).toBe("error");
    expect(status.message).toContain("could not read its API key from the keychain");
    expect(status.message).not.toContain(FAKE_KEY);
    expect(grokKeyInjectionNotice("grok", new Error("unread"), status.message)).toBe(status.message);
    expect(grokKeyInjectionNotice("codex", new Error("unread"), status.message)).toBeNull();
    expect(grokKeyInjectionNotice("grok", new Error("unread"), "需要登录")).toBeNull();
    expect(grokKeyFailureText(true, true)).toContain("open Terminal");
    expect(grokKeyFailureText(false, true)).toContain(process.execPath);
    expect(
      grokKeyInjectionNotice(
        "grok",
        new GrokKeyInjectionError({ message: grokKeyFailureText(false, false) }),
        null,
      ),
    ).toContain("does not need a sign-in");
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
