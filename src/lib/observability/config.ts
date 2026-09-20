// Turns environment variables + "where am I running" into the logger's configuration. Pure (the
// environment is passed in), so it is testable and the same code decides for the server, the web
// browser and the Android WebView.
//
// Server variables:   LOG_LEVEL, LOG_LEVEL_OVERRIDES, LOG_FORMAT, LOG_STACK_TRACES, LOG_SAMPLE_DEBUG,
//                     APP_ENV, GIT_COMMIT, BUILD_NUMBER
// Client (inlined at build time — only NEXT_PUBLIC_* survives into a browser bundle):
//                     NEXT_PUBLIC_LOG_LEVEL, NEXT_PUBLIC_APP_ENV, NEXT_PUBLIC_GIT_COMMIT,
//                     NEXT_PUBLIC_BUILD_NUMBER, NEXT_PUBLIC_APP_VERSION
import { parseLevel, parseLevelSpec, type Level } from "./core/levels";
import type { SamplingConfig } from "./core/sampling";
import type { Environment, Platform } from "./core/schema";
import type { ConsoleFormat } from "./core/sink";

export interface RuntimeInfo {
  isServer: boolean;
  /** Running inside the Capacitor Android shell. */
  isNative: boolean;
  isTest: boolean;
  nodeEnv?: string;
}

export type LogEnv = Partial<Record<
  | "LOG_LEVEL" | "LOG_LEVEL_OVERRIDES" | "LOG_FORMAT" | "LOG_STACK_TRACES" | "LOG_SAMPLE_DEBUG" | "APP_ENV" | "GIT_COMMIT" | "BUILD_NUMBER"
  | "NEXT_PUBLIC_LOG_LEVEL" | "NEXT_PUBLIC_APP_ENV" | "NEXT_PUBLIC_GIT_COMMIT" | "NEXT_PUBLIC_BUILD_NUMBER" | "NEXT_PUBLIC_APP_VERSION",
  string | undefined
>>;

export interface LoggingConfig {
  service: string;
  platform: Platform;
  environment: Environment;
  level: Level;
  overrides: Record<string, Level>;
  format: ConsoleFormat;
  includeStack: boolean;
  sampling: Partial<SamplingConfig>;
  appVersion?: string;
  buildNumber?: string;
  gitCommit?: string;
  /** Problems found in the environment (unknown level names…) — surfaced once at startup, never fatal. */
  warnings: string[];
}

export function detectRuntime(): RuntimeInfo {
  const scope = globalThis as { window?: { Capacitor?: { isNativePlatform?: () => boolean } }; process?: { env?: Record<string, string | undefined> } };
  const isServer = typeof scope.window === "undefined";
  const nodeEnv = scope.process?.env?.NODE_ENV;
  return {
    isServer,
    isNative: !isServer && Boolean(scope.window?.Capacitor?.isNativePlatform?.()),
    isTest: nodeEnv === "test" || Boolean(scope.process?.env?.VITEST),
    nodeEnv,
  };
}

function parseEnvironment(value: string | undefined, runtime: RuntimeInfo): Environment {
  const v = value?.trim().toLowerCase();
  if (v === "production" || v === "staging" || v === "development") return v;
  return runtime.nodeEnv === "production" ? "production" : "development";
}

function parseFraction(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return undefined;
}

/** Test runs are quiet (errors only); production is INFO; development is DEBUG. */
function defaultLevel(environment: Environment, runtime: RuntimeInfo): Level {
  if (runtime.isTest) return "ERROR";
  return environment === "development" ? "DEBUG" : "INFO";
}

export function resolveLoggingConfig(env: LogEnv, runtime: RuntimeInfo): LoggingConfig {
  const warnings: string[] = [];
  const environment = parseEnvironment(env.APP_ENV ?? env.NEXT_PUBLIC_APP_ENV, runtime);

  // LOG_LEVEL may carry the overrides too ("info,SYNC=debug"); LOG_LEVEL_OVERRIDES adds to them.
  const fromLevel = parseLevelSpec(env.LOG_LEVEL ?? env.NEXT_PUBLIC_LOG_LEVEL);
  const fromOverrides = parseLevelSpec(env.LOG_LEVEL_OVERRIDES);
  for (const bad of [...fromLevel.invalid, ...fromOverrides.invalid]) warnings.push(`ignored unknown log level setting "${bad}"`);

  const level = fromLevel.base ?? fromOverrides.base ?? defaultLevel(environment, runtime);
  const overrides = { ...fromLevel.overrides, ...fromOverrides.overrides };

  const platform: Platform = runtime.isServer ? "server" : runtime.isNative ? "android" : "web";
  const service = runtime.isServer ? "parva-api" : runtime.isNative ? "parva-android" : "parva-web";

  // stdout JSON lines for a server; expandable objects for browser devtools; readable lines in dev
  // (LOG_FORMAT can force any of them).
  const requested = env.LOG_FORMAT?.trim().toLowerCase();
  let format: ConsoleFormat;
  if (requested === "json" || requested === "object" || requested === "pretty") format = requested;
  else if (!runtime.isServer) format = "object";
  else format = environment === "development" && !runtime.isTest ? "pretty" : "json";

  const debugFraction = parseFraction(env.LOG_SAMPLE_DEBUG);
  const sampling: Partial<SamplingConfig> = debugFraction === undefined ? {} : { debug: debugFraction, trace: debugFraction };

  return {
    service,
    platform,
    environment,
    level,
    overrides,
    format,
    includeStack: parseBoolean(env.LOG_STACK_TRACES) ?? true,
    sampling,
    appVersion: env.NEXT_PUBLIC_APP_VERSION || undefined,
    buildNumber: (env.BUILD_NUMBER ?? env.NEXT_PUBLIC_BUILD_NUMBER) || undefined,
    gitCommit: (env.GIT_COMMIT ?? env.NEXT_PUBLIC_GIT_COMMIT) || undefined,
    warnings,
  };
}

export { parseLevel };
