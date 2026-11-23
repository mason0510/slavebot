import type { AgentProviderStatus } from "@openbot/contracts/ipc";
import { agentProviderName } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import type { AgentProvider } from "./agent-client";
import { causeHelpers } from "./effect-boundary";
import {
  ensureGrokApiKeyInjected,
  envHoldsGrokApiKey,
  grokChildHasInjectedKey,
  grokKeyLoadFailed,
} from "./grok-key-injection";
import { getString } from "./protocol";

/** Preserves provider SDK failures at the existing Promise interfaces. */
export class ProviderClientOperationError extends Schema.TaggedError<ProviderClientOperationError>()(
  "ProviderClientOperationError",
  {
    cause: Schema.Defect(),
  },
) {}

export const { rewrap: toProviderClientOperationError } = causeHelpers(ProviderClientOperationError);

/** A sign-in failure with a safe message for the user. The provider status shows it as it is. */
export class ProviderSignInError extends Schema.TaggedError<ProviderSignInError>()("ProviderSignInError", {
  message: Schema.String,
}) {}

/**
 * Grok already had an API key, and the start still had no account.
 * Guarantees: this is an injection failure, so a start must not finish as sign-in-required.
 * Does not guarantee: which key was refused, or that a later start will apply it.
 * The message has no key value.
 */
export class GrokKeyInjectionError extends Schema.TaggedError<GrokKeyInjectionError>()("GrokKeyInjectionError", {
  message: Schema.String,
}) {}

/**
 * True when startup must not finish as a Grok sign-in.
 * Guarantees: a non-empty `XAI_API_KEY`, any non-empty variable whose name contains `GROK_API_KEY`, a child that already received the Keychain key, or a ready Keychain injection for the live process, is enough.
 * Does not guarantee: the key is accepted, or that a key saved only in the vault or under another name was copied.
 * A caller-supplied `env` is the test boundary and does not read Keychain. The value is never returned.
 */
export function grokApiKeyInjected(env: NodeJS.ProcessEnv = process.env): boolean {
  if (envHoldsGrokApiKey(env)) return true;
  // Only the live process consults Keychain. A copied env must not hide a missing test fixture.
  if (env !== process.env) return false;
  if (grokChildHasInjectedKey()) return true;
  return ensureGrokApiKeyInjected(env);
}

/**
 * True when a Grok row must not finish as a sign-in.
 * Guarantees: a present key, a child that already received one, or a Keychain read that failed instead of confirming absence, is enough.
 * Does not guarantee: the key was accepted. A caller-supplied `env` does not consult the live load. A confirmed absence still allows sign-in.
 */
export function grokMustNotAskSignIn(env: NodeJS.ProcessEnv = process.env): boolean {
  if (grokApiKeyInjected(env)) return true;
  if (env !== process.env) return false;
  return grokKeyLoadFailed();
}

/**
 * The sentence a Grok start shows when it must not ask for a sign-in.
 * Guarantees: a failed Keychain read names the read and the terminal start that carries the key. A present key names the missed injection. The sentence has no key value.
 * Does not guarantee: the next start applies the key, or that quitting the open app was done. `refresh` is the sentence after automatic retries are exhausted.
 * `failedRead` is the load outcome from before a retry clears the failed cache. The default reads that cache. `command` is this process's executable path.
 */
export function grokKeyFailureText(refresh = false, failedRead = grokKeyLoadFailed()): string {
  const provider = agentProviderName("grok");
  // A failed read and a missed injection are different reminders. Clearing the cache first would hide the read.
  // A Dock launch does not load the shell key. The same binary started from Terminal inherits it.
  if (failedRead) {
    return sourceText(refresh ? "error.provider.grokKeyReadRefresh" : "error.provider.grokKeyReadFailed", {
      provider,
      command: process.execPath,
    });
  }
  return sourceText(refresh ? "error.provider.grokKeyInjectionRefresh" : "error.provider.grokKeyInjectionFailed", {
    provider,
  });
}

/**
 * The sentence to toast for this Grok failure.
 * Guarantees: a GrokKeyInjectionError, or a published read or injection sentence, returns that sentence.
 * Does not guarantee: a toast was shown. Another provider, or a confirmed absence, returns null. The sentence has no key value.
 * `publishedMessage` is the row text already chosen for the user. It wins over the thrown error when both are known sentences.
 */
export function grokKeyInjectionNotice(
  provider: AgentProvider,
  error: unknown,
  publishedMessage: string | null,
): string | null {
  if (provider !== "grok") return null;
  const known = new Set([
    grokKeyFailureText(false, false),
    grokKeyFailureText(true, false),
    grokKeyFailureText(false, true),
    grokKeyFailureText(true, true),
  ]);
  if (publishedMessage && known.has(publishedMessage)) return publishedMessage;
  if (error instanceof GrokKeyInjectionError) return error.message;
  return null;
}

/**
 * Stops a present Grok key from being published as a sign-in.
 * Guarantees: Grok with an injected key, or a failed Keychain read, never keeps `sign-in-required`. A failed read names the read.
 * Does not guarantee: the key was accepted, or that another provider's sign-in changes. A confirmed absence stays signed out.
 * `status` is one provider row without its id. The message has no key value.
 */
export function grokStatusWithoutSignIn(
  provider: AgentProvider,
  status: Omit<AgentProviderStatus, "id">,
): Omit<AgentProviderStatus, "id"> {
  if (provider !== "grok" || status.state !== "sign-in-required" || !grokMustNotAskSignIn()) return status;
  return {
    ...status,
    state: "error",
    message: grokKeyFailureText(),
  };
}

export function providerFailure(cause: unknown): ProviderClientOperationError {
  return cause instanceof ProviderClientOperationError ? cause : new ProviderClientOperationError({ cause });
}
export function providerCall<A>(operation: () => A | Promise<A>): Effect.Effect<A, ProviderClientOperationError> {
  return Effect.tryPromise({ try: () => Promise.resolve(operation()), catch: providerFailure });
}
export const providerSync = <A>(operation: () => A) => Effect.try({ try: operation, catch: providerFailure });

/** Lets a native catch keep loop control and inspect the original operational error. */
export function providerResult<A>(result: Result.Result<A, ProviderClientOperationError>): A {
  if (Result.isFailure(result)) throw result.failure.cause;
  return result.success;
}

export function requiredString(value: unknown, key: string): string {
  const result = getString(value, key);
  if (!result) throw new Error(`${key} is required.`);
  return result;
}
