# first-pr-practice

Practice repo for my first pull request — now also home to **Pixel Office**, a pixel-art
dashboard where a team of agents works through a hook-up (훅업) design pipeline, floor by floor.

## Pixel Office

Open `index.html` in a browser (works straight from disk, no build step).

| Floor | Stage | Rules |
|---|---|---|
| 1F | 시스템 구성 (systems, pressure class) | none |
| 2F | 객체 생성 (equipment + instruments) | none |
| 3F | 배관 설계 (hook-up design) | **applied here only** |
| 4F | 룰 검수 (was each rule applied? is the result right?) | audit |
| 5F | 내 Claude 세션 (real sessions, from `data.js`) | – |

- Work is split between agents (e.g. one piping designer per system). Rejected designs go back to 3F for rework.
- A system whose pressure class is above the component catalog (HPS) is parked and shown as **blocked** until a human approves an exception.
- Day/night follows your clock. `O` = all floors at once, `Space` = run/pause, `1–9` = floors, click a character for details.
- Sound effects are generated with WebAudio (off by default).

**The workers are deterministic simulations, not LLM calls**, and the rules in `js/hookup/core.js`
are **sample rules** — replace them with your own standard. "결함 주입" makes designers occasionally
skip a rule so the review/rework loop is visible; turn it off for a clean run.

```
node test/hookup.test.js     # pipeline + rule engine tests (no dependencies)
```

Art is drawn procedurally in `js/sprites.js`; fonts live in `assets/fonts` (Galmuri, Press Start 2P — SIL OFL).

## Workflow

1. Create a branch off `main`
2. Make a small, focused change
3. Commit with a clear message
4. Push the branch
5. Open a pull request
