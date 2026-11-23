/**
 * The saved local proxy, and the environment the next assistant process should see.
 *
 * Algorithm ApplyUserProxy, stored half: a manual or detected hop is saved only when
 * `parseManualProxy` or `chooseAutoHop` accepts it. A remote host, including a Japan node,
 * is an in-memory error and is not written. A closed saved hop still stays saved, but
 * `syncEnvironment` returns `{ kind: "direct" }` so a Japan OS proxy cannot win.
 * Toggle off keeps the address and clears the child overlay.
 * Does not import Electron, and does not log the address or an scutil dump.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { connect } from "node:net";
import { Effect } from "effect";
import type { UserProxyChange, UserProxyPreference } from "@openbot/contracts/ipc";
import {
  chooseAutoHop,
  decodeStoredProxy,
  emptyStoredProxy,
  isLoopbackHost,
  parseManualProxy,
  proxyChildEnvironment,
  sessionDecision,
  type StoredUserProxy,
  type UserProxySessionDecision,
} from "../backend/user-proxy-choice";
import { applyUserProxyProcessEnv, clearUserProxyProcessEnv } from "../backend/user-proxy-env";
import { PreferenceStore, type PreferenceFileFailure } from "./preference-file";

const PING_MS = 800;

/**
 * One preference file and the in-memory error from the last rejected write.
 *
 * Guarantees: `load` does not call `onChanged`. A failed manual or detect does not save and
 * does not call `onChanged`. `syncEnvironment` does not call `onChanged`. A thrown
 * `portAccepts` becomes `{ kind: "direct" }` so the OS hop is not used. Does not prove a
 * remote host is reachable, and does not rewrite a file `decodeStoredProxy` rejects.
 */
export class UserProxyService {
  readonly #store: PreferenceStore<StoredUserProxy>;
  readonly #onChanged: () => void;
  readonly #portAccepts: (host: string, port: number) => boolean;
  readonly #readScutil: () => string | null;
  readonly #ping: (host: string, port: number) => Promise<number | null>;
  #error: UserProxyPreference["error"] = null;
  #chain: Promise<void> = Promise.resolve();

  constructor(options: {
    path: string;
    onChanged: () => void;
    portAccepts?: (host: string, port: number) => boolean;
    readScutil?: () => string | null;
    ping?: (host: string, port: number) => Promise<number | null>;
  }) {
    this.#store = new PreferenceStore({
      path: options.path,
      defaultValue: emptyStoredProxy(),
      decode: decodeStoredProxy,
    });
    this.#onChanged = options.onChanged;
    this.#portAccepts = options.portAccepts ?? defaultPortAccepts;
    this.#readScutil = options.readScutil ?? defaultReadScutil;
    this.#ping = options.ping ?? defaultPing;
  }

  /**
   * Read the file into memory. Guarantees a missing or rejected file stays the empty default
   * and is not rewritten. Does not apply the hop and does not call `onChanged`.
   */
  load(): Effect.Effect<void, PreferenceFileFailure> {
    return this.#store.load();
  }

  /**
   * Put the saved decision on this process. Guarantees an accepting loopback hop sets the
   * child overlay, and every other decision clears it. Does not call `onChanged`, and does
   * not open a remote connection.
   */
  syncEnvironment(): UserProxySessionDecision {
    let decision: UserProxySessionDecision;
    try {
      decision = sessionDecision(this.#store.get(), this.#portAccepts);
    } catch {
      decision = { kind: "direct" };
    }
    if (decision && decision.kind !== "direct") {
      applyUserProxyProcessEnv(
        proxyChildEnvironment({
          scheme: decision.kind === "socks" ? "socks5" : "http",
          host: decision.host,
          port: decision.port,
        }),
      );
    } else {
      clearUserProxyProcessEnv();
    }
    return decision;
  }

  /**
   * Drop the child overlay. Guarantees a shell proxy snapshotted by the first apply comes back.
   * Does not change the saved preference.
   */
  clearEnvironment(): void {
    clearUserProxyProcessEnv();
  }

  /**
   * The panel view. Guarantees a disabled or empty hop is not probed. A thrown probe is
   * `accepting: false`. Does not save, and does not call `onChanged`.
   */
  async view(): Promise<UserProxyPreference> {
    const stored = this.#store.get();
    const base: UserProxyPreference = {
      enabled: stored.enabled,
      source: stored.source,
      scheme: stored.host === "" ? "none" : stored.scheme,
      host: stored.host,
      port: stored.port,
      accepting: false,
      pingMs: null,
      error: this.#error,
    };
    if (!stored.enabled || stored.host === "" || !isLoopbackHost(stored.host)) return base;
    let accepting = false;
    try {
      accepting = this.#portAccepts(stored.host, stored.port);
    } catch {
      accepting = false;
    }
    if (!accepting) return base;
    let pingMs: number | null = null;
    try {
      pingMs = await this.#ping(stored.host, stored.port);
    } catch {
      pingMs = null;
    }
    return { ...base, accepting: true, pingMs };
  }

  /**
   * Apply one panel change. Guarantees two clicks cannot interleave writes. A rejected
   * manual or detect leaves the file alone. Does not log the typed address.
   */
  apply(change: UserProxyChange): Promise<UserProxyPreference> {
    const run = this.#chain.then(() => this.#apply(change));
    this.#chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #apply(change: UserProxyChange): Promise<UserProxyPreference> {
    if (change.action === "enabled") {
      this.#error = null;
      await this.#save({ ...this.#store.get(), enabled: change.enabled });
      return this.view();
    }
    if (change.action === "clear") {
      this.#error = null;
      await this.#save(emptyStoredProxy());
      return this.view();
    }
    if (change.action === "manual") {
      const parsed = parseManualProxy(change.text, change.scheme);
      if (!parsed.ok) {
        this.#error = parsed.error;
        return this.view();
      }
      this.#error = null;
      await this.#save({
        enabled: true,
        source: "manual",
        scheme: parsed.scheme,
        host: parsed.host,
        port: parsed.port,
      });
      return this.view();
    }
    const hop = chooseAutoHop(this.#readScutil(), this.#portAccepts);
    if (!hop) {
      this.#error = "none-found";
      return this.view();
    }
    this.#error = null;
    await this.#save({
      enabled: true,
      source: "auto",
      scheme: hop.scheme,
      host: hop.host,
      port: hop.port,
    });
    return this.view();
  }

  /**
   * Persist one accepted value, then refresh the child overlay. Guarantees `onChanged` runs
   * only after the overlay matches the saved value. A failed write does not call `onChanged`.
   */
  async #save(value: StoredUserProxy): Promise<void> {
    await Effect.runPromise(this.#store.set(value));
    this.syncEnvironment();
    this.#onChanged();
  }
}

/**
 * Whether a loopback port accepts TCP. Guarantees a non-loopback host is false without a probe.
 * Uses system `nc` and never `process.execPath`. A missing `nc` is false. Does not prove the
 * process is a proxy.
 */
function defaultPortAccepts(host: string, port: number): boolean {
  if (!isLoopbackHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) return false;
  const command = process.platform === "darwin" ? "/usr/bin/nc" : "nc";
  const args =
    process.platform === "darwin" ? ["-z", "-G", "1", host, String(port)] : ["-z", "-w", "1", host, String(port)];
  const result = spawnSync(command, args, { timeout: 2_500, stdio: "ignore", windowsHide: true });
  return result.status === 0;
}

/**
 * The macOS proxy list, or null off macOS and on a failed read. Guarantees the text is not logged.
 * Does not choose a hop.
 */
function defaultReadScutil(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    return execFileSync("scutil", ["--proxy"], { timeout: 2000, encoding: "utf8" });
  } catch {
    return null;
  }
}

/**
 * Milliseconds to connect to a loopback port. Guarantees a non-loopback host is not contacted.
 * An error or an 800ms timeout is null. Does not measure a path through the proxy.
 */
function defaultPing(host: string, port: number): Promise<number | null> {
  if (!isLoopbackHost(host)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = connect({ host, port });
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), PING_MS);
    socket.once("connect", () => finish(Date.now() - started));
    socket.once("error", () => finish(null));
  });
}
