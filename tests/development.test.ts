import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDevelopmentOrder,
  DevelopmentApi,
} from "../runner/development-api.ts";
const row = {
  product: { productId: 116 },
  reservationTime: { boardingDate: "2026-10-13", boardingTime: "19:00:00" },
};
test("deployed order arrays normalize quantity and boarding time", () => {
  assert.deepEqual(
    normalizeDevelopmentOrder({
      orderId: 1,
      reservationId: "R1",
      orderStatus: "COMPLETED",
      orderProducts: [row, row],
    }),
    {
      orderId: "1",
      reservationId: "R1",
      productId: "116",
      date: "2026-10-13",
      time: "19:00",
      quantity: 2,
      completed: true,
    },
  );
});
test("mixed product and slot responses cannot pass verification", () => {
  assert.throws(() =>
    normalizeDevelopmentOrder({
      orderId: 1,
      reservationId: "R1",
      orderStatus: "COMPLETED",
      orderProducts: [row, { ...row, product: { productId: 77 } }],
    }),
  );
});
test("development client keeps gateway service prefix and handles business errors", async () => {
  const calls: string[] = [];
  const client = new DevelopmentApi(
    {
      product: { id: "test", secret: "secret" },
      order: { id: "test", secret: "secret" },
      ticket: { id: "test", secret: "secret" },
    },
    async (url) => {
      calls.push(String(url));
      return String(url).includes("oauth2/token")
        ? Response.json({ access_token: "token", expires_in: 300 })
        : Response.json({ code: "NOT_FOUND", message: "private-content" });
    },
  );
  await assert.rejects(client.readOrder("1"), /API_REJECTED/);
  assert.equal(
    calls[1],
    "https://dev-api.cju.981park.com/order/os/v1/orders/1",
  );
});
