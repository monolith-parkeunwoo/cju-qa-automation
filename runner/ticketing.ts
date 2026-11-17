import { z } from "zod";
import { wearableSchema } from "../packages/contracts/index.ts";
import type { Wearable, TicketReport } from "../packages/contracts/index.ts";
export function parseVirtualTickets(value: unknown): Wearable[] {
  const response = z
    .object({
      code: z.literal("00000"),
      data: z
        .array(
          z.object({
            wrbId: z.number().int().positive().safe(),
            nfcId: z.string().optional(),
          }),
        )
        .min(1),
    })
    .parse(value);
  const result = response.data.map((w) =>
    wearableSchema.parse({
      wearableId: String(w.wrbId),
      nfcId: w.nfcId,
      verified: false,
    }),
  );
  if (new Set(result.map((w) => w.wearableId)).size !== result.length)
    throw Error("Duplicate wearable IDs");
  return result;
}
export function verifyTicketInfo(
  value: unknown,
  wearableId: string,
  reservationId: string,
  orderId: string,
  productId: string,
) {
  const parsed = z
    .object({
      ticket: z.object({
        wrbId: z.number(),
        ticketId: z.number(),
        reservationId: z.string(),
        enabled: z.boolean(),
      }),
      "ticket-product": z.array(
        z.object({
          productId: z.number(),
          orderId: z.number(),
          enabled: z.boolean(),
        }),
      ),
      "ticket-psu": z.array(
        z.object({ enabled: z.boolean(), used: z.boolean() }),
      ),
    })
    .safeParse(value);
  if (!parsed.success) return false;
  const d = parsed.data;
  return (
    String(d.ticket.wrbId) === wearableId &&
    d.ticket.reservationId === reservationId &&
    d.ticket.enabled &&
    d["ticket-product"].some(
      (p) =>
        String(p.orderId) === orderId &&
        String(p.productId) === productId &&
        p.enabled,
    ) &&
    d["ticket-psu"].some((p) => p.enabled && !p.used)
  );
}
export interface TicketPort {
  validate(): Promise<void>;
  print(): Promise<unknown>;
  read(wearableId: string): Promise<unknown>;
}
export async function issueTickets(
  port: TicketPort,
  expected: { reservationId: string; orderId: string; productId: string },
  report: (r: TicketReport) => Promise<void>,
) {
  let wearables: Wearable[] = [];
  let sent = false;
  await report({ status: "RUNNING", wearables });
  try {
    await port.validate();
    await report({ status: "RUNNING", wearables });
    sent = true;
    wearables = parseVirtualTickets(await port.print());
    await report({ status: "RUNNING", wearables });
    for (const w of wearables) {
      const data = await port.read(w.wearableId);
      if (
        !verifyTicketInfo(
          data,
          w.wearableId,
          expected.reservationId,
          expected.orderId,
          expected.productId,
        )
      ) {
        await report({
          status: "NEEDS_REVIEW",
          wearables,
          reason: "VERIFICATION_MISMATCH",
        });
        return;
      }
      w.verified = true;
      w.ticketId = String(
        (data as { ticket: { ticketId: number } }).ticket.ticketId,
      );
      await report({ status: "RUNNING", wearables });
    }
    await report({ status: "SUCCESS", wearables });
  } catch {
    await report({
      status: sent ? "NEEDS_REVIEW" : "BLOCKED",
      wearables,
      reason: sent ? "UNCERTAIN_MUTATION" : "PRECONDITION",
    });
  }
}
