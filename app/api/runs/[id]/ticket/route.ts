import {
  db,
  member,
  sameOrigin,
  json,
  expire,
} from "../../../../../lib/server";
export async function POST(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await member()) || !sameOrigin(r))
    return json({ error: "FORBIDDEN" }, 403);
  await expire();
  const { id } = await params;
  const run = await db()
    .prepare(
      "SELECT id,status,order_id,reservation_id,ticket_status,profile_version FROM runs WHERE id=?",
    )
    .bind(id)
    .first<{
      id: string;
      status: string;
      order_id: string;
      reservation_id: string;
      ticket_status: string | null;
      profile_version: string;
    }>();
  if (!run) return json({ error: "NOT_FOUND" }, 404);
  if (run.ticket_status) return json({ id, status: run.ticket_status });
  if (run.status !== "SUCCESS" || !run.order_id || !run.reservation_id)
    return json({ error: "PRECONDITION" }, 409);
  if (!run.profile_version.startsWith("dev-live-"))
    return json({ error: "NOT_DEVELOPMENT_RUN" }, 409);
  try {
    await db()
      .prepare(
        "UPDATE runs SET ticket_status='WAITING',ticket_reason=NULL,slot=1,updated=? WHERE id=? AND ticket_status IS NULL AND status='SUCCESS'",
      )
      .bind(Date.now(), id)
      .run();
  } catch {
    return json({ error: "RUN_BUSY" }, 409);
  }
  return json({ id, status: "WAITING" }, 202);
}
