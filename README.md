# Wastelander

A Foundry VTT module for **[Fallout: The Roleplaying Game](https://github.com/Muttley/foundryvtt-fallout)** (2d20). Character creation wizard, Wasteland Wanderer friendly NPC generator, GM Screen scavenging (locations, scene loot tables, journal), player search & AP loot rolls, optional caps/rarity filtering, combat dice, denizen import, and oracle roll-table import.

**Requires:** [Fallout 2d20 system](https://github.com/Muttley/foundryvtt-fallout) · Foundry VTT v13+

---

This community contributed and maintained module for playing Fallout: The Roleplaying Game with the Foundry VTT virtual tabletop software.

All copyright assets included in the module are owned by Modiphius Entertainment. The module developers hold no claims to these underlying copyrighted assets.

---

## Features

- **Guided character creation** — Step-by-step wizard (origin, S.P.E.C.I.A.L., skills, perks, equipment); PDF export/import with licensed Modiphius sheets
- **Friendly NPC generator (Overseer)** — Step-by-step **Wasteland Wanderer** NPC rolls; Core Rulebook Character stat blocks (Normal/Notable/Major), journal page, and actor — requires the licensed *Wasteland Wanderer* book (see **NPC generation**)
- **Combat dice roller** — Chat-bar CD roller with effect-face highlighting
- **Scavenging scene generation (Overseer)** — Location generator with inhabitants, obstacles, and hazards; per-scene loot RollTables under **Roll Tables → Wastelander → Scenes**; auto-updated Scavenger journal
  - **Loot filtering** — Optional caps or rarity limits by location level when tables are built or reset (default: no filter — “The New Vegas Option”)
  - **Scene loot tables** — Booklet tables materialized per scene (with filtering applied on build/reset); Overseers can edit rows, formulas, and items in Foundry for custom, scene-specific loot
- **Scavenging (players)** — Search team rolls, min/AP loot on scene tables, Luck Point shifts, server-validated actions
- **Denizen import** — Bring your own NPC actor JSON into the world for inhabitant rosters
- **Oracle tables** — Build/import Wasteland Wanderer roll tables from your licensed PDF (local tooling)
- **Bundled compendiums** — Custom scavenging items and roll tables included with the module

---

## Installation

1. Install the module in Foundry (manifest URL in `module.json`).
2. Enable **Wastelander** in your world’s module list.
3. *(Optional)* For PDF export, copy your licensed Modiphius character sheets into `Data/modules/wastelander/assets/sheets/` — see [assets/sheets/README.md](assets/sheets/README.md).
4. *(Optional)* Enable **[Simple Calendar Reborn](https://foundryvtt.com/packages/foundryvtt-simple-calendar-reborn)** if you want scavenging to advance the world clock.

### Development

```bash
npm install
npm run build      # production bundle → dist/wastelander.mjs
npm run dev        # watch mode
```

---

## Character builder

Open from any player **character** or **robot** actor sheet (Wastelander menu → **Build character**).

![Choose your origin — Survivor traits and tag-skill glossary](assets/readme/character-creation-origin.png)

*Step 1: pick an origin, survivor trait mode, and trait details with Pip-Boy tooltips.*

![S.P.E.C.I.A.L. allocation with perk peek-ahead by attribute](assets/readme/character-creation-special.png)

*Step 2: spend attribute points; the side panel lists unlocked perks and what higher stats would unlock.*

- **Step-by-step creation** — Origin, S.P.E.C.I.A.L., skills (including tag skills), perks, equipment, and review.
- **Core origins** — Survivor, Vault Dweller, Ghoul, Brotherhood of Steel, Super Mutant, and Mister Handy (robot sheet).
- **Rulebook-accurate options** — Starting equipment packs, tag-skill loot, personal trinkets, survivor traits, perk eligibility, and derived stats applied to the actor on finish.
- **Compendium integration** — Skills, perks, traits, and gear are pulled from Fallout system compendiums where possible.
- **Companion perks** — Stat block reference in the perk step for animal/robot companions from the rulebook.
- **Flexible navigation** — Jump to any step from the sidebar; **Next** still validates the current step, **Finish** requires all steps to be valid.
- **PDF export & import**
  - **Export to PDF** — Fills the official human or robot character sheet (requires your licensed PDF templates).
  - **Parse PDF** — Upload a filled human or robot sheet to overwrite matching data on the open actor.

---

## NPC generation (Overseer)

**Scene toolbar → Tokens → user-plus icon** (GM only). Rolls **Wasteland Wanderer** *Generate NPC* tables step by step, builds a Core Rulebook **Character** stat block (Normal / Notable / Major), creates an actor under **Actors → Wastelander → Generated NPCs**, adds a journal page, and opens the actor sheet.

This feature is driven by oracle roll tables from the licensed **Fallout 2d20 Wasteland Wanderer** book. Wastelander does not ship that book’s table text; you must own the PDF and run the local extract/build workflow before the generator can roll in Foundry.

### Prerequisites

1. Licensed **Wasteland Wanderer** PDF at  
   `docs/reference/source/Fallout-2d20-Wasteland-Wanderer.pdf`  
   (see **Oracle roll tables** below if you have not set this up yet).

2. Build the **generate-npc** oracle tables and bundle them into the module:

```bash
# 1. Extract manifests from the PDF (first time, or after profile changes)
npm run extract:oracle -- generate-npc

# 2. Build Foundry RollTable JSON → src/data/oracle/*.json
npm run build:oracle -- generate-npc

# 3. Bundle oracle JSON into dist/wastelander.mjs
npm run build
```

3. **Import into Foundry (GM):**  
   **Configure Settings → Module Settings → Wastelander → Import Wanderer oracle roll tables** → Run.

   Tables appear under **Roll Tables → Wastelander → Wanderer** (names, surnames, age, demeanor, distinctive features, profession, secret, truth, and related *Generate NPC* tables). Re-run import after rebuilding to update existing tables by name.

### Using the generator

- **Generate** — Auto-rolls every step (gender d20, Wanderer tables, NPC type) and lands on **Review**.
- **Sidebar** — Click any completed step to inspect, reroll, or pick manually from the table.
- **Gear** — Preview profession/demeanor starting gear; optionally add combat gear from imported **Denizens of the Wasteland** actors.
- **Review** — Override level and NPC type (Normal / Notable / Major) before **Finish**.
- **Finish** — Creates the actor, syncs the shared **Generated Friendly NPCs** journal, resets the wizard, and opens the new actor sheet.

Further detail (roll order, stat budgets, gear mappings, AI biography prompt): [docs/reference/friendly-npc-generator.md](docs/reference/friendly-npc-generator.md).

---

## Combat dice (chat)

A quick **Roll combat dice** control in the chat bar (Fallout effect-face icon) opens a small dialog for rolling any number of CD without typing `/r Ndc` macros.

- **Stepper input** — **−** / number / **+** (1–100 combat dice); the count field is focused when the dialog opens; **Enter** rolls immediately.
- **Optional label** — e.g. perk or ability name; defaults to “Combat dice” in chat.
- **Speaker** — Uses your single selected token’s actor, or your assigned character if no token is selected.
- **Chat card** — Each die face is shown with Fallout CD art; effect faces (5 and 6) are highlighted. Summary line: **Total N | X Effects** (damage-plaq styling).

Useful for perks and abilities that key off individual CD results (such as whether an effect was rolled), not just the numeric total.

---

## Scavenging

Two scene tools (token controls):

| Tool | Who | Purpose |
|------|-----|---------|
| **Scavenger Location** (warehouse) | GM | Generate and manage the location |
| **Scavenge** (magnifying glass) | Players | Search and loot the active scene’s location |

### Overseer — location generator

![Scavenger Location Generator — party, category, scale, degree, and problems](assets/readme/scavenger-location-create.png)

*Create tab: pick party members on scene, set category/scale/degree, and toggle obstacle, hazard, or inhabitants.*

![Generated location — inhabitants, roll-table checks, and loot min/max grid](assets/readme/scavenger-location-loot.png)

*After generation: inhabitant roster, GM Screen roll-table status, d20 “Other Found” results, and the loot table grid with min/max counts.*

- **Scene-specific locations** — Each scene stores its own scavenger location, party selection, and player progress.
- **Booklet-driven generation** — Category, scale, degree of search, problems (obstacle / hazard / inhabitants), and location level (party levels + degree + problem effects).
- **Time taken** — Search duration by scale (1 min → 2 hours); shown on the location and used for hazards and world-clock advancement.
- **Inhabitants** — Random counts and roster suggestions from the denizen catalog (import actors first — see **Denizen import**); drag onto the scene or override manually.
- **Obstacles** — Block the scavenge roll until overcome (mechanical / electronic / collapsed / trap types with skill hints).
- **Hazards** — Ongoing hazard damage tied to search time; Overseer can apply CD rolls to party members from the Current tab.
- **GM search override** — On the Current tab, mark player search as **succeeded** or **failed**, or **reset player search** to clear progress without regenerating the location.
- **Scene loot tables** — Each generated location gets real Foundry `RollTable` documents under **Roll Tables → Wastelander → Scenes → *scene name***. The **Loot tables** tab lists those tables with min/max roll counts per category, **Open** to edit the sheet, and **Reset loot tables** to rebuild from the booklet. Overseers control exactly what players can roll: add or remove rows, change formulas, swap items, or tailor tables to the fiction — player scavenge rolls draw on these scene tables (not a hidden in-memory copy).
- **Automated journal** — A shared Overseer journal page per scene updates with location details, problems, inhabitants, and player scavenge progress.

![Scavenger journal — location overview, inhabitants, and linked sub-pages](assets/readme/scavenger-location-journal.png)

*Per-scene journal: location stats, inhabitant links, and pages for hazards, obstacles, player scavenge, and loot results.*

### Players — scavenge automation

![Player scavenge window — primary searcher, assistants, and party AP](assets/readme/scavenge-player-search.png)

*Players assign primary vs assist roles, roll in order (assists first), and earn party AP from bonus successes.*

- **Search team** — One primary searcher (PER + Survival) plus optional assistants; assists roll first, then the primary.
- **Bonus party AP** — Extra successes above search difficulty become party AP (Fallout system AP tracker).
- **Obstacle gate** — Search is blocked until the Overseer marks the obstacle overcome.
- **AP loot rolls** — After a successful search, spend party AP to roll on category loot tables.
- **Luck Points** — Shift loot roll results up or down; luck spend posts to chat.
- **Full loot tables** — Ammunition, apparel, chems, food, oddities, weapons, and more; rolls use the scene’s Foundry RollTables when a location has been generated (falls back to bundled or world compendium tables when **Prefer Foundry RollTables** is enabled and no scene tables exist).
- **World clock** — On search completion, advances **Simple Calendar** by the location’s Time Taken (module setting; GM-only).

Player actions are validated on the GM client over Foundry’s socket so players cannot spoof rolls or loot.

### Loot filtering (optional)

Scavenging can **limit loot by item value or rarity** so lower-level locations are less likely to yield gear above what fits the ruin. **No filtering is the default** (“The New Vegas Option”); choose a filter mode in module settings when you want tighter tables.

- **How it works** — Each scavenger location has a **level** (from party levels, search degree, and problems). When scene loot tables are built or reset, Wastelander reads each row’s linked Fallout item **cost (caps)** or **rarity** (depending on mode) and **drops rows** that exceed the limit for that location level. Original booklet **roll ranges are preserved** on the rows that remain (no re-packing onto a denser 2d20 spread), so the table still behaves like the GM Screen layout — Foundry only draws on results that exist on the document.
- **Goal** — Reduce the chance that players find items far above what fits a low-level ruin, without hand-editing every table for every scene.
- **Filter modes** — **Do not filter loot (The New Vegas Option)** leaves compendium tables unchanged. **Limit loot by item value (caps)** uses a quadratic level → max caps curve (bundled defaults ship with the module). **Limit loot by item rarity** uses a linear level → max rarity curve (0–6 scale; default 0.4 rarity per level).
- **Configuration** — **Configure Settings → Module Settings → Wastelander → Loot filter mode** selects the active mode. **Configure loot value caps** and **Configure loot rarity** open the band editors for each mode. After changing the filter or regenerating a location at a new level, use **Reset loot tables** on the Loot tables tab so scene tables are rebuilt with the updated filter.

---

## Denizen import

Wastelander does **not** redistribute rulebook NPC actors. It provides an import workflow so you can bring your own Foundry actor exports into the world.

### Provide actor JSON

Export actors from your Fallout world (or build them yourself), then add the JSON files before building the module:

1. Place Foundry actor exports in `src/data/denizens/` (gitignored — not committed to the repo).
2. Rebuild the catalog and module bundle:

```bash
npm run build:denizens   # writes src/data/scavenging/denizens-catalog.json
npm run build
```

3. Reload the module in Foundry. The import menu shows how many JSON files were bundled in that build.

If no JSON is present at build time, import is unavailable until you add exports and rebuild.

### Import to world

**Configure Settings → Module Settings → Wastelander → Import denizens** (or **Import denizens…** on the Actors sidebar)

- **GM only** — creates actors in the sidebar (does not auto-place tokens).
- **Idempotent** — skips any name that already exists in the world.
- **Your stat blocks** — imports whatever skills, gear, and abilities are in your exports.
- **Robot-aware** — robot exports are normalized (body type, favorited weapons, post-import repair pass).

After import, reload Foundry if new actors do not appear in the sidebar immediately.

### Rulebook folder layout

Imported actors are filed under **Denizens of the Wasteland**, matching the Core Rulebook organization (Animals and Insects, Raiders, Robots, Super Mutants, Synths, Turrets, Brotherhood of Steel, Wastelanders, and Mutated Humanoids).

### Tied to scavenging

The denizen **catalog** (slim metadata in `denizens-catalog.json`, built from your exports) feeds the **Scavenger Location** generator:

- **Inhabitant catalog** — level, type, and size metadata for roster matching.
- **Random inhabitant counts** — rolled when you generate a location (by scale and inhabitant type).
- **Roster suggestions** — denizens near the location level appear on the Current tab; click to open the imported actor or **drag onto the scene** to place tokens.

Run import once per world after bundling your JSON, then scavenging inhabitant workflows can link roster entries to world actors.

---

## Oracle roll tables (Wasteland Wanderer)

Wastelander can build Foundry `RollTable` JSON for appendix oracle tables from the licensed **Wasteland Wanderer** PDF. Manifests and generated output stay on your machine (gitignored); the repo ships the extraction and build tooling only.

### Provide the PDF

Place your licensed PDF at this path with this **exact filename**:

```text
docs/reference/source/Fallout-2d20-Wasteland-Wanderer.pdf
```

The `docs/reference/source/` folder is gitignored. If your copy has a different name, rename it to match, or pass an alternate path as the last argument to the extract script (see [docs/reference/oracle-rolltables.md](docs/reference/oracle-rolltables.md)).

To change the default path in code, update `DEFAULT_PDF` in:

- `scripts/extract-oracle-manifests.mjs`
- `scripts/build-oracle-rolltables.mjs`

### Workflow

```bash
# 1. Draft manifests from the PDF (compare before write)
npm run extract:oracle

# 2. Review manifests — existing tables are not overwritten
#    New tables     → scripts/oracle/manifests/<slug>.json
#    Unchanged      → skipped
#    Different      → scripts/oracle/manifests-staging/<slug>.json
#                     + scripts/oracle/manifests-staging/staging-diff.md

# 3. Build Foundry import JSON
npm run build:oracle
```

### Import to world

**Configure Settings → Module Settings → Wastelander → Import oracle tables**

- **GM only** — creates or updates roll tables in the Roll Tables sidebar.
- **Folder** — tables go under **Wastelander → Wanderer** (folder is created if missing).
- **Overwrite** — matching table names are updated in place; no duplicate folders or tables.

Oracle JSON must be bundled first: run `npm run build:oracle`, then `npm run build`, and reload the module. The import menu shows how many JSON files were included in that build.

`npm run extract:oracle` parses every appendix table profile, compares each result set against any existing manifest, then writes or skips accordingly. It never overwrites a manifest that already exists — differences go to `manifests-staging/` with a combined diff report.

Useful variants:

```bash
npm run extract:oracle:list          # list extractable table slugs
npm run build:oracle:list            # list manifest slugs and section groups
npm run extract:oracle -- --table clear-blocker-table
npm run build:oracle -- clear-blocker-table
```

Full command reference, layout profiles, and known extraction quirks: [docs/reference/oracle-rolltables.md](docs/reference/oracle-rolltables.md).

---

## Bundled compendiums

The module includes a **Wastelander** compendium folder with two packs:

| Pack | Contents |
|------|----------|
| **Items** | Custom items (consumables, gear, etc.) used when scavenging resolves loot to compendium entries |
| **Wastelander** | RollTable loot tables for scavenging (booklet-style names such as ammunition, food, armor) |

They appear automatically when the module is enabled. When you **generate** a scavenger location, Wastelander copies the relevant booklet tables from `wastelander.wastelander` into that scene’s folder (see **Scene loot tables** above). Player rolls prefer those scene documents; compendium and Fallout system tables remain the source of truth for initial builds and fallbacks.

To refresh pack data from your Foundry world after editing compendiums, see [packs/README.md](packs/README.md).

---

## Optional integrations

| Module / feature | Used for |
|------------------|----------|
| [foundryvtt-fallout](https://github.com/Muttley/foundryvtt-fallout) | **Required** — actors, compendiums, AP tracker, sheets |
| Simple Calendar Reborn | Advance world time after scavenging |
| Licensed Modiphius PDFs | Character sheet export; **Wasteland Wanderer** oracle extraction and NPC generator (local build) |
| Bundled `wastelander.items` / `wastelander.wastelander` | Custom scavenging items and roll tables (included with module) |

---

## Module settings (scavenging)

- **Prefer Foundry RollTables** — When no scene loot tables exist, player AP loot rolls use world Roll Tables when names match the GM Screen booklet (falls back to bundled tables).
- **Loot filter mode** — **The New Vegas Option** (default) leaves tables unchanged; **value** or **rarity** filters scene loot tables by item caps or rarity vs. location level (see **Loot filtering**).
- **Configure loot value caps** — Menu (GM only) to edit location level → max item caps bands used when value filtering is selected.
- **Configure loot rarity** — Menu (GM only) to edit location level → max item rarity bands used when rarity filtering is selected.
- **Whisper loot rolls to GM** — Loot roll chat cards visible only to the GM.
- **Advance world clock after search** — Simple Calendar integration (default on).
- **Auto-allocate degree reductions** — Randomly apply minimum reductions when generating a location.

---

## License

See [LICENSE](LICENSE). Fallout RPG rules content and official PDF character sheets are © Modiphius Entertainment; this module does not redistribute them. Denizen actor JSON is supplied by the module user at build time; the module does not ship rulebook NPC stat blocks.
