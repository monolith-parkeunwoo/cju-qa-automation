import { setTimeout as delay } from "node:timers/promises";
import { verifyOrder } from "../packages/contracts/index.ts";
import type {
  ReservationInput,
  Report,
  VerifiedOrder,
} from "../packages/contracts/index.ts";
export interface ReservationPort {
  productId: string;
  preflight(input: ReservationInput): Promise<void>;
  create(input: ReservationInput): Promise<string>;
  complete(id: string): Promise<void>;
  read(id: string): Promise<VerifiedOrder>;
}
export class QaError extends Error {
  constructor(
    public reason: Report["reason"],
    public uncertain = false,
  ) {
    super(reason);
  }
}
export async function reserve(
  port: ReservationPort,
  input: ReservationInput,
  report: (v: Report) => Promise<void>,
  wait: () => Promise<unknown> = () => delay(1000),
) {
  let orderId: string | undefined;
  let step = 0;
  let mutation = false;
  try {
    await report({ status: "RUNNING", step });
    await port.preflight(input);
    step = 1;
    await report({ status: "RUNNING", step });
    mutation = true;
    orderId = await port.create(input);
    mutation = false;
    await report({ status: "RUNNING", step, orderId });
    step = 2;
    await report({ status: "RUNNING", step, orderId });
    mutation = true;
    try {
      await port.complete(orderId);
      mutation = false;
    } catch (e) {
      if (!(e instanceof QaError) || !e.uncertain)
        throw e; /* Reconcile by read only. Never repeat complete. */
    }
    step = 3;
    await report({ status: "RUNNING", step, orderId });
    let result = await port.read(orderId);
    // Eventual consistency: bounded read-only polling; never retry a mutation.
    for (
      let attempt = 1;
      attempt < 3 && !verifyOrder(result, input, port.productId, orderId);
      attempt++
    ) {
      await wait();
      result = await port.read(orderId);
    }
    if (!verifyOrder(result, input, port.productId, orderId))
      throw new QaError(
        mutation ? "UNCERTAIN_MUTATION" : "VERIFICATION_MISMATCH",
        mutation,
      );
    mutation = false;
    await report({
      status: "SUCCESS",
      step,
      orderId,
      reservationId: result.reservationId,
      checks: [
        "product",
        "date",
        "time",
        "quantity",
        "completed",
        "reservation",
      ],
    });
  } catch (e) {
    const reason = e instanceof QaError ? e.reason : "CONTRACT_ERROR";
    const uncertain =
      mutation ||
      (e instanceof QaError && e.uncertain) ||
      (step === 3 && reason !== "VERIFICATION_MISMATCH");
    await report({
      status: uncertain
        ? "NEEDS_REVIEW"
        : reason === "PRECONDITION"
          ? "BLOCKED"
          : "FAILURE",
      step,
      orderId,
      reason: uncertain ? "UNCERTAIN_MUTATION" : reason,
    });
  }
}
