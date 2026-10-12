"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Clock3,
  FlaskConical,
  History,
  Play,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { labels, steps } from "../packages/contracts";
import type { Status, Profile } from "../packages/contracts";
type Run = {
  profile: string | null;
  id: string;
  input: string;
  status: Status;
  step: number;
  orderId: string | null;
  reservationId: string | null;
  reason: string | null;
  created: number;
  checks: string | null;
};
const reasons: Record<string, string> = {
  PRECONDITION: "예약 조건을 만족하지 않습니다.",
  AUTH: "개발 API 인증을 확인해 주세요.",
  API_REJECTED: "API가 요청을 거절했습니다.",
  UNCERTAIN_MUTATION:
    "처리 여부를 조회로 확인해야 합니다. 자동 재실행하지 않습니다.",
  VERIFICATION_MISMATCH: "예약 조회 결과가 요청과 일치하지 않습니다.",
  RUNNER_LOST:
    "실행기 연결이 끊겼습니다. 중복 방지를 위해 작업을 다시 실행하지 않습니다.",
  CONTRACT_ERROR: "응답 계약 또는 연결을 확인해 주세요.",
};
export default function Console() {
  const [runs, setRuns] = useState<Run[]>([]),
    [profile, setProfile] = useState<Profile | null>(null),
    [connected, setConnected] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState("reservation"),
    [date, setDate] = useState(""),
    [time, setTime] = useState(""),
    [quantity, setQuantity] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef<string | null>(null),
    lock = useRef(false);
  const active = runs.find((r) => r.id === selected);
  const ready =
    connected &&
    profile?.ready &&
    !runs.some((r) => ["WAITING", "RUNNING"].includes(r.status));
  async function refresh() {
    try {
      const r = await fetch("/api/runs", { cache: "no-store" });
      if (!r.ok) throw Error();
      const v = (await r.json()) as {
        runs: Run[];
        profile: Profile | null;
        connected: boolean;
      };
      setRuns(v.runs);
      setProfile(v.profile);
      setConnected(v.connected);
    } catch {
      setConnected(false);
      setError(
        "실행 정보를 가져오지 못했습니다. 접근 권한과 연결을 확인해 주세요.",
      );
    }
  }
  useEffect(() => {
    void refresh();
    const i = setInterval(() => void refresh(), 5000);
    return () => clearInterval(i);
  }, []);
  async function run() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    key.current ??= crypto.randomUUID();
    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: key.current,
          input: { date, time, quantity },
          profileVersion: profile?.version,
        }),
      });
      const v = (await r.json()) as { id: string; error?: string };
      if (!r.ok) {
        if (r.status < 500) key.current = null;
        throw Error(
          v.error === "RUN_BUSY"
            ? "다른 예약을 실행하고 있습니다."
            : "입력값과 예약 조건을 확인해 주세요.",
        );
      }
      setSelected(v.id);
      key.current = null;
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "요청을 확인하지 못했습니다. 같은 입력으로 다시 확인해 주세요.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/">
          CJU<span>QA CONSOLE</span>
        </a>
        <div className="workspace">
          <span className="dot" /> TEAM WORKSPACE
        </div>
        <nav>
          <button
            className={tab === "reservation" ? "chosen" : ""}
            onClick={() => setTab("reservation")}
          >
            <FlaskConical size={18} />
            예약 실행
          </button>
          <button
            className={tab === "history" ? "chosen" : ""}
            onClick={() => setTab("history")}
          >
            <History size={18} />
            실행 이력 <small>{runs.length}</small>
          </button>
        </nav>
        <div className="sidebar-foot">
          <ShieldCheck size={18} />
          <p>
            개발 환경 전용
            <br />
            <span>실제 이용객 데이터와 분리</span>
          </p>
        </div>
      </aside>
      <div className="content">
        <header>
          <span>
            QA Automation <span className="slash">/</span>{" "}
            {tab === "history" ? "실행 이력" : "예약"}
          </span>
          <span className="env">DEVELOPMENT</span>
        </header>
        <main>
          <div className="heading">
            <div>
              <span className="eyebrow">01 / RESERVATION</span>
              <h1>{tab === "history" ? "실행 이력" : "예약부터, 확실하게."}</h1>
              <p>ALL 상품 예약을 만들고, 조회 결과까지 검증합니다.</p>
            </div>
            <div className={`connection ${connected ? "online" : ""}`}>
              <span className="dot" />
              {connected ? "실행기 연결됨" : "실행기 연결 대기"}
            </div>
          </div>
          <div className="milestones">
            <b>
              <span>01</span> 예약
            </b>
            <span>02 발권</span>
            <span>03 레이스</span>
            <span>04 액티비티</span>
            <small>다음 단계는 예약 검증 후 연결됩니다</small>
          </div>
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          {!profile?.ready && (
            <div className="notice">
              <ShieldCheck size={19} />
              <div>
                <strong>개발 환경 계약을 확인하고 있습니다</strong>
                <p>
                  ALL 상품·가격·예약 시간·인증·응답 계약을 확인한 뒤 예약을
                  실행할 수 있습니다.
                </p>
              </div>
            </div>
          )}
          {tab === "reservation" && (
            <div className="grid">
              <section className="card">
                <div className="card-title">
                  <h2>예약 설정</h2>
                  <span>개발 환경 고정</span>
                </div>
                <div className="product">
                  <div className="product-icon">ALL</div>
                  <div>
                    <strong>ALL 패키지</strong>
                    <p>
                      {profile?.productId
                        ? `상품 ID ${profile.productId}`
                        : "상품 정보 확인 대기"}
                    </p>
                  </div>
                  <b>
                    {profile?.price != null
                      ? `${profile.price.toLocaleString()}원`
                      : "미확정"}
                  </b>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run();
                  }}
                >
                  <label>
                    예약일
                    <input
                      aria-label="예약일"
                      type="date"
                      required
                      value={date}
                      disabled={busy || !!key.current}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <div className="form-row">
                    <label>
                      예약 시간
                      <select
                        required
                        value={time}
                        disabled={busy || !!key.current}
                        onChange={(e) => setTime(e.target.value)}
                      >
                        <option value="">시간 선택</option>
                        {profile?.times.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      수량
                      <input
                        type="number"
                        min="1"
                        max="20"
                        required
                        value={quantity}
                        disabled={busy || !!key.current}
                        onChange={(e) => setQuantity(Number(e.target.value))}
                      />
                    </label>
                  </div>
                  <div className="summary">
                    <span>예상 합계</span>
                    <strong>
                      {profile?.price != null
                        ? `${(profile.price * quantity).toLocaleString()}원`
                        : "—"}
                    </strong>
                  </div>
                  <button
                    className="primary"
                    disabled={!ready || busy || !date || !time}
                  >
                    <Play size={16} />
                    {busy ? "실행 요청 중…" : "예약 검증 실행"}
                    <ArrowUpRight size={17} />
                  </button>
                  <p className="footnote">
                    테스트 주문자·직원은 실행기 설정을 사용합니다.
                    <br />
                    가상 발권은 자동으로 진행하지 않습니다.
                  </p>
                </form>
              </section>
              <section className="card">
                <div className="card-title">
                  <h2>실행 상세</h2>
                  {active && (
                    <span className={`badge ${active.status}`}>
                      {labels[active.status]}
                    </span>
                  )}
                </div>
                {active ? (
                  <>
                    <div className="run-id">{active.id}</div>
                    <p className="request-summary">
                      ALL · {JSON.parse(active.input).date}{" "}
                      {JSON.parse(active.input).time} ·{" "}
                      {JSON.parse(active.input).quantity}매
                    </p>
                    <ol className="step-list">
                      {steps.map((s, i) => (
                        <li
                          key={s}
                          className={
                            active.status === "SUCCESS" || i < active.step
                              ? "done"
                              : i === active.step
                                ? "current"
                                : ""
                          }
                        >
                          <span>
                            {active.status === "SUCCESS" || i < active.step ? (
                              <Check size={15} />
                            ) : (
                              i + 1
                            )}
                          </span>
                          <div>
                            <strong>{s}</strong>
                            <p>
                              {i < active.step || active.status === "SUCCESS"
                                ? "완료"
                                : i === active.step
                                  ? labels[active.status]
                                  : "후속 단계 대기"}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                    <dl>
                      <dt>주문번호</dt>
                      <dd>{active.orderId ?? "미확보"}</dd>
                      <dt>예약번호</dt>
                      <dd>{active.reservationId ?? "미확보"}</dd>
                    </dl>
                    {active.reason && (
                      <p className="result-note">{reasons[active.reason]}</p>
                    )}
                    {active.status === "SUCCESS" && (
                      <p className="success-note">
                        상품 · 예약일 · 시간 · 수량 · 완료 상태 · 예약번호 검증
                        완료
                      </p>
                    )}
                  </>
                ) : (
                  <div className="empty">
                    <Workflow size={36} />
                    <h3>첫 검증을 기다리고 있어요</h3>
                    <p>
                      예약을 실행하면 단계별 진행 상황과
                      <br />
                      주문·예약번호를 여기서 확인할 수 있습니다.
                    </p>
                    <div className="flow">
                      조건 확인 → 주문 생성 → 완료 → 재조회
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}
          <section className="card history">
            <div className="card-title">
              <h2>최근 실행</h2>
              <span>최대 100건 표시 · 결과 보존</span>
            </div>
            {runs.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>실행 시각</th>
                      <th>예약 조건</th>
                      <th>주문 / 예약번호</th>
                      <th>상태</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => {
                      const i = JSON.parse(r.input);
                      return (
                        <tr key={r.id}>
                          <td>{new Date(r.created).toLocaleString("ko-KR")}</td>
                          <td>
                            {i.date} {i.time}
                            <small>ALL · {i.quantity}매</small>
                          </td>
                          <td>
                            {r.orderId ?? "—"}
                            <small>{r.reservationId ?? "미확보"}</small>
                          </td>
                          <td>
                            <span className={`badge ${r.status}`}>
                              {labels[r.status]}
                            </span>
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => {
                                setSelected(r.id);
                                setTab("reservation");
                              }}
                            >
                              상세 보기 ↗
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-history">
                <Clock3 size={20} />
                <p>아직 실행한 예약이 없습니다.</p>
              </div>
            )}
          </section>
          <footer>서버 처리 흐름 검증 · 수동 실행 · 개인정보 저장 안 함</footer>
        </main>
      </div>
    </div>
  );
}
