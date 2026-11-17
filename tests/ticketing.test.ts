import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVirtualTickets,
  verifyTicketInfo,
  issueTickets,
} from "../runner/ticketing.ts";
const rows = [
  { wrbId: 9001, nfcId: "NFC-1", nickname: "private-name" },
  { wrbId: 9002, nfcId: "NFC-2" },
];
const info = (id = 9001) => ({
  ticket: {
    wrbId: id,
    ticketId: 7,
    reservationId: "reservation1",
    enabled: true,
    printStatus: "PRINTED",
  },
  "ticket-product": [{ productId: 116, orderId: 1, enabled: true }],
  "ticket-psu": [{ enabled: true, used: false }],
});
test("virtual print maps every wrbId to wearableId and excludes private data", () => {
  const result = parseVirtualTickets({ code: "00000", data: rows });
  assert.deepEqual(result, [
    { wearableId: "9001", nfcId: "NFC-1", verified: false },
    { wearableId: "9002", nfcId: "NFC-2", verified: false },
  ]);
  assert.ok(!JSON.stringify(result).includes("private-name"));
});
test("malformed, empty and duplicate wearable IDs are rejected", () => {
  for (const data of [[], [{ wrbId: null }], [{ wrbId: 1 }, { wrbId: 1 }]])
    assert.throws(() => parseVirtualTickets({ code: "00000", data }));
});
test("ticket lookup verifies reservation, order, product and usable entitlement", () => {
  assert.equal(
    verifyTicketInfo(info(), "9001", "reservation1", "1", "116"),
    true,
  );
  assert.equal(
    verifyTicketInfo(info(9002), "9001", "reservation1", "1", "116"),
    false,
  );
  assert.equal(
    verifyTicketInfo(
      { ...info(), "ticket-psu": [{ enabled: true, used: true }] },
      "9001",
      "reservation1",
      "1",
      "116",
    ),
    false,
  );
  assert.equal(verifyTicketInfo(info(), "9001", "other", "1", "116"), false);
});
test("all issued tickets require read verification", async () => {
  const reports: any[] = [];
  let prints = 0;
  await issueTickets(
    {
      validate: async () => {},
      print: async () => {
        prints++;
        return { code: "00000", data: rows };
      },
      read: async (id: string) => info(Number(id)),
    },
    { reservationId: "reservation1", orderId: "1", productId: "116" },
    async (r) => {
      reports.push(r);
    },
  );
  assert.equal(prints, 1);
  assert.equal(reports.at(-1).status, "SUCCESS");
  assert.equal(reports.at(-1).wearables.length, 2);
  assert.ok(reports.at(-1).wearables.every((w: any) => w.verified));
});
test("print timeout is never retried", async () => {
  let prints = 0;
  const reports: any[] = [];
  await issueTickets(
    {
      validate: async () => {},
      print: async () => {
        prints++;
        throw Error("timeout");
      },
      read: async () => info(),
    },
    { reservationId: "reservation1", orderId: "1", productId: "116" },
    async (r) => {
      reports.push(r);
    },
  );
  assert.equal(prints, 1);
  assert.equal(reports.at(-1).status, "NEEDS_REVIEW");
});
test("issued wearable IDs survive lookup failure", async () => {
  const reports: any[] = [];
  await issueTickets(
    {
      validate: async () => {},
      print: async () => ({ code: "00000", data: rows }),
      read: async () => {
        throw Error("timeout");
      },
    },
    { reservationId: "reservation1", orderId: "1", productId: "116" },
    async (r) => {
      reports.push(r);
    },
  );
  assert.equal(reports.at(-1).status, "NEEDS_REVIEW");
  assert.equal(reports.at(-1).wearables[0].wearableId, "9001");
});
test("no print after failed precondition or checkpoint", async () => {
  let prints = 0;
  const port = {
    validate: async () => {
      throw Error("invalid reservation");
    },
    print: async () => {
      prints++;
      return {};
    },
    read: async () => info(),
  };
  await issueTickets(
    port,
    { reservationId: "reservation1", orderId: "1", productId: "116" },
    async () => {},
  );
  assert.equal(prints, 0);
  await assert.rejects(
    issueTickets(
      { ...port, validate: async () => {} },
      { reservationId: "reservation1", orderId: "1", productId: "116" },
      async () => {
        throw Error("checkpoint");
      },
    ),
  );
  assert.equal(prints, 0);
});
