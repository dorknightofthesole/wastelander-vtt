# Wastelander

A Foundry VTT module for **[Fallout: The Roleplaying Game](https://github.com/Muttley/foundryvtt-fallout)** (2d20). Wastelander adds a guided character builder, a full scavenging toolkit, and a bundled denizen library — all aligned with the Core Rulebook and GM Screen booklet.

**Requires:** [Fallout 2d20 system](https://github.com/Muttley/foundryvtt-fallout) · Foundry VTT v13+

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

## Scavenging

Two scene tools (token controls):

| Tool | Who | Purpose |
|------|-----|---------|
| **Scavenger Location** (warehouse) | GM | Generate and manage the location |
| **Scavenge** (magnifying glass) | Players | Search and loot the active scene’s location |

### Overseer — location generator

- **Scene-specific locations** — Each scene stores its own scavenger location, party selection, and player progress.
- **Booklet-driven generation** — Category, scale, degree of search, problems (obstacle / hazard / inhabitants), and location level (party levels + degree + problem effects).
- **Time taken** — Search duration by scale (1 min → 2 hours); shown on the location and used for hazards and world-clock advancement.
- **Inhabitants** — Random counts and roster suggestions from the bundled denizen catalog (import actors first — see **Denizen library**); drag onto the scene or override manually.
- **Obstacles** — Block the scavenge roll until overcome (mechanical / electronic / collapsed / trap types with skill hints).
- **Hazards** — Ongoing hazard damage tied to search time; Overseer can apply CD rolls to party members from the Current tab.
- **Simulate search** — GM can test loot draws against Foundry RollTables (GM Screen booklet names).
- **Automated journal** — A shared Overseer journal page per scene updates with location details, problems, inhabitants, and player scavenge progress.

### Players — scavenge automation

- **Search team** — One primary searcher (PER + Survival) plus optional assistants; assists roll first, then the primary.
- **Bonus party AP** — Extra successes above search difficulty become party AP (Fallout system AP tracker).
- **Obstacle gate** — Search is blocked until the Overseer marks the obstacle overcome.
- **AP loot rolls** — After a successful search, spend party AP to roll on category loot tables.
- **Luck Points** — Shift loot roll results up or down; luck spend posts to chat.
- **Full loot tables** — Ammunition, apparel, chems, food, oddities, weapons, and more; works with **Fallout Scavenging** actors and world RollTables when enabled.
- **World clock** — On search completion, advances **Simple Calendar** by the location’s Time Taken (module setting; GM-only).

Player actions are validated on the GM client over Foundry’s socket so players cannot spoof rolls or loot.

---

## Denizen library

Wastelander ships **60+ ready-to-run NPC actors** from the rulebook (Deathclaw, Raider, Assaultron, Super Mutant Brute, Eyebot, and many more). One import populates your world’s Actors sidebar with combat-ready denizens — and powers inhabitant suggestions when you generate scavenger locations.

### Import to world

**Configure Settings → Module Settings → Wastelander → Import denizens**

- **GM only** — creates actors in the sidebar (does not auto-place tokens).
- **Idempotent** — skips any name that already exists in the world.
- **Full stat blocks** — skills, gear, special abilities, and robot modules are embedded on each actor.
- **Robot-aware** — robot exports are normalized (body type, favorited weapons, post-import repair pass).

After import, reload Foundry if new actors do not appear in the sidebar immediately.

### Rulebook folder layout

Actors are filed under **Denizens of the Wasteland**, matching the Core Rulebook organization:

| Folder | Examples |
|--------|----------|
| Animals and Insects | Deathclaw, Mirelurk, Radscorpion, Yao Guai |
| Mutated Humanoids | Feral Ghoul, Glowing One |
| Robots | Assaultron, Eyebot, Mister Handy, Sentry Bot |
| Super Mutants | Super Mutant, Brute, Behemoth |
| Synths | Synth, Courser, Strider |
| Turrets | Laser Turret, Machine Gun Turret |
| Brotherhood of Steel | Knight, Paladin, Scribe |
| Raiders | Raider, Veteran, Boss |
| Wastelanders | Vault Dweller, Mercenary, Institute Scientist |

### Tied to scavenging

The same denizen data feeds the **Scavenger Location** generator:

- **Inhabitant catalog** — level, type, and size metadata for roster matching.
- **Random inhabitant counts** — rolled when you generate a location (by scale and inhabitant type).
- **Roster suggestions** — denizens near the location level appear on the Current tab; click to open the actor or **drag onto the scene** to place tokens.

Run import once per world (or after adding new bundled denizens in a module update), then scavenging inhabitant workflows work out of the box.

---

## Bundled compendiums

The module includes a **Wastelander** compendium folder with two packs:

| Pack | Contents |
|------|----------|
| **Items** | Custom items (consumables, gear, etc.) used when scavenging resolves loot to compendium entries |
| **Wastelander** | RollTable loot tables for scavenging (booklet-style names such as ammunition, food, armor) |

They appear automatically when the module is enabled. Scavenging looks up roll tables in `wastelander.wastelander` first, then Fallout system tables.

To refresh pack data from your Foundry world after editing compendiums, see [packs/README.md](packs/README.md).

### Development

Denizen JSON lives in `src/data/denizens/`. Rebuild the scavenging catalog after adding or editing exports:

```bash
npm run build:denizens
npm run build
```

---

## Optional integrations

| Module / feature | Used for |
|------------------|----------|
| [foundryvtt-fallout](https://github.com/Muttley/foundryvtt-fallout) | **Required** — actors, compendiums, AP tracker, sheets |
| Simple Calendar Reborn | Advance world time after scavenging |
| Licensed Modiphius PDFs | Character sheet export only |
| Bundled `wastelander.items` / `wastelander.wastelander` | Custom scavenging items and roll tables (included with module) |

---

## Module settings (scavenging)

- **Prefer Foundry RollTables** — Draw simulate-search / loot from world tables when names match the booklet.
- **Whisper simulate-search loot to GM** — Loot preview rolls visible only to the GM.
- **Advance world clock after search** — Simple Calendar integration (default on).
- **Auto-allocate degree reductions** — Randomly apply minimum reductions when generating a location.

---

## License

See [LICENSE](LICENSE). Fallout RPG rules content and official PDF character sheets are © Modiphius Entertainment; this module does not redistribute them. Bundled denizen data is derived from exports compatible with the Fallout system.
