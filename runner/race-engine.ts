import type { RaceState, RaceReport } from "../packages/contracts/race.ts";
export class RaceError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export interface RacePort {
  preflight(step: number, state: RaceState): Promise<Partial<RaceState>>;
  mutate(step: number, state: RaceState): Promise<Partial<RaceState>>;
  verify(step: number, state: RaceState): Promise<Partial<RaceState>>;
}
export async function executeRaceStep(
  port: RacePort,
  step: number,
  initial: RaceState,
  report: (r: RaceReport) => Promise<void>,
) {
  if (step !== initial.completed.length || step < 0 || step > 6)
    throw new RaceError("STEP_ORDER");
  let state: RaceState = { ...initial };
  let mutation = false;
  // If the durable initial checkpoint cannot be saved, send no API request.
  await report({ status: "RUNNING", step, state });
  try {
    state = { ...state, ...(await port.preflight(step, state)) };
    if (step > 0) {
      await report({ status: "RUNNING", step, state });
      mutation = true;
      state = { ...state, ...(await port.mutate(step, state)) };
      await report({ status: "RUNNING", step, state });
    }
    state = {
      ...state,
      ...(await port.verify(step, state)),
      completed: [...initial.completed, step],
      checkedAt: Date.now(),
    };
    await report({ status: "SUCCESS", step, state });
  } catch (e) {
    await report({
      status: mutation ? "NEEDS_REVIEW" : "BLOCKED",
      step,
      state,
      reason:
        e instanceof RaceError
          ? e.code
          : mutation
            ? "UNCERTAIN_MUTATION"
            : "CONNECTION_ERROR",
    });
  }
}
