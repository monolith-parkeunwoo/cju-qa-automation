import { z } from "zod";
export const statusSchema = z.enum([
  "WAITING",
  "RUNNING",
  "SUCCESS",
  "FAILURE",
  "NEEDS_REVIEW",
  "BLOCKED",
]);
export type Status = z.infer<typeof statusSchema>;
export const labels: Record<Status, string> = {
  WAITING: "대기",
  RUNNING: "실행 중",
  SUCCESS: "성공",
  FAILURE: "실패",
  NEEDS_REVIEW: "확인 필요",
  BLOCKED: "선행 조건 미충족",
};
export const steps = [
  "예약 조건 확인",
  "주문 생성",
  "주문 완료",
  "주문·예약 재조회",
] as const;
export const inputSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) =>
          !Number.isNaN(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v,
      ),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    quantity: z.number().int().min(1).max(20),
  })
  .strict();
export type ReservationInput = z.infer<typeof inputSchema>;
export const profileSchema = z
  .object({
    version: z.string().min(1).max(80),
    ready: z.boolean(),
    productId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,80}$/)
      .nullable(),
    productName: z.literal("ALL"),
    price: z.number().nonnegative().nullable(),
    times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).max(100),
    blockers: z
      .array(
        z.enum([
          "CONTRACT_UNVERIFIED",
          "AUTH_UNAVAILABLE",
          "CONNECTION_UNVERIFIED",
        ]),
      )
      .max(3),
  })
  .strict()
  .refine(
    (p) =>
      !p.ready ||
      (p.productId !== null &&
        p.price !== null &&
        p.blockers.length === 0),
    "Ready requires verified product and price",
  );
export type Profile = z.infer<typeof profileSchema>;
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const reportSchema = z
  .object({
    status: statusSchema.exclude(["WAITING"]),
    step: z.number().int().min(0).max(3),
    orderId: idSchema.optional(),
    reservationId: idSchema.optional(),
    checks: z
      .array(
        z.enum([
          "product",
          "date",
          "time",
          "quantity",
          "completed",
          "reservation",
        ]),
      )
      .max(6)
      .optional(),
    reason: z
      .enum([
        "PRECONDITION",
        "AUTH",
        "API_REJECTED",
        "UNCERTAIN_MUTATION",
        "VERIFICATION_MISMATCH",
        "RUNNER_LOST",
        "CONTRACT_ERROR",
      ])
      .optional(),
  })
  .strict()
  .superRefine((r, c) => {
    if (
      r.status === "SUCCESS" &&
      (!r.orderId ||
        !r.reservationId ||
        r.step !== 3 ||
        new Set(r.checks).size !== 6)
    )
      c.addIssue({
        code: "custom",
        message: "Success requires complete verification",
      });
  });
export const wearableSchema = z
  .object({
    wearableId: z.string().regex(/^[1-9][0-9]*$/),
    nfcId: z.string().max(100).optional(),
    ticketId: idSchema.optional(),
    verified: z.boolean(),
  })
  .strict();
export const ticketReportSchema = z
  .object({
    status: statusSchema.exclude(["WAITING"]),
    wearables: z.array(wearableSchema).max(100),
    reason: z
      .enum([
        "PRECONDITION",
        "UNCERTAIN_MUTATION",
        "VERIFICATION_MISMATCH",
        "CONTRACT_ERROR",
      ])
      .optional(),
  })
  .strict()
  .refine(
    (r) =>
      new Set(r.wearables.map((w) => w.wearableId)).size === r.wearables.length,
    "Duplicate wearable IDs",
  )
  .refine(
    (r) =>
      r.status !== "SUCCESS" ||
      (r.wearables.length > 0 && r.wearables.every((w) => w.verified)),
    "Ticket success requires verified IDs",
  );
export type Wearable = z.infer<typeof wearableSchema>;
export type TicketReport = z.infer<typeof ticketReportSchema>;
export type Report = z.infer<typeof reportSchema>;
export type Job = {
  price?: number;
  kind?: "reservation" | "ticketing" | "race";
  raceStep?: number;
  raceState?: import("./race.ts").RaceState;
  orderId?: string;
  reservationId?: string;
  id: string;
  token: string;
  input: ReservationInput;
  profileVersion: string;
};
export type VerifiedOrder = {
  orderId: string;
  reservationId: string;
  productId: string;
  date: string;
  time: string;
  quantity: number;
  completed: boolean;
};
export function verifyOrder(
  o: VerifiedOrder,
  i: ReservationInput,
  productId: string,
  orderId: string,
) {
  return (
    o.orderId === orderId &&
    idSchema.safeParse(o.reservationId).success &&
    o.productId === productId &&
    o.date === i.date &&
    o.time === i.time &&
    o.quantity === i.quantity &&
    o.completed
  );
}
