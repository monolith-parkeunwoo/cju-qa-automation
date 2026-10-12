import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { contractSchema, OsReservationAdapter } from "./adapter.ts";
import { reserve } from "./engine.ts";
import { profileSchema } from "../packages/contracts/index.ts";
import type { Job, Profile, Report } from "../packages/contracts/index.ts";
const e = process.env;
const site = new URL(e.QA_SITE_URL ?? "");
if (
  site.protocol !== "https:" &&
  !(
    ["localhost", "127.0.0.1"].includes(site.hostname) && e.QA_LOCAL_DEV === "1"
  )
)
  throw new Error("HTTPS Site URL required");
if (!e.QA_RUNNER_TOKEN || e.QA_RUNNER_TOKEN.length < 32)
  throw new Error("Runner token required");
let contract;
try {
  contract = contractSchema.parse(
    JSON.parse(
      await readFile(e.QA_CONTRACT_FILE ?? "config/development.json", "utf8"),
    ),
  );
} catch {
  contract = null;
}
const configured = !!(
  contract &&
  e.QA_DEV_ACCESS_TOKEN &&
  e.QA_TEST_ORDERER_NAME &&
  e.QA_TEST_ORDERER_PHONE &&
  Number(e.QA_STAFF_ID) > 0 &&
  (e.QA_SITES_SERVICE_TOKEN || e.QA_LOCAL_DEV === "1")
);
const profile: Profile = profileSchema.parse({
  version: contract
    ? `${contract.version.slice(0, 60)}-${createHash("sha256").update(JSON.stringify(contract)).digest("hex").slice(0, 12)}`
    : "unverified",
  ready: configured,
  productId: contract?.productId ?? null,
  productName: "ALL",
  price: contract?.price ?? null,
  times: contract?.times ?? [],
  blockers: configured
    ? []
    : [contract ? "AUTH_UNAVAILABLE" : "CONTRACT_UNVERIFIED"],
});
async function send(value: unknown) {
  const r = await fetch(new URL("/api/runner", site), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-qa-runner-token": e.QA_RUNNER_TOKEN!,
      ...(e.QA_SITES_SERVICE_TOKEN
        ? { "OAI-Sites-Authorization": `Bearer ${e.QA_SITES_SERVICE_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!r.ok) throw new Error("Site operation failed");
  return r.json();
}
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
while (!stopping) {
  try {
    const { job } = (await send({ action: "poll", profile })) as {
      job: Job | null;
    };
    if (job && contract && configured) {
      const adapter = new OsReservationAdapter(
        contract,
        e.QA_DEV_ACCESS_TOKEN!,
        {
          name: e.QA_TEST_ORDERER_NAME!,
          phone: e.QA_TEST_ORDERER_PHONE!,
          regId: Number(e.QA_STAFF_ID),
        },
      );
      await reserve(adapter, job.input, async (report: Report) => {
        await send({ action: "report", id: job.id, token: job.token, report });
      });
    }
  } catch {
    console.error(
      "QA runner: 연결 또는 상태 보고 실패. 처리 중 작업은 재실행하지 않습니다.",
    );
  }
  if (!stopping) await delay(5000);
}
