/**
 * Choose a local proxy hop and the environment a child process should see.
 *
 * Algorithm ApplyUserProxy, pure half: a manual address is a loopback host:port or a
 * socks5/http(s) URL. A remote host, including a Japan node, is `remote` and is not a hop.
 * Credentials (`@`) are `invalid` and are not parsed into a host. Auto-detect keeps only
 * loopback hops from an scutil dump, then `127.0.0.1:7890` when that port accepts.
 * `sessionDecision` is null when the switch is off or no hop is saved, so the OS path may run.
 * A non-loopback host, or a saved hop whose port is closed, is `{ kind: "direct" }` so a Japan
 * OS proxy cannot win. An accepting loopback hop is that hop.
 * Does not open a socket, read the OS, or write `process.env`.
 */

import { isDynamicRecord } from "@openbot/contracts/runtime-values";

export type UserProxyScheme = "http" | "socks5";
export type UserProxySource = "manual" | "auto" | "none";

/** A hop that may be saved. `port` 0 and an empty host mean there is no hop. */
export interface StoredUserProxy {
  enabled: boolean;
  source: UserProxySource;
  scheme: UserProxyScheme;
  host: string;
  port: number;
}

export type ManualProxyParse =
  | { ok: true; scheme: UserProxyScheme; host: string; port: number }
  | { ok: false; error: "remote" | "invalid" };

export interface ProxyHop {
  scheme: UserProxyScheme;
  host: string;
  port: number;
}

/**
 * What Chromium and the child environment should do with one saved preference.
 * Null defers to the OS. `direct` owns the decision and must not fall through.
 */
export type UserProxySessionDecision =
  | null
  | { kind: "direct" }
  | { kind: "http" | "socks"; host: string; port: number };

/** Clash mixed port on this machine. Tried only after scutil has no accepting loopback hop. */
export const LOCAL_CLASH_HOP: ProxyHop = { scheme: "socks5", host: "127.0.0.1", port: 7890 };

const MANUAL_TEXT_LIMIT = 300;

/**
 * No saved hop. Guarantees a value `decodeStoredProxy` accepts. Does not enable the proxy.
 */
export function emptyStoredProxy(): StoredUserProxy {
  return { enabled: false, source: "none", scheme: "socks5", host: "", port: 0 };
}

/**
 * Whether `host` is this computer. Guarantees true only for `localhost`, `::1`, `[::1]`,
 * and a four-octet `127.0.0.0`–`127.255.255.255`. A Japan address, a hostname, and `127.1`
 * are false. Does not resolve DNS.
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1") return true;
  if (!normalized.startsWith("127.")) return false;
  const parts = normalized.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * `host:port` for a proxy URL. Guarantees an IPv6 host is bracketed so the port is not
 * read as part of the address. Does not check that the host is loopback.
 */
export function proxyEndpoint(host: string, port: number): string {
  const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${bracketed}:${port}`;
}

/**
 * Parse what the user typed. Guarantees a saved hop is loopback and has no userinfo.
 * A URL scheme wins over `uiScheme`. `https` is stored as `http` because a mixed port
 * accepts HTTP CONNECT. A remote host is `remote`; anything else that is not a hop is
 * `invalid`. Does not open a socket and does not keep credentials.
 */
export function parseManualProxy(text: string, uiScheme: UserProxyScheme): ManualProxyParse {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MANUAL_TEXT_LIMIT) return { ok: false, error: "invalid" };
  // Credentials never become a host. Checked before URL parsing so `user:pass@` is not saved.
  if (trimmed.includes("@")) return { ok: false, error: "invalid" };
  if (trimmed.includes("://")) return parseProxyUrl(trimmed);
  return parseHostPort(trimmed, uiScheme);
}

/**
 * Loopback hops named by `scutil --proxy`, HTTPS then HTTP then SOCKS.
 * Guarantees a non-loopback host is absent, so a Japan node in the system list is not chosen.
 * Does not check that the port accepts a connection.
 */
export function loopbackHopsFromScutil(text: string): ProxyHop[] {
  const hops: ProxyHop[] = [];
  const seen = new Set<string>();
  for (const kind of ["HTTPS", "HTTP", "SOCKS"] as const) {
    if (!new RegExp(`${kind}Enable\\s*:\\s*1`).test(text)) continue;
    const host = text.match(new RegExp(`${kind}Proxy\\s*:\\s*(\\S+)`))?.[1];
    const port = Number(text.match(new RegExp(`${kind}Port\\s*:\\s*(\\d+)`))?.[1]);
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    if (!isLoopbackHost(host)) continue;
    const scheme: UserProxyScheme = kind === "SOCKS" ? "socks5" : "http";
    const key = `${host.toLowerCase()}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hops.push({ scheme, host: normalizeHost(host), port });
  }
  return hops;
}

/**
 * The first accepting loopback hop, else Clash when its port accepts.
 * Guarantees null when every candidate is remote or closed. Does not invent credentials.
 * `portAccepts` must already refuse a non-loopback host; this function also skips those.
 */
export function chooseAutoHop(
  scutilText: string | null,
  portAccepts: (host: string, port: number) => boolean,
): ProxyHop | null {
  const candidates = scutilText ? loopbackHopsFromScutil(scutilText) : [];
  for (const hop of candidates) {
    if (portAccepts(hop.host, hop.port)) return hop;
  }
  const clashTried = candidates.some(
    (hop) => hop.host === LOCAL_CLASH_HOP.host && hop.port === LOCAL_CLASH_HOP.port,
  );
  if (!clashTried && portAccepts(LOCAL_CLASH_HOP.host, LOCAL_CLASH_HOP.port)) return LOCAL_CLASH_HOP;
  return null;
}

/**
 * Environment for one hop. Guarantees `HTTPS_PROXY` and `HTTP_PROXY` are `http://host:port`
 * even when the hop is SOCKS5, so a client without SOCKS still reaches a mixed port.
 * SOCKS5 also sets `ALL_PROXY` to `socks5://host:port`. `NO_PROXY` skips loopback targets,
 * not the proxy itself. Null clears nothing: the caller restores the previous environment.
 * Does not prove the proxy can reach a host.
 */
export function proxyChildEnvironment(hop: ProxyHop | null): Record<string, string> {
  if (!hop) return {};
  const httpUrl = `http://${proxyEndpoint(hop.host, hop.port)}`;
  const env: Record<string, string> = {
    HTTP_PROXY: httpUrl,
    HTTPS_PROXY: httpUrl,
    http_proxy: httpUrl,
    https_proxy: httpUrl,
    NO_PROXY: "localhost,127.0.0.1,::1",
    no_proxy: "localhost,127.0.0.1,::1",
  };
  const allProxy =
    hop.scheme === "socks5" ? `socks5://${proxyEndpoint(hop.host, hop.port)}` : httpUrl;
  env.ALL_PROXY = allProxy;
  env.all_proxy = allProxy;
  return env;
}

/**
 * What this saved preference does to the session.
 *
 * Guarantees: the switch off, or on with no host, returns null so the OS path may run.
 * A non-loopback host, a port outside 1–65535, or a loopback port that does not accept,
 * returns `{ kind: "direct" }` so a Japan OS proxy cannot win. An accepting loopback hop
 * returns that hop, with SOCKS5 mapped to `socks`. Does not open a socket; `portAccepts` does.
 * `portAccepts` is not called for a remote host.
 */
export function sessionDecision(
  stored: StoredUserProxy,
  portAccepts: (host: string, port: number) => boolean,
): UserProxySessionDecision {
  if (!stored.enabled || stored.host === "") return null;
  if (!isLoopbackHost(stored.host)) return { kind: "direct" };
  if (!Number.isInteger(stored.port) || stored.port < 1 || stored.port > 65535) return { kind: "direct" };
  if (!portAccepts(stored.host, stored.port)) return { kind: "direct" };
  return {
    kind: stored.scheme === "socks5" ? "socks" : "http",
    host: stored.host,
    port: stored.port,
  };
}

/**
 * Read a version 1 preference file. Guarantees null when the host is not loopback, so a
 * tampered Japan address is never applied. A missing file is the caller's default, not this
 * function's. Does not open a socket.
 */
export function decodeStoredProxy(parsed: unknown): StoredUserProxy | null {
  if (!isDynamicRecord(parsed) || parsed.version !== 1) return null;
  const source = parsed.source;
  const scheme = parsed.scheme;
  if (source !== "manual" && source !== "auto" && source !== "none") return null;
  if (scheme !== "http" && scheme !== "socks5") return null;
  if (typeof parsed.host !== "string" || typeof parsed.port !== "number") return null;
  const enabled = parsed.enabled === true;
  if (parsed.host === "" && parsed.port === 0 && source === "none") {
    return { enabled, source, scheme, host: "", port: 0 };
  }
  if (!isLoopbackHost(parsed.host)) return null;
  if (!Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535) return null;
  return { enabled, source, scheme, host: normalizeHost(parsed.host), port: parsed.port };
}

/**
 * A URL the user pasted. A missing port is invalid: this does not assume 1080 or 7890.
 */
function parseProxyUrl(text: string): ManualProxyParse {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "invalid" };
  }
  const protocol = url.protocol.toLowerCase();
  const scheme: UserProxyScheme | null =
    protocol === "http:" || protocol === "https:" ? "http" : protocol === "socks5:" || protocol === "socks:" ? "socks5" : null;
  if (!scheme) return { ok: false, error: "invalid" };
  if (url.username || url.password) return { ok: false, error: "invalid" };
  if (url.pathname !== "" && url.pathname !== "/") return { ok: false, error: "invalid" };
  if (url.search || url.hash) return { ok: false, error: "invalid" };
  if (url.port === "") return { ok: false, error: "invalid" };
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: "invalid" };
  const host = normalizeHost(url.hostname);
  if (!isLoopbackHost(host)) return { ok: false, error: "remote" };
  return { ok: true, scheme, host, port };
}

/**
 * `host:port` with no scheme. A host:port that is not loopback is remote, not a typo.
 */
function parseHostPort(text: string, scheme: UserProxyScheme): ManualProxyParse {
  const match = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1):(\d{1,5})$/i.exec(text);
  if (!match) {
    if (/^\S+:\d{1,5}$/.test(text)) return { ok: false, error: "remote" };
    return { ok: false, error: "invalid" };
  }
  const host = normalizeHost(match[1] ?? "");
  const port = Number(match[2]);
  if (!isLoopbackHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "invalid" };
  }
  return { ok: true, scheme, host, port };
}

/**
 * Store `localhost` and `::1` in one spelling. Does not accept a remote host.
 */
function normalizeHost(host: string): string {
  const stripped = host.replace(/^\[|\]$/g, "").toLowerCase();
  return stripped === "localhost" ? "localhost" : stripped;
}
