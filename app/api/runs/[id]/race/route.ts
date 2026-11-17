import { z } from "zod";
import {
  raceInputSchema,
  raceStateSchema,
} from "../../../../../packages/contracts/race";
import {
  db,
  member,
  sameOrigin,
  json,
  expire,
  body,
} from "../../../../../lib/server";
export async function POST(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await member()) || !sameOrigin(r))
    return json({ error: "FORBIDDEN" }, 403);
  let b;
  try {
    b = z
      .object({
        key: z.string().uuid(),
        step: z.number().int().min(0).max(6),
        input: raceInputSchema,
      })
      .strict()
      .parse(await body(r));
  } catch {
    return json({ error: "INVALID_INPUT" }, 400);
  }
  await expire();
  const { id } = await params;
  const row = await db()
    .prepare(
      "SELECT ticket_status,wearables,race_status,race_step,race_state,profile_version FROM runs WHERE id=?",
    )
    .bind(id)
    .first<{
      ticket_status: string;
      wearables: string;
      race_status: string | null;
      race_step: number | null;
      race_state: string | null;
      profile_version: string;
    }>();
  if (!row) return json({ error: "NOT_FOUND" }, 404);
  if (
    row.ticket_status !== "SUCCESS" ||
    !row.profile_version.startsWith("dev-live-") ||
    !JSON.parse(row.wearables ?? "[]").some(
      (w: { wearableId: string; verified: boolean }) =>
        w.wearableId === b.input.wearableId && w.verified,
    )
  )
    return json({ error: "TICKET_UNVERIFIED" }, 409);
  const old = row.race_state
    ? raceStateSchema.parse(JSON.parse(row.race_state))
    : null;
  if (old?.requestKey === b.key) return json({ id, status: row.race_status });
  if (
    row.race_status &&
    ["RUNNING", "WAITING", "NEEDS_REVIEW"].includes(row.race_status)
  )
    return json({ error: "RACE_NOT_REPLAYABLE" }, 409);
  const next = old?.completed.length ?? 0;
  if (
    b.step !== next ||
    (next > 0 && JSON.stringify(old?.input) !== JSON.stringify(b.input))
  )
    return json({ error: "STEP_ORDER" }, 409);
  const state = {
    ...(old ?? { completed: [], checks: [] }),
    input: b.input,
    requestKey: b.key,
  };
  try {
    const result = await db()
      .prepare(
        "UPDATE runs SET race_status='WAITING',race_step=?,race_state=?,race_reason=NULL,slot=1,updated=? WHERE id=? AND race_status IS ? AND race_state IS ? AND slot IS NULL",
      )
      .bind(
        b.step,
        JSON.stringify(state),
        Date.now(),
        id,
        row.race_status,
        row.race_state,
      )
      .run();
    if (result.meta.changes !== 1) return json({ error: "RUN_BUSY" }, 409);
  } catch {
    return json({ error: "RUN_BUSY" }, 409);
  }
  return json({ id, status: "WAITING" }, 202);
}
