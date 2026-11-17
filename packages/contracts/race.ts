import { z } from "zod";
export const raceSteps = [
  "레이스 조건 확인",
  "탑승 체크인",
  "코스 체크인",
  "차량 준비",
  "레이스 시작",
  "레이스 종료",
  "더미 기록 생성·검증",
] as const;
const id = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .refine((v) => Number.isSafeInteger(Number(v)));
export const raceInputSchema = z
  .object({
    wearableId: id,
    carNumber: z.string().regex(/^E[0-9]{3}$/),
    trackId: z.literal(1),
    gateId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    laptime: z.number().int().min(60000).max(300000),
    maxSpeed: z.number().min(0).max(60),
    averageSpeed: z.number().min(0).max(60),
    maxAcceleration: z.number().min(0).max(20),
  })
  .strict()
  .refine((v) => v.averageSpeed <= v.maxSpeed);
export const raceStateSchema = z
  .object({
    input: raceInputSchema,
    completed: z.array(z.number().int().min(0).max(6)).max(7),
    checks: z.array(z.string().regex(/^[a-z_]{1,40}$/)).max(20),
    requestKey: z.string().min(1).max(100),
    workflowId: id.optional(),
    psuTraceId: id.optional(),
    startDt: z.string().max(30).optional(),
    finishDt: z.string().max(30).optional(),
    checkedAt: z.number().optional(),
  })
  .strict()
  .refine((v) => v.completed.every((s, i) => s === i));
export const raceReportSchema = z
  .object({
    step: z.number().int().min(0).max(6),
    status: z.enum(["RUNNING", "SUCCESS", "BLOCKED", "NEEDS_REVIEW"]),
    reason: z
      .string()
      .regex(/^[A-Z0-9_.]{1,80}$/)
      .optional(),
    state: raceStateSchema,
  })
  .strict()
  .refine(
    (r) =>
      r.status !== "SUCCESS" ||
      (r.state.completed.length === r.step + 1 &&
        r.state.checks.length > 0 &&
        (r.step < 3 || !!r.state.workflowId)),
  );
const requiredChecks = [
  ["ticket", "metadata", "car_empty", "time"],
  ["boarding"],
  ["course"],
  ["workflow", "car_owner"],
  ["workflow", "started", "ticket_used"],
  ["finished", "car_released"],
  [
    "finished",
    "car_released",
    "record_values",
    "status_record",
    "record_read",
    "ticket_used",
  ],
];
export function isVerifiedRaceReport(r: RaceReport) {
  return (
    r.status !== "SUCCESS" ||
    (requiredChecks[r.step].every((c) => r.state.checks.includes(c)) &&
      (r.step < 2 || !!r.state.psuTraceId) &&
      (r.step < 4 || !!r.state.startDt) &&
      (r.step < 5 || !!r.state.finishDt))
  );
}
export type RaceInput = z.infer<typeof raceInputSchema>;
export type RaceState = z.infer<typeof raceStateSchema>;
export type RaceReport = z.infer<typeof raceReportSchema>;
