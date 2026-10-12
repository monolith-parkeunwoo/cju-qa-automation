import { z } from "zod";
import { profileSchema, reportSchema } from "../../../packages/contracts";
import { runnerAuthorized, json, body, db, expire } from "../../../lib/server";
export async function POST(r: Request) {
  if (!(await runnerAuthorized(r))) return json({ error: "FORBIDDEN" }, 403);
  let b;
  try {
    b = z
      .discriminatedUnion("action", [
        z
          .object({ action: z.literal("poll"), profile: profileSchema })
          .strict(),
        z
          .object({
            action: z.literal("report"),
            id: z.string().uuid(),
            token: z.string().uuid(),
            report: reportSchema,
          })
          .strict(),
      ])
      .parse(await body(r));
  } catch {
    return json({ error: "INVALID_INPUT" }, 400);
  }
  await expire();
  const now = Date.now();
  if (b.action === "poll") {
    await db()
      .prepare(
        "INSERT INTO runner(id,profile,seen) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile,seen=excluded.seen",
      )
      .bind(JSON.stringify(b.profile), now)
      .run();
    await db()
      .prepare(
        "UPDATE runs SET status='BLOCKED',reason='PRECONDITION',slot=NULL,updated=? WHERE status='WAITING' AND (profile_version<>? OR ?=0)",
      )
      .bind(now, b.profile.version, b.profile.ready ? 1 : 0)
      .run();
    if (!b.profile.ready) return json({ job: null });
    const token = crypto.randomUUID();
    const job = await db()
      .prepare(
        "UPDATE runs SET status='RUNNING',token=?,updated=? WHERE id=(SELECT id FROM runs WHERE status='WAITING' AND profile_version=? ORDER BY created LIMIT 1) AND status='WAITING' RETURNING id,input,profile_version AS profileVersion",
      )
      .bind(token, now, b.profile.version)
      .first<{ id: string; input: string; profileVersion: string }>();
    return json({
      job: job ? { ...job, input: JSON.parse(job.input), token } : null,
    });
  }
  const v = b.report;
  const terminal = v.status !== "RUNNING";
  const result = await db()
    .prepare(
      "UPDATE runs SET status=?,step=?,order_id=COALESCE(?,order_id),reservation_id=COALESCE(?,reservation_id),checks=COALESCE(?,checks),reason=?,slot=?,updated=? WHERE id=? AND token=? AND status='RUNNING' AND step<=? AND (order_id IS NULL OR ? IS NULL OR order_id=?)",
    )
    .bind(
      v.status,
      v.step,
      v.orderId ?? null,
      v.reservationId ?? null,
      v.checks ? JSON.stringify(v.checks) : null,
      v.reason ?? null,
      terminal ? null : 1,
      now,
      b.id,
      b.token,
      v.step,
      v.orderId ?? null,
      v.orderId ?? null,
    )
    .run();
  return json(
    { accepted: result.meta.changes === 1 },
    result.meta.changes === 1 ? 200 : 409,
  );
}
