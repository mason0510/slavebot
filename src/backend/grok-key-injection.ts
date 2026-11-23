import { execFileSync } from "node:child_process";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";

/** The variable `~/.grok/config.toml` names with `env_key`. Official grok does not read Keychain itself. */
export const CHAINFUEL_GROK_API_KEY = "CHAINFUEL_GROK_API_KEY";

/**
 * Absolute path. A Dock launch has a short PATH, so a bare `keychain-cli` is not the shell injection.
 * Guarantees: this is the binary the login shell already uses for this key.
 * Does not guarantee: the binary exists on every machine.
 */
const KEYCHAIN_CLI = "/usr/local/bin/keychain-cli";

const KEYCHAIN_TIMEOUT_MS = 5_000;
const logger = createOpenBotLogger("grok-key-injection");

/** One Keychain export, already separated from stderr. The value must not be logged by the loader. */
export interface GrokKeyExport {
  readonly exitCode: number;
  readonly stdout: string;
}

/** Reads one export. Tests pass a fake. Production uses Keychain and must not print the value. */
export type GrokKeyExportLoader = () => GrokKeyExport;

interface ReadyCache {
  readonly outcome: "ready";
  readonly key: string;
}

interface AbsentCache {
  readonly outcome: "absent";
}

interface FailedCache {
  readonly outcome: "failed";
}

type InjectionCache = ReadyCache | AbsentCache | FailedCache;

let cache: InjectionCache | null = null;
let exportLoader: GrokKeyExportLoader | null = null;
let childReceivedKey = false;

/**
 * Drops the one-shot cache and any test loader.
 * Guarantees: the next ensure reads again. A previous value is no longer returned. A child that already received a key is forgotten.
 * Does not guarantee: a secret already registered for log redaction is forgotten.
 * Call this from tests. A failed production load uses `retryGrokKeyLoad` so a confirmed absence stays absent.
 */
export function resetGrokKeyInjectionState(): void {
  cache = null;
  exportLoader = null;
  childReceivedKey = false;
}

/**
 * Drops only a failed Keychain read so the next start can read again.
 * Guarantees: a `failed` cache becomes unread. A ready key and a confirmed absence stay.
 * Does not guarantee: the next read succeeds, or that a child already started receives the new value.
 * Returns whether a failed read was dropped. Nothing is logged.
 */
export function retryGrokKeyLoad(): boolean {
  if (cache?.outcome !== "failed") return false;
  cache = null;
  return true;
}

/**
 * True when the last live read failed, rather than confirming that no key is stored.
 * Guarantees: a non-zero export or a thrown loader is a failure. An empty successful export is not.
 * Does not guarantee: a later read will fail. A caller cannot supply another process's cache.
 */
export function grokKeyLoadFailed(): boolean {
  return cache?.outcome === "failed";
}

/**
 * True after this process put `CHAINFUEL_GROK_API_KEY` into a Grok child.
 * Guarantees: a later status check still sees that injection after the fragment was returned.
 * Does not guarantee: the child is still running, or that a caller-supplied env received the key.
 */
export function grokChildHasInjectedKey(): boolean {
  return childReceivedKey;
}

/**
 * Replaces the Keychain read. `null` restores it.
 * Guarantees: the next ensure uses this loader, and the previous cache is dropped.
 * Does not guarantee: the loader is called. An env that already holds a Grok key skips it.
 * Tests must pass a fake export. The loader must not print the value.
 */
export function setGrokKeyExportLoader(loader: GrokKeyExportLoader | null): void {
  exportLoader = loader;
  cache = null;
}

/**
 * True when `env` already holds a non-empty Grok or xAI key.
 * Guarantees: a trimmed `XAI_API_KEY`, or any trimmed variable whose name contains `GROK_API_KEY`, is enough.
 * Does not guarantee: the value is accepted, or that Keychain has been read.
 * An empty string is not a key. The value is not returned.
 */
export function envHoldsGrokApiKey(env: NodeJS.ProcessEnv): boolean {
  if (env.XAI_API_KEY?.trim()) return true;
  return Object.entries(env).some(([name, value]) => name.includes("GROK_API_KEY") && Boolean(value?.trim()));
}

/**
 * Reads `CHAINFUEL_GROK_API_KEY` from one `export` line.
 * Guarantees: a single-quoted, double-quoted, or bare non-empty value for that name is returned.
 * Does not guarantee: the value is accepted. Any other name, an empty value, or a broken quote is `null`.
 * The text is not evaluated and the value is not logged. Input may be empty.
 */
export function parseChainfuelGrokKeyExport(text: string): string | null {
  const line = text
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find((item) => item.startsWith("export "));
  if (!line) return null;
  const match = /^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
  if (!match || match[1] !== CHAINFUEL_GROK_API_KEY) return null;
  const value = unquoteExportValue(match[2] ?? "");
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

/**
 * Loads the ChainFuel key once when the live process does not already hold one.
 * Guarantees: a key already in `env` is left there and counts as injected. A ready Keychain export is cached for the Grok child only.
 * A caller-supplied `env` is not the live process, so it does not read Keychain or the cache.
 * A non-zero exit or a thrown loader is cached as `failed` and can be read again after `retryGrokKeyLoad`.
 * An empty successful export is cached as `absent` and is not a failed injection.
 * Does not guarantee: the key is accepted, or that a key saved under another name was loaded.
 * The value is not written to `process.env` and is not logged. `env` may be empty.
 */
export function ensureGrokApiKeyInjected(env: NodeJS.ProcessEnv = process.env): boolean {
  if (envHoldsGrokApiKey(env)) return true;
  // A fixture env must not hide a missing key behind a Keychain read that belongs to this process.
  if (env !== process.env) return false;
  if (cache?.outcome === "ready") return true;
  if (cache) return false;
  cache = loadChainfuelKey();
  return cache.outcome === "ready";
}

/**
 * The env fragment the Grok child must receive.
 * Guarantees: when Keychain supplied `CHAINFUEL_GROK_API_KEY` and the live process did not already hold a Grok key, the fragment contains that name and value.
 * A child that receives that fragment is remembered, so a later status check does not treat a second failed read as signed out.
 * Does not guarantee: a key already in `env` is copied. The child inherits that env itself.
 * A caller-supplied `env` returns an empty fragment and does not read Keychain. The value is not logged.
 */
export function grokChildKeyEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (envHoldsGrokApiKey(env)) return {};
  if (env !== process.env) return {};
  if (!ensureGrokApiKeyInjected(env) || cache?.outcome !== "ready") return {};
  childReceivedKey = true;
  return { [CHAINFUEL_GROK_API_KEY]: cache.key };
}

/**
 * Unquotes one shell assignment without evaluating it.
 * Guarantees: a closed single quote, double quote, or bare token becomes the raw value.
 * Does not guarantee: every shell escape. An unclosed quote or a bare token with whitespace is `null`.
 * Input is the text after `=`. It is not logged.
 */
function unquoteExportValue(raw: string): string | null {
  if (raw.startsWith("'")) return unquoteSingle(raw);
  if (raw.startsWith('"')) return unquoteDouble(raw);
  if (raw.length === 0 || /[\s'"\\]/u.test(raw)) return null;
  return raw;
}

/**
 * Reads a single-quoted export, including the bash `'\''` escape.
 * Guarantees: a closed single-quoted value is returned with that escape turned back into one quote.
 * Does not guarantee: other quote styles. An unclosed value is `null`.
 */
function unquoteSingle(raw: string): string | null {
  if (!raw.endsWith("'") || raw.length < 2) return null;
  let out = "";
  let index = 1;
  const end = raw.length - 1;
  while (index < end) {
    if (raw.startsWith("'\\''", index)) {
      out += "'";
      index += 4;
      continue;
    }
    const char = raw[index];
    if (char === undefined || char === "'") return null;
    out += char;
    index += 1;
  }
  return out;
}

/**
 * Reads a double-quoted export without expanding `$`.
 * Guarantees: `\\`, `\"`, `\$`, and `` \` `` become the escaped character. `$()` stays literal and is not run.
 * Does not guarantee: an unclosed quote. That is `null`.
 */
function unquoteDouble(raw: string): string | null {
  if (!raw.endsWith('"') || raw.length < 2) return null;
  let out = "";
  for (let index = 1; index < raw.length - 1; index += 1) {
    const char = raw[index];
    if (char === undefined) return null;
    if (char === "\\") {
      const next = raw[index + 1];
      if (next === undefined || !/["\\$`]/u.test(next)) return null;
      out += next;
      index += 1;
      continue;
    }
    if (char === '"') return null;
    out += char;
  }
  return out;
}

/**
 * Runs the loader once and keeps only a parsed ChainFuel key.
 * Guarantees: a non-zero exit or a throw is `failed`. An empty or unparsable successful export is `absent`. A parsed value is `ready` and registered for log redaction.
 * Does not guarantee: the key is accepted. The value is not logged and is not written to `process.env`.
 */
function loadChainfuelKey(): InjectionCache {
  const loaded = readExport();
  if (loaded.exitCode !== 0) {
    logger.info("Grok API key injection did not apply.", { injected: false, load: "failed" });
    return { outcome: "failed" };
  }
  const key = parseChainfuelGrokKeyExport(loaded.stdout);
  if (!key) {
    logger.info("Grok API key injection finished.", { injected: false, load: "absent" });
    return { outcome: "absent" };
  }
  registerSecretValue(key);
  logger.info("Grok API key injection finished.", { injected: true, load: "ready" });
  return { outcome: "ready", key };
}

/**
 * Reads the export from the test loader, or from Keychain when no loader is set.
 * Guarantees: a throw becomes a non-zero result with empty stdout. Vitest does not call Keychain.
 * Does not guarantee: Keychain is installed. Stdout is not logged.
 */
function readExport(): GrokKeyExport {
  try {
    return (exportLoader ?? defaultKeychainExport)();
  } catch {
    return { exitCode: 1, stdout: "" };
  }
}

/**
 * The login-shell injection, without a shell.
 * Guarantees: stdout is the export text and stderr is not returned. Vitest returns an empty successful export and does not spawn.
 * Does not guarantee: the command exists. A missing binary or a non-zero exit is a failed export.
 * The value is not logged. An empty Vitest export means the test did not consult Keychain, not that a user load failed.
 */
function defaultKeychainExport(): GrokKeyExport {
  // A unit test must not read the login Keychain. An empty success is "not consulted", so it must not look like a failed user injection.
  if (process.env.VITEST) return { exitCode: 0, stdout: "" };
  try {
    const stdout = execFileSync(KEYCHAIN_CLI, ["load", "--keys", CHAINFUEL_GROK_API_KEY, "--format", "export"], {
      encoding: "utf8",
      timeout: KEYCHAIN_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    return { exitCode: 0, stdout };
  } catch {
    return { exitCode: 1, stdout: "" };
  }
}
