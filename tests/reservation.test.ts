import test from "node:test";
import assert from "node:assert/strict";
import { reserve, QaError } from "../runner/engine.ts";
import {
  inputSchema,
  reportSchema,
  verifyOrder,
} from "../packages/contracts/index.ts";
import { contractSchema, OsReservationAdapter } from "../runner/adapter.ts";
import type { ReservationPort } from "../runner/engine.ts";
import type { Report } from "../packages/contracts/index.ts";
const input = { date: "2026-12-10", time: "10:00", quantity: 2 };
const order = {
  orderId: "order1",
  reservationId: "booking1",
  productId: "fixture-all",
  ...input,
  completed: true,
};
function fixture() {
  const calls: string[] = [];
  const reports: Report[] = [];
  const port: ReservationPort = {
    productId: "fixture-all",
    preflight: async () => {
      calls.push("check");
    },
    create: async () => {
      calls.push("create");
      return "order1";
    },
    complete: async () => {
      calls.push("complete");
    },
    read: async () => {
      calls.push("read");
      return order;
    },
  };
  return {
    calls,
    reports,
    port,
    report: async (r: Report) => {
      reports.push(reportSchema.parse(r));
    },
  };
}
test("successful reservation requires readback of all six properties", async () => {
  const f = fixture();
  await reserve(f.port, input, f.report);
  assert.deepEqual(f.calls, ["check", "create", "complete", "read"]);
  assert.equal(f.reports.at(-1)?.status, "SUCCESS");
  assert.equal(f.reports.at(-1)?.reservationId, "booking1");
});
test("precondition failure never sends a mutation", async () => {
  const f = fixture();
  f.port.preflight = async () => {
    throw new QaError("PRECONDITION");
  };
  await reserve(f.port, input, f.report);
  assert.deepEqual(f.calls, []);
  assert.equal(f.reports.at(-1)?.status, "BLOCKED");
});
test("authentication failure blocks order creation", async () => {
  const f = fixture();
  f.port.preflight = async () => {
    throw new QaError("AUTH");
  };
  await reserve(f.port, input, f.report);
  assert.deepEqual(f.calls, []);
  assert.equal(f.reports.at(-1)?.reason, "AUTH");
});
test("ambiguous create is never automatically retried", async () => {
  const f = fixture();
  let n = 0;
  f.port.create = async () => {
    n++;
    throw new QaError("UNCERTAIN_MUTATION", true);
  };
  await reserve(f.port, input, f.report);
  assert.equal(n, 1);
  assert.equal(f.reports.at(-1)?.status, "NEEDS_REVIEW");
  assert.ok(!f.calls.includes("complete"));
});
test("ambiguous completion can succeed only through readback", async () => {
  const f = fixture();
  let n = 0;
  f.port.complete = async () => {
    n++;
    throw new QaError("UNCERTAIN_MUTATION", true);
  };
  await reserve(f.port, input, f.report);
  assert.equal(n, 1);
  assert.equal(f.reports.at(-1)?.status, "SUCCESS");
});
test("unresolved completion preserves order ID", async () => {
  const f = fixture();
  f.port.complete = async () => {
    throw new QaError("UNCERTAIN_MUTATION", true);
  };
  f.port.read = async () => ({ ...order, completed: false });
  await reserve(f.port, input, f.report);
  assert.equal(f.reports.at(-1)?.status, "NEEDS_REVIEW");
  assert.equal(f.reports.at(-1)?.orderId, "order1");
});
test("each mismatch prevents success", () => {
  for (const [key, value] of Object.entries({
    orderId: "other",
    reservationId: "",
    productId: "other",
    date: "2027-01-01",
    time: "11:00",
    quantity: 1,
    completed: false,
  })) {
    assert.equal(
      verifyOrder({ ...order, [key]: value }, input, "fixture-all", "order1"),
      false,
      key,
    );
  }
});
test("no mutation before durable checkpoint acknowledgment", async () => {
  const f = fixture();
  await assert.rejects(
    reserve(f.port, input, async () => {
      throw Error("offline");
    }),
  );
  assert.equal(f.calls.length, 0);
});
test("invalid input and fabricated success rejected", () => {
  assert.equal(
    inputSchema.safeParse({ ...input, date: "2026-02-30" }).success,
    false,
  );
  assert.equal(inputSchema.safeParse({ ...input, quantity: 0 }).success, false);
  assert.equal(
    inputSchema.safeParse({ ...input, time: "24:00" }).success,
    false,
  );
  assert.equal(
    reportSchema.safeParse({ status: "SUCCESS", step: 3 }).success,
    false,
  );
  assert.equal(
    reportSchema.safeParse({
      status: "FAILURE",
      step: 0,
      response: { phone: "secret" },
    }).success,
    false,
  );
});
test("unverified development profile cannot enable execution", () => {
  assert.equal(
    contractSchema.safeParse({ status: "UNVERIFIED" }).success,
    false,
  );
});
const contract = contractSchema.parse({
  version: "test-fixture-v1",
  environment: "development",
  verifiedAt: "2026-10-12T00:00:00.000Z",
  evidence: "Unit-test fixture only; never a deployed API contract",
  baseUrl: "https://fixture.invalid",
  productId: "fixture-all",
  productIdType: "string",
  price: 100,
  times: ["10:00"],
  quantityEncoding: "repeatedOrderProducts",
  payType: "CARD",
  preflight: [
    {
      kind: "product",
      path: "/product",
      pointer: "/data/id",
      expected: "fixture-all",
    },
    { kind: "price", path: "/product", pointer: "/data/price", expected: 100 },
    {
      kind: "availability",
      path: "/availability?date={date}&time={time}&quantity={quantity}",
      pointer: "/data/available",
      expected: true,
    },
  ],
  success: { pointer: "/code", expected: "OK" },
  createOrderId: "/data/id",
  read: {
    path: "/orders/{orderId}",
    orderId: "/data/orderId",
    reservationId: "/data/reservationId",
    productId: "/data/productId",
    date: "/data/date",
    time: "/data/time",
    quantity: "/data/quantity",
    status: "/data/status",
    completedValue: "COMPLETED",
  },
});
test("HTTP adapter uses configured mapping and keeps PII outside reports", async () => {
  const calls: { url: string; body: any }[] = [];
  const transport: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const data =
      path === "/product"
        ? { id: "fixture-all", price: 100 }
        : path === "/availability"
          ? { available: true }
          : path === "/os/v1/orders"
            ? { id: "order1" }
            : path.endsWith("complete")
              ? {}
              : { ...order, status: "COMPLETED" };
    return Response.json({ code: "OK", data });
  };
  const adapter = new OsReservationAdapter(
    contract,
    "secret-token",
    { name: "test-private", phone: "test-phone", regId: 123 },
    transport,
  );
  const reports: Report[] = [];
  await reserve(adapter, input, async (r) => {
    reports.push(r);
  });
  assert.equal(reports.at(-1)?.status, "SUCCESS");
  const create = calls.find((c) => c.url.endsWith("/os/v1/orders"));
  assert.equal(create?.body.orderProducts.length, 2);
  assert.ok(!JSON.stringify(reports).includes("test-phone"));
  assert.ok(!JSON.stringify(reports).includes("secret-token"));
});
test("HTTP 401 preflight makes no POST", async () => {
  let mutations = 0;
  const adapter = new OsReservationAdapter(
    contract,
    "expired",
    { name: "test", phone: "test", regId: 123 },
    async (_, init) => {
      if (init?.method === "POST") mutations++;
      return new Response(null, { status: 401 });
    },
  );
  const f = fixture();
  await reserve(adapter, input, f.report);
  assert.equal(mutations, 0);
  assert.equal(f.reports.at(-1)?.reason, "AUTH");
});

test("eventual consistency retries only read operations", async () => {
  const f = fixture();
  let reads = 0;
  f.port.read = async () => {
    reads++;
    return { ...order, completed: reads === 3 };
  };
  await reserve(f.port, input, f.report, async () => {});
  assert.equal(reads, 3);
  assert.equal(f.calls.filter((c) => c === "create").length, 1);
  assert.equal(f.reports.at(-1)?.status, "SUCCESS");
});

test("readback connection failure after completion remains reviewable", async () => {
  const f = fixture();
  f.port.read = async () => {
    throw new QaError("CONTRACT_ERROR");
  };
  await reserve(f.port, input, f.report);
  assert.equal(f.reports.at(-1)?.status, "NEEDS_REVIEW");
  assert.equal(f.reports.at(-1)?.orderId, "order1");
});
