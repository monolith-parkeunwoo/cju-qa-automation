import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = process.env.QA_TEST_URL ?? "http://127.0.0.1:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local tests only");
const token = (
  await readFile(new URL("../.dev.vars", import.meta.url), "utf8")
).match(/QA_RUNNER_TOKEN=(.*)/)[1];
let cookie = "";
const headers = () => ({
  "Content-Type": "application/json",
  Origin: base,
  Cookie: cookie,
});
async function req(path, body, extra = {}) {
  return fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...headers(), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
}
assert.equal((await req("/api/runs")).status, 403);
assert.equal(
  (await req("/api/runner", { action: "poll", profile: {} })).status,
  403,
);
const login = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
cookie = login.headers
  .getSetCookie()
  .map((v) => v.split(";")[0])
  .join("; ");
assert.equal((await req("/api/runs")).status, 200);
const profile = {
  version: "local-fixture-only-v1",
  ready: true,
  productId: "fixture-all",
  productName: "ALL",
  price: 100,
  times: ["10:00"],
  blockers: [],
};
const runner = (body) =>
  req("/api/runner", body, { "x-qa-runner-token": token });
assert.equal((await runner({ action: "poll", profile })).status, 200);
const input = { date: "2026-12-10", time: "10:00", quantity: 2 };
const key = crypto.randomUUID();
assert.equal(
  (
    await req(
      "/api/runs",
      { key, input, profileVersion: profile.version },
      { Origin: "https://untrusted.invalid" },
    )
  ).status,
  403,
);
assert.equal(
  (
    await req("/api/runs", {
      key: crypto.randomUUID(),
      input: { ...input, quantity: 0 },
      profileVersion: profile.version,
    })
  ).status,
  400,
);
const requests = await Promise.all(
  [1, 2].map(() =>
    req("/api/runs", { key, input, profileVersion: profile.version }),
  ),
);
const results = await Promise.all(requests.map((r) => r.json()));
assert.equal(results[0].id, results[1].id);
assert.ok(results[0].id);
assert.equal(
  (
    await req("/api/runs", {
      key: crypto.randomUUID(),
      input,
      profileVersion: profile.version,
    })
  ).status,
  409,
);
const claims = await Promise.all(
  [1, 2].map(async () => (await runner({ action: "poll", profile })).json()),
);
assert.equal(claims.filter((v) => v.job).length, 1);
const job = claims.find((v) => v.job).job;
assert.equal(
  (
    await runner({
      action: "report",
      id: job.id,
      token: crypto.randomUUID(),
      report: { status: "RUNNING", step: 1 },
    })
  ).status,
  409,
);
assert.equal(
  (
    await runner({
      action: "report",
      id: job.id,
      token: job.token,
      report: { status: "SUCCESS", step: 3 },
    })
  ).status,
  400,
);
assert.equal(
  (
    await runner({
      action: "report",
      id: job.id,
      token: job.token,
      report: { status: "RUNNING", step: 1, orderId: "fixture-order" },
    })
  ).status,
  200,
);
assert.equal(
  (
    await runner({
      action: "report",
      id: job.id,
      token: job.token,
      report: { status: "RUNNING", step: 0 },
    })
  ).status,
  409,
);
assert.equal(
  (
    await runner({
      action: "report",
      id: job.id,
      token: job.token,
      report: {
        status: "SUCCESS",
        step: 3,
        orderId: "fixture-order",
        reservationId: "fixture-reservation",
        checks: [
          "product",
          "date",
          "time",
          "quantity",
          "completed",
          "reservation",
        ],
      },
    })
  ).status,
  200,
);
assert.equal((await runner({ action: "poll", profile })).status, 200);
const runs = await (await req("/api/runs")).json();
const run = runs.runs.find((r) => r.id === job.id);
assert.equal(run.status, "SUCCESS");
assert.equal(run.orderId, "fixture-order");
assert.ok(!JSON.stringify(runs).includes(token));
assert.ok(!("token" in run));
// A claimed job survives runner loss and cannot be replayed.
const lost = await (
  await req("/api/runs", {
    key: crypto.randomUUID(),
    input,
    profileVersion: profile.version,
  })
).json();
const claimed = await (await runner({ action: "poll", profile })).json();
assert.equal(claimed.job.id, lost.id);
assert.equal(
  (await (await runner({ action: "poll", profile })).json()).job,
  null,
);
console.log(
  "Checkpoint recovery: waiting for the production 90-second lease timeout",
);
await new Promise((resolve) => setTimeout(resolve, 91000));
const expired = await (await req("/api/runs")).json();
assert.equal(expired.runs.find((r) => r.id === lost.id).status, "NEEDS_REVIEW");
assert.equal(
  (
    await runner({
      action: "report",
      id: lost.id,
      token: claimed.job.token,
      report: { status: "RUNNING", step: 1 },
    })
  ).status,
  409,
);
assert.equal(
  (await (await runner({ action: "poll", profile })).json()).job,
  null,
);
// Restore fail-closed readiness after fixture-only integration verification.
await runner({
  action: "poll",
  profile: {
    version: "unverified",
    ready: false,
    productId: null,
    productName: "ALL",
    price: null,
    times: [],
    blockers: ["CONTRACT_UNVERIFIED"],
  },
});
console.log(
  "PASS: local HTTP + D1 integration: auth, CSRF, validation, duplicate request, single claim, checkpoint fencing, readback result, redaction",
);
