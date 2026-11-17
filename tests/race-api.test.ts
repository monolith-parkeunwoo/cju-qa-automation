import test from "node:test";
import assert from "node:assert/strict";
import { RaceApi } from "../runner/race-api.ts";
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
const state = { input, completed: [], checks: [], requestKey: "test" };
const expected = { orderId: "125499", reservationId: "596B55B24212" };
const ticket = {
  ticket: {
    wrbId: Number(input.wearableId),
    ticketId: 20069,
    reservationId: expected.reservationId,
    enabled: true,
  },
  "ticket-product": [
    { productId: 116, orderId: Number(expected.orderId), enabled: true },
  ],
  "ticket-psu": [{ enabled: true, used: false }],
};
function mock(overrides: Record<string, unknown> = {}) {
  const calls: { path: string; method: string }[] = [];
  const responses: Record<string, unknown> = {
    "/ticket/v1/reservation/ticket/wearable/info/2610131118629": {
      code: "00000",
      data: ticket,
    },
    "/activity-manager/race/cars?number=E001": {
      carNumber: "E001",
      carModel: "E",
    },
    "/activity-manager/race/tracks?id=1": { trackId: 1, course: "E1" },
    "/activity-status/gate/list": [{ iotCoreId: input.gateId }],
    "/activity-manager/car-queue/E001": {
      carNumber: "E001",
      wearableId: null,
      workflowId: null,
    },
    "/activity-composer/customer-claim/valid/2610131118629/status": {
      code: "00000",
      data: { board: false, course: false },
    },
    "/ticket/v1/wearable/valid-pre-check-in?wrbId=2610131118629&psuIds=111,112,113,114,115&forceUse=false":
      { code: "TICKET.10104", message: "private details" },
    ...overrides,
  };
  const api = new RaceApi(
    { id: "test", secret: "secret" },
    expected,
    async (url, init) => {
      const u = new URL(String(url));
      const path = u.pathname + u.search;
      calls.push({ path, method: init?.method ?? "GET" });
      if (path === "/oauth2/token")
        return Response.json({ access_token: "secret", expires_in: 300 });
      assert.ok(path in responses, "Unexpected request: " + path);
      return Response.json(responses[path]);
    },
  );
  return { api, calls };
}
test("live time rejection exposes only code and sends no race mutation", async () => {
  const { api, calls } = mock();
  await assert.rejects(api.preflight(0, state), /^Error: TICKET\.10104$/);
  assert.ok(
    calls
      .filter((c) => c.path !== "/oauth2/token")
      .every((c) => c.method === "GET"),
  );
});
test("busy car is not force-finished by ready", async () => {
  const { api } = mock({
    "/activity-manager/car-queue/E001": {
      carNumber: "E001",
      wearableId: 123,
      workflowId: 456,
    },
  });
  await assert.rejects(api.preflight(3, state), /CAR_BUSY/);
});
test("start refuses a queue belonging to a different wearable", async () => {
  const { api } = mock({
    "/activity-manager/car-queue/E001": {
      carNumber: "E001",
      wearableId: 123,
      workflowId: 456,
    },
  });
  await assert.rejects(
    api.preflight(4, { ...state, workflowId: "456" }),
    /CAR_OWNERSHIP_CHANGED/,
  );
});
test("HTTP success with different record values never passes verification", async () => {
  const { api } = mock({
    "/activity-status/race-workflow/456/detail": {
      workflowId: 456,
      wearableId: Number(input.wearableId),
      carNumber: "E001",
      activityStatusCd: "FN004",
      laptime: 65000,
      recordStatusCd: "NR001",
    },
    "/activity-status/race-record/456": {
      workflowId: 456,
      carNumber: "E001",
      laptime: 65001,
      maxSpeed: 40,
      averageSpeed: 23,
      maxg: 0,
    },
    "/activity-record/race/record/track-sensor/456": {
      code: "00000",
      data: { workflowId: 456, labTime: 65000 },
    },
    "/activity-composer/race-dummy/2610131118629/wearable": {
      code: "00000",
      data: [{ psuList: [{ psuTraceId: 12, used: true }] }],
    },
  });
  assert.equal(
    await api.check(6, { ...state, workflowId: "456", psuTraceId: "12" }),
    null,
  );
});
test("record service read must agree with status and ticket consumption", async () => {
  const { api } = mock({
    "/activity-status/race-workflow/456/detail": {
      workflowId: 456,
      wearableId: Number(input.wearableId),
      carNumber: "E001",
      activityStatusCd: "FN004",
      laptime: 65000,
      recordStatusCd: "ER002",
    },
    "/activity-status/race-record/456": {
      workflowId: 456,
      carNumber: "E001",
      laptime: 65000,
      maxSpeed: 40,
      averageSpeed: 23,
      maxg: 0,
    },
    "/activity-record/race/record/track-sensor/456": {
      code: "00000",
      data: { workflowId: 456, labTime: 65000 },
    },
    "/activity-composer/race-dummy/2610131118629/wearable": {
      code: "00000",
      data: [{ psuList: [{ psuTraceId: 12, used: true }] }],
    },
  });
  assert.equal(
    await api.check(6, { ...state, workflowId: "456", psuTraceId: "12" }),
    null,
  );
});
