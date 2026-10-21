# first-pr-practice

Practice repo for my first pull request — now also home to **Pixel Office**, a pixel-art
dashboard where each Claude Code session is a character working on a floor of an office building.

## Pixel Office

Open `index.html` in a browser (works straight from disk, no build step).

- **Floors** group agents; each floor has its own look (dev studio, research lab, ops office).
- **Status** drives behaviour: working = typing at a desk, blocked = standing up with `!`,
  done = relaxing on the couch, idle = wandering, offline = empty desk.
- Day/night follows your clock (or force it with the 자동/낮/밤 switch). Click a character for details.
- Agents marked `SAMPLE` are demo data; the others are real sessions. Toggle them with the SAMPLE button.

Edit `data.js` to change floors and agents. Art is drawn procedurally in `js/sprites.js`;
fonts live in `assets/fonts` (Galmuri and Press Start 2P, both SIL OFL).

## Workflow

1. Create a branch off `main`
2. Make a small, focused change
3. Commit with a clear message
4. Push the branch
5. Open a pull request
