import { normalizeSlots } from "../packages/contracts/availability.ts";
import type { AvailabilityJob } from "../packages/contracts/availability.ts";
import { RaceApi } from "./race-api.ts";
import { executeRaceStep } from "./race-engine.ts";
import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { DevelopmentApi } from "./development-api.ts";
import { reserve } from "./engine.ts";
import { issueTickets } from "./ticketing.ts";
import type { Job, Profile } from "../packages/contracts/index.ts";
const credential = z.object({
  id: z.string().min(1),
  secret: z.string().min(1),
});
const secretsSchema = z.object({
  credentials: z.object({
    product: credential,
    order: credential,
    ticket: credential,
    race: credential.optional(),
  }),
  orderer: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
    regId: z.number().int().positive(),
  }),
  siteUrl: z.string().url(),
  serviceToken: z.string().optional(),
  runnerToken: z.string().min(32).optional(),
  local: z.boolean().default(false),
});
// Bootstrap secrets through protected stdin; never store credentials in project files.
console.log("Ready for private runner configuration on stdin");
const rl = createInterface({ input: process.stdin });
const first = await new Promise<string>((resolve) => rl.once("line", resolve));
rl.close();
const config = secretsSchema.parse(JSON.parse(first));
const site = new URL(config.siteUrl);
if (config.local) {
  if (!["127.0.0.1", "localhost"].includes(site.hostname))
    throw Error("Local Site required");
} else if (site.protocol !== "https:" || !config.serviceToken)
  throw Error("Private HTTPS service access required");
const runnerToken =
  config.runnerToken ??
  (config.local
    ? (await readFile(new URL("../.dev.vars", import.meta.url), "utf8")).match(
        /^QA_RUNNER_TOKEN=(.+)$/m,
      )?.[1]
    : undefined);
if (!runnerToken) throw Error("Runner authentication required");
async function send(value: unknown) {
  const r = await fetch(new URL("/api/runner", site), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-qa-runner-token": runnerToken!,
      ...(config.serviceToken
        ? { "OAI-Sites-Authorization": `Bearer ${config.serviceToken}` }
        : {}),
    },
    body: JSON.stringify(value),
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw Error("Site report rejected");
  return r.json() as Promise<{ job: Job | null; availability?:AvailabilityJob }>;
}
const api = new DevelopmentApi(config.credentials);
let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));
let profile: Profile;
let refreshed = 0;
while (!stopping) {
  try {
    if (Date.now() - refreshed > 30000) {
      const date = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Seoul",
      });
      const product = await api.product(date);

      profile = {
        version: "dev-live-v1-p116",
        productId: "116",
        productName: "ALL",
        price: product.salePrice.priceAmount,
        times:[],
        ready:true,
        blockers:[],
      };
      refreshed = Date.now();
    }
    const { job,availability } = await send({
      action: "poll",
      profile: profile!,
      ticketing: true,
      availability:true,
      racing: !!config.credentials.race,
    });
    if(availability) {
      let snapshot=null;
      try {
        const product=await api.product(availability.date);
        const slots=normalizeSlots(await api.availability(availability.date,availability.quantity));
        snapshot={date:availability.date,quantity:availability.quantity,productId:"116",price:product.salePrice.priceAmount,checkedAt:Date.now(),slots};
      }catch { /* A failed read never authorizes a reservation. */ }
      await send({action:"availabilityReport",key:availability.key,token:availability.token,snapshot});
    }
    if (job) {
      console.log(
        JSON.stringify({
          jobId: job.id,
          kind: job.kind ?? "reservation",
          state: "started",
        }),
      );
      if (job.kind === "race") {
        if (
          !config.credentials.race ||
          job.raceStep === undefined ||
          !job.raceState ||
          !job.orderId ||
          !job.reservationId
        )
          throw Error("Missing race contract");
        await executeRaceStep(
          new RaceApi(config.credentials.race, {
            orderId: job.orderId,
            reservationId: job.reservationId,
          }),
          job.raceStep,
          job.raceState,
          async (report) => {
            await send({
              action: "raceReport",
              id: job.id,
              token: job.token,
              report,
            });
            console.log(
              JSON.stringify({
                jobId: job.id,
                stage: "race",
                step: report.step,
                status: report.status,
                reason: report.reason,
              }),
            );
          },
        );
      } else if (job.kind === "ticketing") {
        if (!job.orderId || !job.reservationId)
          throw Error("Missing reservation identifiers");
        await issueTickets(
          api.ticketPort(job.orderId, job.reservationId, job.input),
          {
            orderId: job.orderId,
            reservationId: job.reservationId,
            productId: "116",
          },
          async (report) => {
            await send({
              action: "ticketReport",
              id: job.id,
              token: job.token,
              report,
            });
            console.log(
              JSON.stringify({ jobId: job.id, stage: "ticketing", ...report }),
            );
          },
        );
      } else {
        await reserve(
          api.reservationPort(config.orderer, job.price ?? profile!.price!),
          job.input,
          async (report) => {
            await send({
              action: "report",
              id: job.id,
              token: job.token,
              report,
            });
            console.log(JSON.stringify({ jobId: job.id, ...report }));
          },
        );
      }
    }
  } catch {
    console.error(
      "QA development runner: connection or contract check failed; no mutation is retried.",
    );
    refreshed = 0;
  }
  if (!stopping) await delay(3000);
}
