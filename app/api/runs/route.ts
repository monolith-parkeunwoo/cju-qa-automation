import { z } from "zod";
import { inputSchema } from "../../../packages/contracts";
import {
  member,
  sameOrigin,
  json,
  body,
  db,
  expire,
  readiness,
  publicColumns,
} from "../../../lib/server";
export async function GET() {
  if (!(await member())) return json({ error: "FORBIDDEN" }, 403);
  await expire();
  const { results } = await db()
    .prepare(
      `SELECT ${publicColumns} FROM runs ORDER BY created DESC LIMIT 100`,
    )
    .all();
  return json({ runs: results, ...(await readiness()) });
}
export async function POST(r: Request) {
  const u = await member();
  if (!u || !sameOrigin(r)) return json({ error: "FORBIDDEN" }, 403);
  let b;
  try {
    b = z
      .object({
        key: z.string().uuid(),
        input: inputSchema,
        profileVersion: z.string().max(80),
      })
      .strict()
      .parse(await body(r));
  } catch {
    return json({ error: "INVALID_INPUT" }, 400);
  }
  await expire();
  const existing = await db()
    .prepare(
      `SELECT ${publicColumns} FROM runs WHERE owner=? AND request_key=?`,
    )
    .bind(u.userId, b.key)
    .first();
  if (existing) return json(existing);
  const { profile, connected } = await readiness();
  if (
    !connected ||
    !profile?.ready ||
    profile.version !== b.profileVersion ||
    !profile.times.includes(b.input.time)
  )
    return json({ error: "NOT_READY" }, 409);
  const id = crypto.randomUUID(),
    now = Date.now();
  try {
    await db()
      .prepare(
        "INSERT INTO runs(id,owner,request_key,input,profile_version,profile_snapshot,status,slot,created,updated) VALUES(?,?,?,?,?,?,'WAITING',1,?,?)",
      )
      .bind(
        id,
        u.userId,
        b.key,
        JSON.stringify(b.input),
        profile.version,
        JSON.stringify(profile),
        now,
        now,
      )
      .run();
  } catch {
    const retry = await db()
      .prepare(
        `SELECT ${publicColumns} FROM runs WHERE owner=? AND request_key=?`,
      )
      .bind(u.userId, b.key)
      .first();
    if (retry) return json(retry);
    return json({ error: "RUN_BUSY" }, 409);
  }
  return json({ id }, 201);
}
