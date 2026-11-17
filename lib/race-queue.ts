import { db, json } from "./server";
import {
  raceStateSchema,
  isVerifiedRaceReport,
  type RaceReport,
} from "../packages/contracts/race";
export async function claimRace(profileVersion: string) {
  const token = crypto.randomUUID();
  const row = await db()
    .prepare(
      "UPDATE runs SET race_status='RUNNING',token=?,updated=? WHERE id=(SELECT id FROM runs WHERE race_status='WAITING' AND ticket_status='SUCCESS' AND profile_version=? ORDER BY updated LIMIT 1) AND race_status='WAITING' RETURNING id,input,profile_version AS profileVersion,order_id AS orderId,reservation_id AS reservationId,race_step AS raceStep,race_state AS raceState",
    )
    .bind(token, Date.now(), profileVersion)
    .first<{
      id: string;
      input: string;
      profileVersion: string;
      orderId: string;
      reservationId: string;
      raceStep: number;
      raceState: string;
    }>();
  return row
    ? {
        ...row,
        input: JSON.parse(row.input),
        raceState: raceStateSchema.parse(JSON.parse(row.raceState)),
        token,
        kind: "race",
      }
    : null;
}
export async function reportRace(
  id: string,
  token: string,
  report: RaceReport,
) {
  if (!isVerifiedRaceReport(report))
    return json({ error: "INCOMPLETE_VERIFICATION" }, 400);
  const old = await db()
    .prepare(
      "SELECT race_state FROM runs WHERE id=? AND token=? AND race_status='RUNNING' AND race_step=?",
    )
    .bind(id, token, report.step)
    .first<{ race_state: string }>();
  if (!old) return json({ accepted: false }, 409);
  const state = raceStateSchema.parse(JSON.parse(old.race_state));
  if (
    JSON.stringify(state.input) !== JSON.stringify(report.state.input) ||
    state.requestKey !== report.state.requestKey ||
    state.completed.some((x, i) => report.state.completed[i] !== x) ||
    (state.workflowId && state.workflowId !== report.state.workflowId)
  )
    return json({ accepted: false }, 409);
  const updated = await db()
    .prepare(
      "UPDATE runs SET race_status=?,race_state=?,race_reason=?,slot=?,updated=? WHERE id=? AND token=? AND race_status='RUNNING' AND race_step=? AND race_state=?",
    )
    .bind(
      report.status,
      JSON.stringify(report.state),
      report.reason ?? null,
      report.status === "RUNNING" ? 1 : null,
      Date.now(),
      id,
      token,
      report.step,
      old.race_state,
    )
    .run();
  return json(
    { accepted: updated.meta.changes === 1 },
    updated.meta.changes === 1 ? 200 : 409,
  );
}
