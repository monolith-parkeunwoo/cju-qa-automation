import { availabilitySnapshotSchema } from "../../../packages/contracts/availability";
import { claimAvailability, reportAvailability } from "../../../lib/availability";
import { raceReportSchema } from "../../../packages/contracts/race";
import { claimRace, reportRace } from "../../../lib/race-queue";
import { z } from "zod";
import {
  profileSchema,
  reportSchema,
  ticketReportSchema,
} from "../../../packages/contracts";
import { runnerAuthorized, json, body, db, expire } from "../../../lib/server";
export async function POST(r: Request) {
  if (!(await runnerAuthorized(r))) return json({ error: "FORBIDDEN" }, 403);
  let b;
  try {
    b = z
      .discriminatedUnion("action", [
        z.object({action:z.literal("availabilityReport"),key:z.string().max(40),token:z.string().uuid(),snapshot:availabilitySnapshotSchema.nullable()}).strict(),
        z
          .object({
            action: z.literal("raceReport"),
            id: z.string().uuid(),
            token: z.string().uuid(),
            report: raceReportSchema,
          })
          .strict(),
        z
          .object({
            action: z.literal("ticketReport"),
            id: z.string().uuid(),
            token: z.string().uuid(),
            report: ticketReportSchema,
          })
          .strict(),
        z
          .object({
            action: z.literal("poll"),
            profile: profileSchema,
            ticketing: z.boolean().optional(),
            racing: z.boolean().optional(),
            availability: z.boolean().optional(),
          })
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
  if(b.action === "availabilityReport") return reportAvailability(b.key,b.token,b.snapshot);
  if (b.action === "raceReport") return reportRace(b.id, b.token, b.report);
  if (b.action === "ticketReport") {
    const v = b.report;
    const result = await db()
      .prepare(
        "UPDATE runs SET ticket_status=?,ticket_reason=?,wearables=?,slot=?,updated=? WHERE id=? AND token=? AND status='SUCCESS' AND ticket_status='RUNNING'",
      )
      .bind(
        v.status,
        v.reason ?? null,
        JSON.stringify(v.wearables),
        v.status === "RUNNING" ? 1 : null,
        now,
        b.id,
        b.token,
      )
      .run();
    return json(
      { accepted: result.meta.changes === 1 },
      result.meta.changes === 1 ? 200 : 409,
    );
  }
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
    if (b.racing) {
      const race = await claimRace(b.profile.version);
      if (race) return json({ job: race });
    }
    const ticketToken = crypto.randomUUID();
    const ticketJob = b.ticketing
      ? await db()
          .prepare(
            "UPDATE runs SET ticket_status='RUNNING',token=?,updated=? WHERE id=(SELECT id FROM runs WHERE ticket_status='WAITING' AND status='SUCCESS' AND profile_version=? ORDER BY updated LIMIT 1) AND ticket_status='WAITING' RETURNING id,input,profile_version AS profileVersion,order_id AS orderId,reservation_id AS reservationId",
          )
          .bind(ticketToken, now, b.profile.version)
          .first<{
            id: string;
            input: string;
            profileVersion: string;
            orderId: string;
            reservationId: string;
          }>()
      : null;
    if (ticketJob)
      return json({
        job: {
          ...ticketJob,
          input: JSON.parse(ticketJob.input),
          token: ticketToken,
          kind: "ticketing",
        },
      });
    if(b.availability) {const availability=await claimAvailability();if(availability) return json({job:null,availability});}
    if (!b.profile.ready) return json({ job: null });
    const token = crypto.randomUUID();
    const job = await db()
      .prepare(
        "UPDATE runs SET status='RUNNING',token=?,updated=? WHERE id=(SELECT id FROM runs WHERE status='WAITING' AND profile_version=? ORDER BY created LIMIT 1) AND status='WAITING' RETURNING id,input,profile_version AS profileVersion,profile_snapshot AS profile",
      )
      .bind(token, now, b.profile.version)
      .first<{ id: string; input: string; profileVersion: string;profile:string }>();
    return json({
      job: job
        ? { id:job.id,profileVersion:job.profileVersion,price:JSON.parse(job.profile).price,input:JSON.parse(job.input),token,kind:"reservation" }
        : null,
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
