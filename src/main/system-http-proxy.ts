/**
 * Apply the machine HTTP proxy to main-process `fetch` and to the Chromium session.
 *
 * Chromium's `mode: "system"` can pick a SOCKS entry on the same port as the HTTP proxy. That
 * breaks `wss`. This reads the OS proxy and, when one exists, sets that hop explicitly. No hop
 * means the session is left alone.
 *
 * Algorithm ApplySystemHttpProxy: before `app.whenReady()`, read the OS proxy and, when one
 * exists, set Chromium `--proxy-server`. After ready, set the same hop on the default session.
 * Prefer HTTPS, then HTTP, then SOCKS. Skip a hop whose TCP port does not accept a connection,
 * then try the next distinct host:port. A closed hop is never applied, including the hop
 * Chromium `resolveProxy` would still name. The HTTP form is one `http://host:port` rule so
 * `wss` does not stay DIRECT. A machine proxy also disables HTTP/2 so Signal can send a classic
 * upgrade. No hop does not call `setProxy` and does not set either switch. A process
 * `HTTP_PROXY` is not a machine proxy and is ignored. A listening port does not prove the
 * proxy can reach the origin.
 *
 * Algorithm RefreshSystemHttpProxy: every 10 seconds, and before a Signal window opens, read
 * the OS proxy again. A new accepting hop replaces the session proxy and closes old
 * connections. No accepting hop clears a previously applied hop to direct. The same hop is
 * left alone. The process does not need a restart. The command-line switch from startup is
 * overridden by `setProxy` on the session.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createOpenBotLogger } from "@openbot/logging";
import { app, net, type Session, session } from "electron";

import { proxyRefreshAction } from "./system-http-proxy-choice";

const logger = createOpenBotLogger("system-http-proxy");

const LOOPBACK_BYPASS = "localhost,127.0.0.1,::1,<local>";
const LOOPBACK_BYPASS_SWITCH = "localhost;127.0.0.1;::1;<local>";
const PROXY_REFRESH_MS = 10_000;

type ProxyHop = { kind: "direct" } | { kind: "http" | "socks"; host: string; port: number };
type AcceptingHop = Exclude<ProxyHop, { kind: "direct" }>;

let fetchPatched = false;
let appliedHopKey: string | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshChain: Promise<void> = Promise.resolve();

/**
 * Set Chromium's process proxy switch before `app.whenReady()`.
 *
 * Guarantees: an enabled OS HTTP proxy whose port accepts TCP becomes
 * `--proxy-server=http://host:port` and disables HTTP/2, so Signal can send a classic Upgrade.
 * A closed port is skipped. SOCKS is used when earlier HTTP hops are off or closed.
 * No accepting hop leaves both switches unset. Does not read process environment proxy variables.
 */
export function applyStartupChromiumProxy(): void {
  const hop = readDarwinProxySync();
  if (!hop) {
    logger.info("No machine proxy. Chromium proxy switch stays unset.");
    return;
  }
  app.commandLine.appendSwitch("proxy-server", chromiumProxyRules(hop));
  app.commandLine.appendSwitch("proxy-bypass-list", LOOPBACK_BYPASS_SWITCH);
  // Attendant accepts a classic Upgrade. Electron has no per-session HTTP/2 switch. This applies
  // only when a machine proxy exists, so a direct launch keeps HTTP/2.
  app.commandLine.appendSwitch("disable-http2");
  logger.info("Set the Chromium proxy switch.", { kind: hop.kind, host: hop.host, port: hop.port });
}

/**
 * Route later main-process HTTP through the OS proxy.
 *
 * Guarantees: Node `fetch` uses Chromium `net.fetch` when a proxy hop exists. DIRECT is a no-op.
 * Does not guarantee the proxy answers, and does not log credentials.
 */
export async function applySystemHttpProxy(targetUrl: string): Promise<void> {
  await refreshSystemHttpProxy(targetUrl);
}

/**
 * Re-read the OS proxy and switch the default session when the accepting hop changed.
 *
 * Guarantees: a closed port is not applied. A new accepting hop replaces the old one and
 * closes existing connections. No accepting hop clears a hop that was already applied.
 * The same hop does not call `setProxy`. Does not restart the process, and does not prove
 * the new hop can reach the account host.
 */
export function refreshSystemHttpProxy(targetUrl: string): Promise<void> {
  refreshChain = refreshChain.then(() => refreshOnce(targetUrl)).catch((error: unknown) => {
    logger.warn("The machine proxy could not be refreshed.", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
  return refreshChain;
}

/**
 * Keep checking the OS proxy until `stop` is called.
 *
 * Guarantees: the first check runs immediately, then every 10 seconds. `stop` clears the
 * timer. Does not refresh after `stop`. The timer does not hold the process open.
 */
export function startSystemHttpProxyRefresh(targetUrl: string): () => void {
  void refreshSystemHttpProxy(targetUrl);
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    void refreshSystemHttpProxy(targetUrl);
  }, PROXY_REFRESH_MS);
  refreshTimer.unref();
  return () => {
    if (!refreshTimer) return;
    clearInterval(refreshTimer);
    refreshTimer = null;
  };
}

/**
 * Put the same OS hop on one window session before that window opens Signal.
 *
 * Guarantees: when the OS has a proxy, `setProxy` uses one rule for every scheme, including `wss`.
 * No accepting hop sets the window session to direct, so a dead startup hop does not stay.
 * Does not prove the later socket opens.
 */
export async function ensureChromiumProxy(target: Session): Promise<void> {
  await refreshSystemHttpProxy(signalAccountUrl());
  const hop = acceptingMachineProxySync();
  if (!hop) {
    await target.setProxy({ mode: "direct" });
    return;
  }
  await target.setProxy({
    mode: "fixed_servers",
    proxyRules: chromiumProxyRules(hop),
    proxyBypassRules: LOOPBACK_BYPASS,
  });
}

/**
 * The account URL used when a Signal window refreshes before its own URL is known.
 * A missing packaged URL still probes the local attendant. Does not open a socket.
 */
function signalAccountUrl(): string {
  return process.env.OPENBOT_AUTH_API_URL || "https://api-attendant.mwcpool.uk";
}

/**
 * Apply one accepting hop, or clear the session when the last hop died.
 *
 * Guarantees: `setProxy` runs only when the accepting hop key changed. A dead hop becomes
 * `mode: "direct"`. Does not use `resolveProxy` to resurrect a port that just failed TCP.
 */
async function refreshOnce(targetUrl: string): Promise<void> {
  const hop = await readAcceptingMachineProxy(targetUrl);
  const action = proxyRefreshAction(appliedHopKey, hop);
  if (action === "keep") return;
  if (action === "direct" || !hop) {
    await session.defaultSession.setProxy({ mode: "direct" });
    await session.defaultSession.closeAllConnections();
    logger.info("Cleared the machine proxy. Account HTTP is direct.", { from: appliedHopKey });
    appliedHopKey = null;
    return;
  }
  const from = appliedHopKey;
  await applyHop(hop, targetUrl);
  appliedHopKey = `${hop.kind}:${hop.host}:${hop.port}`;
  if (from) {
    logger.info("Switched the machine proxy.", {
      from,
      kind: hop.kind,
      host: hop.host,
      port: hop.port,
    });
  }
}

/**
 * The first OS hop whose TCP port accepts a connection.
 *
 * Guarantees: on macOS, a closed scutil hop is null even if Chromium still names it.
 * Other platforms TCP-check the first `resolveProxy` hop. Does not apply the hop.
 */
async function readAcceptingMachineProxy(targetUrl: string): Promise<AcceptingHop | null> {
  if (process.platform === "darwin") return acceptingMachineProxySync();
  const resolved = await readSystemProxyHop(targetUrl);
  if (!resolved || resolved.kind === "direct") return null;
  if (tcpPortAcceptsSync(resolved.host, resolved.port)) return resolved;
  logger.info("Skipped a machine proxy that did not accept a connection.", {
    kind: resolved.kind,
    host: resolved.host,
    port: resolved.port,
  });
  return null;
}

/**
 * Synchronous macOS probe used before a window opens Signal.
 * A non-macOS process returns null and the async refresh does the check.
 */
function acceptingMachineProxySync(): AcceptingHop | null {
  return readDarwinProxySync();
}

async function applyHop(hop: AcceptingHop, targetUrl: string): Promise<void> {
  await session.defaultSession.setProxy({
    mode: "fixed_servers",
    proxyRules: chromiumProxyRules(hop),
    proxyBypassRules: LOOPBACK_BYPASS,
  });
  await session.defaultSession.closeAllConnections();
  patchFetchThroughChromium();
  const signalUrl = signalProbeUrl(targetUrl);
  logger.info("Applied a proxy to account HTTP.", {
    kind: hop.kind,
    host: hop.host,
    port: hop.port,
    httpsProxy: await session.defaultSession.resolveProxy(targetUrl),
    signalProxy: signalUrl === null ? "skipped" : await session.defaultSession.resolveProxy(signalUrl),
  });
}

/**
 * The OS proxy read, for the startup switch and the 10-second refresh.
 * A read failure is no proxy. Does not use the process environment.
 */
function readDarwinProxySync(): Exclude<ProxyHop, { kind: "direct" }> | null {
  if (process.platform !== "darwin") return null;
  try {
    return preferScutilHop(execFileSync("scutil", ["--proxy"], { timeout: 2000, encoding: "utf8" }));
  } catch (error) {
    logger.warn("The macOS proxy list could not be read.", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * HTTPS, then HTTP, then SOCKS. A closed TCP port is skipped. An absent or all-closed list is no
 * proxy.
 */
function preferScutilHop(text: string): Exclude<ProxyHop, { kind: "direct" }> | null {
  const seen = new Set<string>();
  for (const hop of [scutilHop(text, "HTTPS"), scutilHop(text, "HTTP"), scutilHop(text, "SOCKS")]) {
    if (!hop) continue;
    const key = `${hop.host}:${hop.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (tcpPortAcceptsSync(hop.host, hop.port)) return hop;
    logger.info("Skipped a machine proxy that did not accept a connection.", {
      kind: hop.kind,
      host: hop.host,
      port: hop.port,
    });
  }
  return null;
}

/**
 * Whether `host:port` accepts a TCP connect.
 *
 * Guarantees: a refused, timed-out, or unreachable port is false. A listening port is true.
 * The packaged app has the Electron RunAsNode fuse off, so this probes with the system
 * `nc` and never spawns `process.execPath`. Spawning the app binary starts a second
 * slavebot, times out, and would mark every hop closed.
 * Does not prove the process is a working HTTP or SOCKS proxy. A missing `nc` is false.
 * `host` must be a hostname or IP with no spaces; anything else is false.
 */
function tcpPortAcceptsSync(host: string, port: number): boolean {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  if (host.length === 0 || host.length > 253 || /[^\w.:\[\]-]/.test(host)) return false;
  const probe = tcpProbeCommand(host, port);
  const result = spawnSync(probe.command, probe.args, {
    timeout: 2_500,
    stdio: "ignore",
    windowsHide: true,
  });
  return result.status === 0;
}

/**
 * The system TCP probe for one hop.
 *
 * Guarantees: arguments are passed as an argv list, not a shell string.
 * macOS uses `/usr/bin/nc -z -G 1` because `-G` is the connect timeout in seconds.
 * Other platforms use `nc -z -w 1`. Does not fall back to the Electron binary.
 */
function tcpProbeCommand(host: string, port: number): { command: string; args: string[] } {
  const portText = String(port);
  if (process.platform === "darwin") {
    return { command: "/usr/bin/nc", args: ["-z", "-G", "1", host, portText] };
  }
  return { command: "nc", args: ["-z", "-w", "1", host, portText] };
}

/** One enabled scutil proxy block, or null when that kind is off. */
function scutilHop(text: string, kind: "HTTP" | "HTTPS" | "SOCKS"): Exclude<ProxyHop, { kind: "direct" }> | null {
  if (!new RegExp(`${kind}Enable\\s*:\\s*1`).test(text)) return null;
  const host = text.match(new RegExp(`${kind}Proxy\\s*:\\s*(\\S+)`))?.[1];
  const port = Number(text.match(new RegExp(`${kind}Port\\s*:\\s*(\\d+)`))?.[1]);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { kind: kind === "SOCKS" ? "socks" : "http", host, port };
}

/**
 * The OS proxy Chromium would use for `targetUrl`. A resolve failure is treated as no system proxy.
 */
async function readSystemProxyHop(targetUrl: string): Promise<ProxyHop | null> {
  try {
    return parseFirstProxyHop(await session.defaultSession.resolveProxy(targetUrl));
  } catch (error) {
    logger.warn("The system proxy for the account service could not be resolved.", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Take the first usable hop from a PAC result such as `PROXY 127.0.0.1:7890; DIRECT`.
 */
function parseFirstProxyHop(pac: string): ProxyHop {
  for (const part of pac.split(";")) {
    const hop = part.trim();
    if (!hop || hop.toUpperCase() === "DIRECT") continue;
    const match = /^(PROXY|HTTPS|HTTP|SOCKS5?|SOCKS4) (\S+):(\d+)$/iu.exec(hop);
    if (!match) continue;
    const scheme = match[1];
    const host = match[2];
    const portText = match[3];
    if (!scheme || !host || !portText) continue;
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const kind = scheme.toUpperCase().startsWith("SOCKS") ? "socks" : "http";
    return { kind, host, port };
  }
  return { kind: "direct" };
}

/**
 * Chromium `proxyRules` for one hop. Loopback bypass stays in `proxyBypassRules`.
 */
function chromiumProxyRules(hop: Exclude<ProxyHop, { kind: "direct" }>): string {
  const endpoint = `${hop.host}:${hop.port}`;
  // One proxy URL covers http, https, ws, and wss. A scheme rule can leave wss DIRECT.
  return hop.kind === "socks" ? `socks5://${endpoint}` : `http://${endpoint}`;
}

/**
 * A `wss` URL on the account host, used only to ask Chromium which proxy it would use.
 * A URL that is not http(s) returns null. The result is not a request.
 */
function signalProbeUrl(targetUrl: string): string | null {
  try {
    const url = new URL(targetUrl);
    if (url.protocol === "https:") url.protocol = "wss:";
    else if (url.protocol === "http:") url.protocol = "ws:";
    else return null;
    url.pathname = "/signal";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Replace Node `fetch` with Chromium `net.fetch` once. Non-HTTP URLs keep the original fetch.
 */
function patchFetchThroughChromium(): void {
  if (fetchPatched) return;
  fetchPatched = true;
  const original = globalThis.fetch;
  function proxied(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = requestUrl(input);
    if (!url.startsWith("http://") && !url.startsWith("https://")) return original(input, init);
    return net.fetch(netFetchInput(input), init);
  }
  globalThis.fetch = Object.assign(proxied, original);
}

/**
 * `net.fetch` accepts a string or Request. A URL object is converted to its href.
 */
function netFetchInput(input: RequestInfo | URL): string | Request {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input;
}

/**
 * Absolute URL of a fetch input. A relative string cannot go to `net.fetch`.
 */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}
