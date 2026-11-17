import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import type { RaceState } from "../packages/contracts/race.ts";
import { RaceError, type RacePort } from "./race-engine.ts";
import { verifyTicketInfo } from "./ticketing.ts";
const numericId = z.number().int().positive().safe();
const queueSchema = z.object({
  carNumber: z.string(),
  wearableId: numericId.nullable(),
  workflowId: numericId.nullable(),
});
const id = (v: unknown) => String(numericId.parse(v));
export function koreaTime(date = new Date()) {
  return new Date(date.getTime() + 9 * 3600000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 23);
}
export class RaceApi implements RacePort {
  private token = "";
  private expires = 0;
  constructor(
    private credential: { id: string; secret: string },
    private expected: { orderId: string; reservationId: string },
    private http: typeof fetch = fetch,
  ) {}
  async request(path: string, body?: unknown): Promise<any> {
    if (!/^\/(activity-(composer|manager|status|record)|ticket)\//.test(path))
      throw new RaceError("CONTRACT_ERROR");
    if (Date.now() >= this.expires) {
      const r = await this.http(
        "https://dev-accounts.sgp.981park.com/oauth2/token",
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(
                this.credential.id + ":" + this.credential.secret,
              ).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "client_credentials",
            scope: "api.write api.read",
          }),
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        },
      );
      const v = z
        .object({
          access_token: z.string().min(1),
          expires_in: z.number().positive(),
        })
        .parse(await r.json());
      if (!r.ok) throw new RaceError("AUTH");
      this.token = v.access_token;
      this.expires = Date.now() + Math.max(0, v.expires_in - 60) * 1000;
    }
    const r = await this.http("https://dev-api.cju.981park.com" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + this.token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok)
      throw new RaceError(
        r.status === 401 || r.status === 403 ? "AUTH" : "HTTP_" + r.status,
      );
    const text = await r.text();
    if (!text) return null;
    const data = JSON.parse(text);
    if (data && "code" in data && data.code !== "00000")
      throw new RaceError(
        typeof data.code === "string" && /^[A-Z0-9_.]{1,80}$/.test(data.code)
          ? data.code
          : "API_REJECTED",
      );
    return data && "code" in data ? data.data : data;
  }
  queue(s: RaceState) {
    return this.request(
      "/activity-manager/car-queue/" + s.input.carNumber,
    ).then((v) => queueSchema.parse(v));
  }
  async ownsQueue(s: RaceState) {
    const q = await this.queue(s);
    if (
      String(q.wearableId) !== s.input.wearableId ||
      String(q.workflowId) !== s.workflowId
    )
      throw new RaceError("CAR_OWNERSHIP_CHANGED");
    return q;
  }
  async preflight(step: number, s: RaceState) {
    const i = s.input;
    if (step === 0) {
      const ticket = await this.request(
        "/ticket/v1/reservation/ticket/wearable/info/" + i.wearableId,
      );
      if (
        !verifyTicketInfo(
          ticket,
          i.wearableId,
          this.expected.reservationId,
          this.expected.orderId,
          "116",
        )
      )
        throw new RaceError("TICKET_MISMATCH");
      const car = await this.request(
        "/activity-manager/race/cars?number=" + i.carNumber,
      );
      const track = await this.request(
        "/activity-manager/race/tracks?id=" + i.trackId,
      );
      if (
        car.carNumber !== i.carNumber ||
        car.carModel !== "E" ||
        track.trackId !== 1 ||
        track.course !== "E1"
      )
        throw new RaceError("METADATA_MISMATCH");
      const gates = await this.request("/activity-status/gate/list");
      if (!Array.isArray(gates) || !gates.some((g) => g.iotCoreId === i.gateId))
        throw new RaceError("GATE_NOT_FOUND");
      const q = await this.queue(s);
      if (q.wearableId !== null || q.workflowId !== null)
        throw new RaceError("CAR_BUSY");
      const prior = await this.request(
        "/activity-composer/customer-claim/valid/" + i.wearableId + "/status",
      );
      if (prior.board || prior.course) throw new RaceError("EXISTING_CHECKIN");
    }
    if (step <= 2)
      await this.request(
        "/ticket/v1/wearable/valid-pre-check-in?wrbId=" +
          i.wearableId +
          "&psuIds=111,112,113,114,115&forceUse=false",
      );
    if (step === 3) {
      const q = await this.queue(s);
      if (q.wearableId !== null || q.workflowId !== null)
        throw new RaceError("CAR_BUSY");
    }
    if (step === 4 || step === 5) await this.ownsQueue(s);
    if (step >= 5) {
      if (
        !s.startDt ||
        Date.now() <
          Date.parse(s.startDt.replace(" ", "T") + "+09:00") + i.laptime
      )
        throw new RaceError("RACE_DURATION_PENDING");
    }
    return {};
  }
  async mutate(step: number, s: RaceState) {
    const i = s.input,
      deviceDt = koreaTime();
    const shared = {
      wearableId: Number(i.wearableId),
      carNumber: i.carNumber,
      workflowId: s.workflowId ? Number(s.workflowId) : undefined,
      deviceDt,
    };
    const base = "/activity-composer/race-dummy/";
    if (step === 1 || step === 2) {
      const v = await this.request(
        base + (step === 1 ? "boarding" : "course"),
        {
          wearableId: Number(i.wearableId),
          gateId: i.gateId,
          activityId: 1,
          deviceDt,
        },
      );
      return step === 2 && v?.psuTraceId
        ? { psuTraceId: id(v.psuTraceId) }
        : {};
    }
    if (step === 3) {
      const r = await this.request(base + "ready", shared);
      if (r?.code !== 1) throw new RaceError("READY_REJECTED");
      const q = await this.queue(s);
      if (String(q.wearableId) !== i.wearableId || q.workflowId === null)
        throw new RaceError("WORKFLOW_NOT_FOUND");
      return { workflowId: id(q.workflowId) };
    }
    if (step === 4) {
      await this.request(base + "start", {
        carNumber: i.carNumber,
        trackId: i.trackId,
        deviceDt,
      });
      return { startDt: deviceDt };
    }
    if (step === 5) {
      await this.request(base + "end", { ...shared, type: 2, staffId: 210 });
      return { finishDt: deviceDt };
    }
    if (step === 6) {
      await this.request(base + "record", {
        ...shared,
        trackId: i.trackId,
        finishDeviceDt: s.finishDt,
        staffId: 210,
        carModel: "E",
        laptime: i.laptime,
        maxSpeed: i.maxSpeed,
        averageSpeed: i.averageSpeed,
        maxAcceleration: i.maxAcceleration,
        warmUp: false,
        startUp: false,
        booster: false,
        falseStart: false,
        boosterUsageTime: 0,
        boosterRenderingTime: 0,
        reactionTime: 0,
        isManualStart: true,
        startSignalDeviceDt: s.startDt,
      });
      return {};
    }
    throw new RaceError("STEP_ORDER");
  }
  async verify(step: number, s: RaceState) {
    if (step === 0)
      return { checks: ["ticket", "metadata", "car_empty", "time"] };
    const deadline = Date.now() + 30000;
    for (let attempt = 0; attempt < 5 && Date.now() < deadline; attempt++) {
      const checks = await this.check(step, s);
      if (checks) return { checks };
      if (attempt < 4) await delay(1000);
    }
    throw new RaceError("VERIFICATION_TIMEOUT");
  }
  async check(step: number, s: RaceState): Promise<string[] | null> {
    if (step === 1 || step === 2) {
      const v = await this.request(
        "/activity-composer/customer-claim/valid/" +
          s.input.wearableId +
          "/status",
      );
      return v.board === true && (step === 1 || v.course === true)
        ? [step === 1 ? "boarding" : "course"]
        : null;
    }
    if (!s.workflowId) throw new RaceError("WORKFLOW_NOT_FOUND");
    const w = await this.request(
      "/activity-status/race-workflow/" + s.workflowId + "/detail",
    );
    if (
      String(w.workflowId) !== s.workflowId ||
      String(w.wearableId) !== s.input.wearableId ||
      w.carNumber !== s.input.carNumber
    )
      return null;
    if (step === 3) {
      await this.ownsQueue(s);
      return w.activityStatusCd === "RD001" ? ["workflow", "car_owner"] : null;
    }
    if (step === 4)
      return ["ST002", "PL003"].includes(w.activityStatusCd) &&
        w.trackId === s.input.trackId &&
        w.usedDt
        ? ["workflow", "started", "ticket_used"]
        : null;
    const q = await this.queue(s);
    if (
      q.workflowId !== null ||
      q.wearableId !== null ||
      w.activityStatusCd !== "FN004"
    )
      return null;
    if (step === 5) return ["finished", "car_released"];
    const record = await this.request(
      "/activity-status/race-record/" + s.workflowId,
    );
    const mirror = await this.request(
      "/activity-record/race/record/track-sensor/" + s.workflowId,
    );
    const product = await this.request(
      "/activity-composer/race-dummy/" + s.input.wearableId + "/wearable",
    );
    const ticketUsed =
      !!s.psuTraceId &&
      Array.isArray(product) &&
      product.some((p) =>
        p.psuList?.some(
          (t: any) => String(t.psuTraceId) === s.psuTraceId && t.used === true,
        ),
      );
    return String(record?.workflowId) === s.workflowId &&
      record.carNumber === s.input.carNumber &&
      record.laptime === s.input.laptime &&
      record.maxSpeed === s.input.maxSpeed &&
      record.averageSpeed === s.input.averageSpeed &&
      record.maxg === s.input.maxAcceleration &&
      String(mirror?.workflowId) === s.workflowId &&
      mirror.labTime === s.input.laptime &&
      w.laptime === s.input.laptime &&
      w.recordStatusCd === "NR001" &&
      ticketUsed
      ? [
          "finished",
          "car_released",
          "record_values",
          "status_record",
          "record_read",
          "ticket_used",
        ]
      : null;
  }
}
