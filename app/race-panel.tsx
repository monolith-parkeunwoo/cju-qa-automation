"use client";
import { useState, useRef } from "react";
import {
  raceSteps,
  raceInputSchema,
  type RaceInput,
  type RaceState,
} from "../packages/contracts/race";
import { labels, type Status } from "../packages/contracts";
const messages: Record<string, string> = {
  "TICKET.10104":
    "티켓 API가 탑승 시간 조건을 거절했습니다. 예약 시각과 허용 범위 확인이 필요합니다.",
  CAR_BUSY: "차량이 다른 레이스에 사용 중입니다.",
  RACE_DURATION_PENDING: "설정한 주행 시간이 아직 지나지 않았습니다.",
  EXISTING_CHECKIN:
    "이미 체크인된 티켓입니다. 기존 진행 상태를 확인해야 합니다.",
  RUNNER_LOST: "실행기 연결이 끊겨 처리 여부를 확인해야 합니다.",
  VERIFICATION_TIMEOUT: "후속 조회에서 기대 상태를 확인하지 못했습니다.",
};
type Run = {
  id: string;
  wearables: string | null;
  raceState: string | null;
  raceStatus: Status | null;
  raceStep: number | null;
  raceReason: string | null;
};
export default function RacePanel({
  run,
  connected,
  refresh,
}: {
  run: Run;
  connected: boolean;
  refresh: () => Promise<void>;
}) {
  const state: RaceState | null = run.raceState
    ? JSON.parse(run.raceState)
    : null;
  const wearables: { wearableId: string; verified: boolean }[] = JSON.parse(
    run.wearables ?? "[]",
  );
  const [input, setInput] = useState<RaceInput>(
    state?.input ?? {
      wearableId: wearables.find((w) => w.verified)?.wearableId ?? "",
      carNumber: "E001",
      trackId: 1,
      gateId: "cju_board_checkin_b2f_ed01",
      laptime: 65000,
      maxSpeed: 40,
      averageSpeed: 23,
      maxAcceleration: 0,
    },
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<{
      key: string;
      step: number;
      input: RaceInput;
    } | null>(null),
    lock = useRef(false);
  const next = state?.completed.length ?? 0,
    editable =
      next === 0 &&
      !busy &&
      !["WAITING", "RUNNING", "NEEDS_REVIEW"].includes(run.raceStatus ?? "");
  const disabled =
    !connected ||
    busy ||
    next === 7 ||
    ["WAITING", "RUNNING", "NEEDS_REVIEW"].includes(run.raceStatus ?? "");
  async function execute() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const value = raceInputSchema.parse(input);
      request.current ??= {
        key: crypto.randomUUID(),
        step: next,
        input: value,
      };
      const res = await fetch(`/api/runs/${run.id}/race`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.current),
      });
      if (!res.ok) {
        if (res.status < 500) request.current = null;
        throw Error("요청하지 못했습니다. 입력값과 실행 상태를 확인해 주세요.");
      }
      request.current = null;
      await refresh();
    } catch {
      setError(
        "요청 결과를 확인하지 못했습니다. 입력값을 확인한 뒤 같은 요청으로 상태를 확인해 주세요.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="card race-panel">
      <div className="card-title">
        <h2>레이스 QA</h2>
        <span>E1 · 트랙 1 · 개발 API</span>
      </div>
      <p>
        각 단계는 조회 검증 후 다음 버튼이 열립니다. 상태 변경 요청은 자동
        재시도하지 않습니다.
      </p>
      <div className="race-fields">
        <label>
          wearableId
          <select
            disabled={!editable}
            value={input.wearableId}
            onChange={(e) => setInput({ ...input, wearableId: e.target.value })}
          >
            {wearables
              .filter((w) => w.verified)
              .map((w) => (
                <option key={w.wearableId}>{w.wearableId}</option>
              ))}
          </select>
        </label>
        <label>
          차량 번호
          <input
            disabled={!editable}
            value={input.carNumber}
            onChange={(e) => setInput({ ...input, carNumber: e.target.value })}
          />
        </label>
        <label>
          탑승 게이트
          <input
            disabled={!editable}
            value={input.gateId}
            onChange={(e) => setInput({ ...input, gateId: e.target.value })}
          />
        </label>
        <label>
          랩타임 (ms)
          <input
            type="number"
            min={60000}
            max={300000}
            disabled={!editable}
            value={input.laptime}
            onChange={(e) =>
              setInput({ ...input, laptime: Number(e.target.value) })
            }
          />
        </label>
        <label>
          최고 속도 (km/h)
          <input
            type="number"
            min={0}
            max={60}
            disabled={!editable}
            value={input.maxSpeed}
            onChange={(e) =>
              setInput({ ...input, maxSpeed: Number(e.target.value) })
            }
          />
        </label>
        <label>
          평균 속도 (km/h)
          <input
            type="number"
            min={0}
            max={60}
            disabled={!editable}
            value={input.averageSpeed}
            onChange={(e) =>
              setInput({ ...input, averageSpeed: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <ol className="step-list race-steps">
        {raceSteps.map((title, i) => (
          <li
            key={title}
            className={i < next ? "done" : i === next ? "current" : ""}
          >
            <span>{i + 1}</span>
            <div>
              <strong>{title}</strong>
              <p>
                {i < next
                  ? "조회 검증 완료"
                  : i === run.raceStep && run.raceStatus
                    ? labels[run.raceStatus]
                    : "미실행"}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {state?.workflowId && (
        <p>
          workflowId: <code>{state.workflowId}</code>
        </p>
      )}
      {run.raceReason && (
        <p className="result-note" role="status">
          {messages[run.raceReason] ??
            "처리 상태 또는 API 계약을 확인해야 합니다."}{" "}
          <code>{run.raceReason}</code>
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        className="primary"
        disabled={disabled}
        onClick={() => void execute()}
      >
        {busy
          ? "요청 중"
          : next === 7
            ? "레이스 검증 완료"
            : run.raceStatus === "BLOCKED"
              ? `${raceSteps[next]} 다시 확인`
              : `${raceSteps[next]} 실행`}
      </button>
      <small>
        실제 장비·GPS·센서·영상은 이번 검증 범위에 포함되지 않습니다.
      </small>
    </section>
  );
}
