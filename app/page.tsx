import { member } from "../lib/server";
import { getChatGPTUser, chatGPTSignInPath } from "./chatgpt-auth";
import Console from "./console";
export const dynamic = "force-dynamic";
export default async function Page() {
  const u = await getChatGPTUser();
  if (!u)
    return (
      <main className="gate">
        <span className="eyebrow">CJU / QUALITY ASSURANCE</span>
        <h1>팀의 검증을 한곳에서.</h1>
        <p>개발 환경 전용 QA Console입니다.</p>
        <a className="primary" href={chatGPTSignInPath("/")} target="_top">
          ChatGPT로 로그인
        </a>
      </main>
    );
  if (!(await member()))
    return (
      <main className="gate">
        <span className="eyebrow">CJU / QUALITY ASSURANCE</span>
        <h1>팀 접근 설정이 필요합니다.</h1>
        <p>지정된 팀원만 예약 실행과 결과를 볼 수 있습니다.</p>
        <p>
          관리자가 Sites의 QA_TEAM_USER_IDS에 이 계정의 Site 사용자 ID를
          등록해야 합니다.
        </p>
        <code>{u.userId}</code>
      </main>
    );
  return <Console />;
}
