import { env } from "cloudflare:workers";

export const DEFAULT_ORGANISATION_ID = "roadworx-sydney";

export function requireEstimateDb() {
  if (!env.DB) throw new Error("Estimate storage is temporarily unavailable.");
  return env.DB;
}

export function cleanText(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

export function safeJson<T>(value: unknown, fallback: T): T {
  if (value !== null && typeof value === 'object') return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function jsonError(message: string, status = 400, details?: Record<string, unknown>) {
  return Response.json({ error: message, ...details }, { status });
}

export type GenericRow = {
  id: string;
  organisation_id: string;
  name: string;
  status: string;
  metadata: string;
  created_at: string;
};
