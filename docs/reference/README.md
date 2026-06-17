# UI design reference

**Character creation wizard mockup** — target layout and styling for Wastelander.

| File | Purpose |
|------|---------|
| `wastelander-wizard-ui-mockup.png` | Approved UI mockup: left sidebar steps, origin cards, detail panel, Pip-Boy–style palette |

Use this image when implementing `CharacterWizardApp` templates and `styles/wastelander-wizard.css`.

Commit this file with the repo so the design target stays with the codebase.

**Repo:** [dorknightofthesole/wastelander-vtt](https://github.com/dorknightofthesole/wastelander-vtt) (local folder: `wastelander-foundry-vtt`).

**Rules PDF:** See [rulebook-sources.md](./rulebook-sources.md) for the local char-creation extract path (not in git).

**Oracle roll tables:** See [oracle-rolltables.md](./oracle-rolltables.md). Requires `docs/reference/source/Fallout-2d20-Wasteland-Wanderer.pdf` (local, gitignored). Workflow: `npm run extract:oracle` → review manifests → `npm run build:oracle`.

**Hexcrawl travel:** See [hexcrawl-travel.md](./hexcrawl-travel.md) — overworld hex travel, map editor, scene config export/import, and encounter table build (`npm run extract:encounters` → `npm run build:encounters`). Requires `docs/reference/source/Fallout-2d20-GM-Toolkit.pdf`.
