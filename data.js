/* Office data. Loaded with a plain <script> so the page also works when opened from disk (file://).
 *
 * status : working | blocked | idle | done | offline
 * theme  : dev | research | ops   (changes the room's look)
 * demo   : true marks a sample agent (shown with a SAMPLE badge, can be hidden in the UI)
 *
 * The agents without `demo` are real Claude Code sessions, copied from the session list on
 * 2026-10-21. Edit freely: add floors, move agents between floors, change statuses.
 */
window.OFFICE_DATA = {
  generatedAt: '2026-10-21T12:20:00Z',
  floors: [
    {
      id: '1F', name: '개발 스튜디오', theme: 'dev',
      agents: [
        {
          id: 'session_01AKrJuavXQ25dRfH5ZYMc6r', title: '픽셀 오피스', role: '프론트엔드', status: 'working',
          summary: '픽셀 오피스 시각화를 만드는 중이에요.', branch: 'claude/magical-turing-lc5qvm',
          model: 'sonnet-5-5', tokens: { used: 98911, max: 1000000 }, cost: 0.55, updated: '2026-10-21T12:14:12Z',
        },
        {
          id: 'session_01Acqjf95Zc593NP6zfdEHUH', title: '게임 UI 렌더러 및 성능 개선', role: '렌더링', status: 'done',
          summary: '저장 파일 가져오기 XSS와 내보내기 크기 초과 문제를 포함해 우선순위별 수정점 10개를 정리했어요. 적용은 아직이에요.',
          branch: 'claude/adoring-heisenberg-yr4ehv', model: 'sonnet-5-5',
          tokens: { used: 176761, max: 1000000 }, cost: 2.45, updated: '2026-10-09T14:05:09Z',
        },
        {
          id: 'demo-1f-1', demo: true, title: '결제 모듈 테스트 실패', role: 'QA', status: 'blocked',
          summary: '통합 테스트 3건이 실패해서 환경 변수 확인이 필요해요.', branch: 'fix/payment-tests',
          model: 'sonnet-5-5', tokens: { used: 412000, max: 1000000 }, cost: 3.1, updated: '2026-10-21T11:40:00Z',
        },
        {
          id: 'demo-1f-2', demo: true, title: '린트 경고 정리', role: '리팩터링', status: 'idle',
          summary: '다음 작업을 기다리는 중이에요.', branch: 'chore/lint',
          model: 'haiku-5-5', tokens: { used: 38000, max: 1000000 }, cost: 0.12, updated: '2026-10-21T10:02:00Z',
        },
        {
          id: 'demo-1f-3', demo: true, title: 'API 응답 캐싱', role: '백엔드', status: 'working',
          summary: 'Redis 캐시 계층을 붙이고 있어요.', branch: 'feat/api-cache',
          model: 'opus-5-5', tokens: { used: 603000, max: 1000000 }, cost: 6.8, updated: '2026-10-21T12:18:00Z',
        },
      ],
    },
    {
      id: '2F', name: '게임 연구소', theme: 'research',
      agents: [
        {
          id: 'session_01WNxQUiWBscSGwTCWMYUAP2', title: '아이돌 키우기 매니저 초안', role: '게임 기획', status: 'done',
          summary: 'v1.0.0 완성: 이벤트 51개, 3막 스토리, 저장/이어하기, 시즌 결산, 키보드 조작, 테스트 1,600개 통과.',
          branch: 'claude/idol-manager-game-draft-li6mzs', model: 'sonnet-5-5',
          tokens: { used: 276739, max: 1000000 }, cost: 4.69, updated: '2026-10-06T15:15:03Z',
        },
        {
          id: 'demo-2f-1', demo: true, title: '밸런스 시뮬레이션', role: '데이터', status: 'working',
          summary: '시즌 1만 회 시뮬레이션을 돌려 성장 곡선을 보고 있어요.', branch: 'exp/balance-sim',
          model: 'sonnet-5-5', tokens: { used: 220000, max: 1000000 }, cost: 1.9, updated: '2026-10-21T12:05:00Z',
        },
        {
          id: 'demo-2f-2', demo: true, title: '시나리오 초안 작성', role: '시나리오', status: 'working',
          summary: '2막 대사 120줄을 다듬고 있어요.', branch: 'content/act2',
          model: 'opus-5-5', tokens: { used: 340000, max: 1000000 }, cost: 4.2, updated: '2026-10-21T12:11:00Z',
        },
      ],
    },
    {
      id: '3F', name: '생활 앱 팀', theme: 'ops',
      agents: [
        {
          id: 'session_01Fn25X3YafYN1J6XtZ2tB3s', title: '사주팔자 및 운세 앱', role: '앱 개발', status: 'offline',
          summary: '보관된 세션이에요. 내 컴퓨터에 연결되지 않아 오프라인이에요.', branch: '-',
          model: 'opus-5', tokens: { used: 0, max: 1000000 }, cost: 0, updated: '2026-08-25T16:04:47Z',
        },
        {
          id: 'demo-3f-1', demo: true, title: '운세 문구 번역', role: '번역', status: 'working',
          summary: '영어/일본어 문구 240개를 번역하고 있어요.', branch: 'i18n/fortune',
          model: 'haiku-5-5', tokens: { used: 91000, max: 1000000 }, cost: 0.4, updated: '2026-10-21T12:16:00Z',
        },
        {
          id: 'demo-3f-2', demo: true, title: 'README 정리', role: '문서', status: 'idle',
          summary: '다음 작업을 기다리는 중이에요.', branch: 'docs/readme',
          model: 'haiku-5-5', tokens: { used: 12000, max: 1000000 }, cost: 0.05, updated: '2026-10-21T09:30:00Z',
        },
      ],
    },
  ],
};
