import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
export const config = env as unknown as Record<string, string> & {
  DB: D1Database;
};
export function db() {
  if (!config.DB) throw new Error("Database unavailable");
  return config.DB;
}
export async function member() {
  const u = await getChatGPTUser();
  const ids = (config.QA_TEAM_USER_IDS ?? "").split(",").map((x) => x.trim());
  return u && ids.includes(u.userId) ? u : null;
}
export function sameOrigin(r: Request) {
  return r.headers.get("origin") === new URL(r.url).origin;
}
export async function runnerAuthorized(r: Request) {
  const supplied = r.headers.get("x-qa-runner-token") ?? "";
  const secret = config.QA_RUNNER_TOKEN ?? "";
  if (secret.length < 32 || supplied.length > 512) return false;
  const hash = async (v: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    );
  const a = await hash(supplied),
    b = await hash(secret);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export const json = (v: unknown, status = 200) =>
  Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
export async function body(r: Request) {
  const t = await r.text();
  if (t.length > 16384) throw new Error("Payload too large");
  return JSON.parse(t);
}
export async function expire() {
  await expireTickets();
  await db()
    .prepare(
      "UPDATE runs SET race_status='NEEDS_REVIEW',race_reason='RUNNER_LOST',slot=NULL,updated=? WHERE race_status='RUNNING' AND updated<?",
    )
    .bind(Date.now(), Date.now() - 90000)
    .run();
  const now = Date.now();
  await db()
    .prepare(
      "UPDATE runs SET status='NEEDS_REVIEW',reason='RUNNER_LOST',slot=NULL,updated=? WHERE status='RUNNING' AND updated<?",
    )
    .bind(now, now - 90000)
    .run();
}
export async function expireTickets() {
  const now = Date.now();
  await db()
    .prepare(
      "UPDATE runs SET ticket_status='NEEDS_REVIEW',ticket_reason='RUNNER_LOST',slot=NULL,updated=? WHERE ticket_status='RUNNING' AND updated<?",
    )
    .bind(now, now - 90000)
    .run();
}
export async function readiness() {
  const r = await db()
    .prepare("SELECT profile,seen FROM runner WHERE id=1")
    .first<{ profile: string; seen: number }>();
  return {
    profile: r ? JSON.parse(r.profile) : null,
    connected: !!r && Date.now() - r.seen < 45000,
  };
}
export const publicColumns =
  "id,input,profile_version AS profileVersion,profile_snapshot AS profile,status,step,order_id AS orderId,reservation_id AS reservationId,ticket_status AS ticketStatus,ticket_reason AS ticketReason,wearables,race_status AS raceStatus,race_step AS raceStep,race_state AS raceState,race_reason AS raceReason,checks,reason,created,updated";
