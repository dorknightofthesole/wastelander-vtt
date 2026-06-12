# Oracle roll tables (Wasteland Wanderer)

Build Foundry `RollTable` JSON from manifests in `scripts/oracle/manifests/`. Output goes to `src/data/oracle/`.

**Git:** Manifests and generated oracle JSON are **gitignored** (licensed book text). The repo ships the build tooling only. Keep manifests and output on your machine; see `scripts/oracle/manifests/example-table.json.example` for the manifest shape.

`npm run build:oracle` (no flags) builds **every manifest file** in that folder. Run `npm run build:oracle:list` to see manifests and section groups.

Requires the licensed PDF at `docs/reference/source/Fallout-2d20-Wasteland-Wanderer.pdf` (gitignored).

## Workflow (extract → review → build)

```bash
# 1. Draft manifests from your local PDF (gitignored output)
npm run extract:oracle

# 2. Review scripts/oracle/manifests/*.json (new tables only)
#    Differences vs existing manifests → scripts/oracle/manifests-staging/
#    and scripts/oracle/manifests-staging/staging-diff.md

# 3. Build Foundry import JSON
npm run build:oracle
```

Extraction **does not overwrite** existing manifests. New tables are written to `manifests/`; unchanged tables are skipped; tables that differ are written to `manifests-staging/` with a combined diff report in `staging-diff.md`.

Extraction uses position-aware PDF parsing (`pdfjs-dist`) and layout profiles in [`scripts/oracle/layouts/profiles.mjs`](scripts/oracle/layouts/profiles.mjs) (committed metadata only — no book text). Drafts are imperfect on multi-column tables; expect a review pass. The extractor prints **warnings** (missing roll values, low row counts, footer bleed) to guide fixes.

### Known hard tables (typical manual fixes)

| Area | Issue | Fix |
|------|-------|-----|
| Encounters (`twoColumnD20`) | Prompt text split across columns | Merge `description` fragments; check `xBands` via `--dump-pages` |
| Paired d20 (`twoColumnPairedD20`) | Same row shows e.g. `1 Trader \| 6 Scout`; may continue on next printed page | Use `pairedPageRanges` y-bands per printed page; see `npc-profession` profile |
| Loot (`threeColumnSum`) | Wrapped weapon names | Join name lines; verify result numbers 2–40 |
| Goal sub-tables | Page drift near appendix end | Tune `printedPage` in profile |
| `reputation-table`, `injury-table` | Region bleed from adjacent tables | Tighten `exactStart`, `printedPageEnd`, or `xBands` |
| `side-quest-generate-reward` | Long prose rows | Hand-edit ranges and descriptions |

### Extract commands

```bash
npm run extract:oracle                              # all tables
npm run extract:oracle -- --table clear-blocker-table
npm run extract:oracle:list                         # list profiles
npm run extract:oracle:dump -- 162                  # debug positioned text on PDF page
npm run extract:oracle -- --diff clear-blocker-table  # compare only (no writes)
```

## Why manifests and a build step?

PDF parsing was never the only reason for two stages. The split is **authoring format** vs **Foundry export format**:

| Manifest | Generated oracle JSON |
|----------|----------------------|
| Plain `range`, `name`, `description` | Full Foundry `RollTable` document |
| No `_id`, `_stats`, or HTML | Per-result `_id`, `_stats`, HTML descriptions |
| `nameEqualsDescription` flag | Emitter leaves `description` empty when it matches `name` |
| Optional `rollMin` / `rollMax` | Derived `formula` (`1d20`, `2d40`, `1d100`, …) |

You *can* skip manifests and edit `src/data/oracle/*.json` directly (or export/import from Foundry), but you then maintain Foundry boilerplate, formulas, and HTML by hand. Manifests are optional convenience for **editing table content**; the build step is **code generation** into importable Foundry JSON.

If you only ever tweak one table once, editing the oracle JSON directly is fine. If you maintain many tables or rebuild often, manifests stay smaller and easier to work with.

## npm commands

npm scripts need **`run`** and **`--`** before arguments passed to the script:

```bash
# All manifests
npm run build:oracle

# List available table manifests
npm run build:oracle:list

# One table (slug or title)
npm run build:oracle -- clear-blocker-table
npm run build:oracle -- --table "Clear Blocker Table"

# Whole appendix section (multiple tables)
npm run build:oracle -- --table "Location Generation Tables"
```

**Wrong** (npm treats `--table` as its own config):

```bash
npm build:oracle --table "Clear Blocker Table"   # invalid
```

## Env shortcut (no `--`)

```bash
ORACLE_TABLE="clear-blocker-table" npm run build:oracle
ORACLE_TABLES="clear-blocker-table,other-table" npm run build:oracle
```

## Direct node

```bash
node scripts/build-oracle-rolltables.mjs --list
node scripts/build-oracle-rolltables.mjs --table clear-blocker-table
node scripts/build-oracle-rolltables.mjs --help
```

## Adding a table

**From PDF (recommended for new tables):**

1. Add or tune a layout profile in `scripts/oracle/layouts/profiles.mjs`.
2. `npm run extract:oracle -- --table <slug>` then review the draft manifest.
3. `npm run build:oracle -- <slug>` and import `src/data/oracle/<slug>.json`.

**By hand:**

1. Add `scripts/oracle/manifests/<slug>.json` (see `example-table.json.example`).
2. Run `npm run build:oracle -- <slug>` or build all with `npm run build:oracle`.
3. Import `src/data/oracle/<slug>.json` into Foundry.

Re-running the builder **overwrites** the same output path. When a file already exists, the script reuses it as the base document and keeps matching result `_id` values (by range/name) so re-importing updates the table instead of creating a duplicate.

Appendix sections like **Location Generation Tables** contain multiple roll tables. Each table has its own manifest; section aliases live in `scripts/oracle/groups.json` so `--table "Location Generation Tables"` builds every table in that group that already has a manifest (missing ones are skipped with a warning).

Registered section groups:

| Group key | Tables |
|-----------|--------|
| `clear-blocker-table` | Clear Blocker |
| `location-generation-tables` | Inhabitants, Location Icon, Wasteland Truth, Settlement Truth |
| `encounter-generation-tables` | Settlement Encounter, Wasteland Encounter, Combat States, Quantity |
| `equipment-tables` | Conditions, Armor Mods, Weapon Mods |
| `loot-tables` | Loot Generation, Armor, Caps, Supplies, Chems, Ranged/Melee/Thrown/Oddities/Scrap |
| `generate-npc` | Names (Masculine/Feminine), Surnames, Age, Demeanor (Odds/Evens), Distinctive Features, Profession, Secret, Truth |

### Name & surname tables (`generate-npc`)

**Source:** Wasteland Wanderer **printed p.178** (NPC NAME — two columns) and **p.180** (Surnames).

These are comma-separated name lists, not d20 grids. Profiles `npc-names-masculine`, `npc-names-feminine`, and `npc-surnames` use layouts `npcNameList` / `npcSurnameList` in `profiles.mjs`. Built formulas use the smallest standard dice that covers the row count (e.g. `2d100` for 180 masculine names); roll ranges are offset when the formula minimum is above 1.

```bash
npm run extract:oracle -- --table npc-names-masculine
npm run extract:oracle -- --table npc-names-feminine
npm run extract:oracle -- --table npc-surnames
npm run build:oracle -- generate-npc
npm run build
```

Then import via **Settings → Wastelander → Import Wanderer oracle roll tables** (same as all oracle tables). See also [`friendly-npc-generator.md`](friendly-npc-generator.md).

| `dangerous-npc` | Threat, Special Ability, Weapons, Group |
| `generate-foe` | Foe Type + 8 foe generators |
| `generate-side-quest` | Generate Reward, Goal Type, 18 goal sub-tables |
| `miscellaneous-tables` | Random Faction, Injury, Miraculous Escape, Reputation |
