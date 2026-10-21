/* Real Claude Code sessions, shown on the top floor (5F) of the Pixel Office.
 * Copied from the session list on 2026-10-21 — they are NOT updated automatically.
 * The hook-up pipeline floors (1F–4F) come from js/hookup/core.js, not from this file.
 *
 * status : working | blocked | idle | done | offline
 */
window.OFFICE_DATA = {
  generatedAt: '2026-10-21T12:35:00Z',
  floors: [
    {
      id: '5F', name: '내 Claude 세션', theme: 'dev', sign: { text: 'SESSIONS', color: '#6ab0ff' },
      agents: [
        {
          id: 'session_01AKrJuavXQ25dRfH5ZYMc6r', title: '픽셀 오피스', role: '시각화', status: 'working',
          summary: '훅업 설계 파이프라인 코어를 만들고 node 테스트로 검증하는 중이에요.', branch: 'claude/magical-turing-lc5qvm',
          model: 'sonnet-5-5', tokens: { used: 214556, max: 1000000 }, cost: 2.25, updated: '2026-10-21T12:32:02Z',
        },
        {
          id: 'session_01Acqjf95Zc593NP6zfdEHUH', title: '게임 UI 렌더러 및 성능 개선', role: '렌더링', status: 'done',
          summary: '저장 파일 가져오기 XSS와 내보내기 크기 초과 문제를 포함해 우선순위별 수정점 10개를 정리했어요. 적용은 아직이에요.',
          branch: 'claude/adoring-heisenberg-yr4ehv', model: 'sonnet-5-5',
          tokens: { used: 176761, max: 1000000 }, cost: 2.45, updated: '2026-10-09T14:05:09Z',
        },
        {
          id: 'session_01WNxQUiWBscSGwTCWMYUAP2', title: '아이돌 키우기 매니저 초안', role: '게임 기획', status: 'done',
          summary: 'v1.0.0 완성: 이벤트 51개, 3막 스토리, 저장/이어하기, 시즌 결산, 키보드 조작, 테스트 1,600개 통과.',
          branch: 'claude/idol-manager-game-draft-li6mzs', model: 'sonnet-5-5',
          tokens: { used: 276739, max: 1000000 }, cost: 4.69, updated: '2026-10-06T15:15:03Z',
        },
        {
          id: 'session_01Fn25X3YafYN1J6XtZ2tB3s', title: '사주팔자 및 운세 앱', role: '앱 개발', status: 'offline',
          summary: '보관된 세션이에요. 내 컴퓨터에 연결되지 않아 오프라인이에요.', branch: '-',
          model: 'opus-5', tokens: { used: 0, max: 1000000 }, cost: 0, updated: '2026-08-25T16:04:47Z',
        },
      ],
    },
  ],
};
