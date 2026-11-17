import test from "node:test";
import assert from "node:assert/strict";
import { executeRaceStep, RaceError } from "../runner/race-engine.ts";
import {
  raceInputSchema,
  raceReportSchema,
  raceSteps,
} from "../packages/contracts/race.ts";
const input = {
  wearableId: "2610131118629",
  carNumber: "E001",
  trackId: 1 as const,
  gateId: "cju_board_checkin_b2f_ed01",
  laptime: 65000,
  maxSpeed: 40,
  averageSpeed: 23,
  maxAcceleration: 0,
};
const state = { input, completed: [], checks: [], requestKey: "key" };
test("race rejects unsupported course, unsafe ID and record values", () => {
  assert.ok(raceInputSchema.safeParse(input).success);
  for (const patch of [
    { trackId: 9 },
    { wearableId: "9007199254740993" },
    { laptime: 59999 },
    { averageSpeed: 61 },
  ])
    assert.ok(!raceInputSchema.safeParse({ ...input, ...patch }).success);
});
test("time rejection preserves code and never sends boarding", async () => {
  let mutations = 0;
  const reports: any[] = [];
  await executeRaceStep(
    {
      preflight: async () => {
        throw new RaceError("TICKET.10104");
      },
      mutate: async () => {
        mutations++;
        return {};
      },
      verify: async () => ({}),
    },
    0,
    state,
    (r) => {
      reports.push(r);
      return Promise.resolve();
    },
  );
  assert.equal(mutations, 0);
  assert.equal(reports.at(-1).status, "BLOCKED");
  assert.equal(reports.at(-1).reason, "TICKET.10104");
});
test("failed checkpoint prevents mutation", async () => {
  let mutations = 0;
  await assert.rejects(
    executeRaceStep(
      {
        preflight: async () => ({}),
        mutate: async () => {
          mutations++;
          return {};
        },
        verify: async () => ({}),
      },
      1,
      { ...state, completed: [0] },
      async () => {
        throw Error("unavailable");
      },
    ),
  );
  assert.equal(mutations, 0);
});
test("one step only, success needs read verification", async () => {
  let mutations = 0;
  const reports: any[] = [];
  await executeRaceStep(
    {
      preflight: async () => ({}),
      mutate: async () => {
        mutations++;
        return { workflowId: "123" };
      },
      verify: async () => ({ checks: ["workflow"] }),
    },
    3,
    { ...state, completed: [0, 1, 2] },
    async (r) => {
      reports.push(r);
    },
  );
  assert.equal(mutations, 1);
  assert.equal(reports.at(-1).status, "SUCCESS");
  assert.equal(reports.at(-1).state.workflowId, "123");
  assert.deepEqual(reports.at(-1).state.completed, [0, 1, 2, 3]);
});
test("uncertain mutation is never replayed and keeps identifiers", async () => {
  let mutations = 0;
  const reports: any[] = [];
  await executeRaceStep(
    {
      preflight: async () => ({}),
      mutate: async () => {
        mutations++;
        return { workflowId: "123" };
      },
      verify: async () => {
        throw Error("timeout");
      },
    },
    3,
    { ...state, completed: [0, 1, 2] },
    async (r) => {
      reports.push(r);
    },
  );
  assert.equal(mutations, 1);
  assert.equal(reports.at(-1).status, "NEEDS_REVIEW");
  assert.equal(reports.at(-1).state.workflowId, "123");
});
test("out of order and fabricated success are rejected", async () => {
  await assert.rejects(executeRaceStep({} as any, 4, state, async () => {}));
  assert.ok(
    !raceReportSchema.safeParse({ step: 6, status: "SUCCESS", state }).success,
  );
  assert.equal(raceSteps.length, 7);
});
