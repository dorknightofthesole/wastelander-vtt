# Friendly NPC generator

GM-only tool for rolling **Wasteland Wanderer** friendly NPC tables and creating Fallout **Character** NPCs (Core Rulebook p.337 CHARACTERS).

## Prerequisites

1. Licensed **Fallout 2d20 Wasteland Wanderer** PDF at  
   `docs/reference/source/Fallout-2d20-Wasteland-Wanderer.pdf`.

2. **Build name/surname + generate-npc oracle tables** (local only — book text is gitignored):

   ```bash
   # Extract manifests from the PDF (first time, or after profile changes)
   npm run extract:oracle -- generate-npc

   # Build Foundry RollTable JSON → src/data/oracle/*.json
   npm run build:oracle -- generate-npc

   # Bundle oracle JSON into dist/wastelander.mjs
   npm run build
   ```

3. **Import into Foundry (GM):**  
   **Settings → Wastelander → Import Wanderer oracle roll tables** → Run.

   Tables appear under **Roll Tables → Wastelander → Wanderer**. Re-run import after rebuilding to **update** existing tables by name.

### Name & surname tables (Wasteland Wanderer p.178, p.180)

The book lists comma-separated names (not a d20/d100 grid). Extraction turns each name into one row; formulas are `1dN` where N = name count.

| Printed page | Oracle slug | Foundry table title | Formula | Rows (typical) |
|--------------|-------------|---------------------|---------|----------------|
| **178** | `npc-names-masculine` | NPC Names (Masculine) | `1d180` | ~180 |
| **178** | `npc-names-feminine` | NPC Names (Feminine) | `1d179` | ~179 |
| **180** | `npc-surnames` | NPC Surnames | `1d186` | ~186 |

Layout profiles: [`scripts/oracle/layouts/profiles.mjs`](../../scripts/oracle/layouts/profiles.mjs) (`npcNameList`, `npcSurnameList` parsers).

**Verify before Foundry:**

```bash
npm run build:oracle:list | rg npc-names
ls src/data/oracle/npc-names-*.json src/data/oracle/npc-surnames.json
```

In the import menu, bundled count should include all `generate-npc` tables (10 total). If it shows **no bundled files**, run `npm run build:oracle -- generate-npc` then `npm run build` and reload the module.

Other **generate-npc** tables (same import batch):

- NPC Age, Demeanor (Odds/Evens), Distinctive Features, Profession, Secret, Truth

## Opening the generator

**Scene toolbar → Tokens → user-plus icon** (GM only). Opens the step-by-step generator; no actor is required until **Finish**.

## Roll order

1. Gender — d20 odd = masculine, even = feminine (presentation for name table)
2. Given name — table by gender (`1dN`)
3. Surname — `1dN`
4. Age — `1d20` bands
5. Demeanor — d20 parity → Odds or Evens table
6. Distinctive features — roll twice
7. Profession, Secret, Truth — Wanderer tables
8. NPC type — d20 bands (default friendly skew: 1–14 Normal, 15–18 Notable, 19–20 Major)

**Review** — override **Level** and **NPC type** before Finish.

## Stat block (p.337)

| Type | SPECIAL budget | Tag skills | Luck points | HP |
|------|----------------|------------|-------------|-----|
| Normal | 35 + ⌈L/2⌉ | 2 @ 2 | — | END + L |
| Notable | 42 + ⌈L/2⌉ | 3 @ 2 | ⌈LCK/2⌉ | END + L + LCK |
| Major | 49 + ⌈L/2⌉ | 4 @ 2 | LCK | END + L + 2×LCK |

SPECIAL and skills come from [`src/data/npcGen/npc-trait-mappings.json`](../../src/data/npcGen/npc-trait-mappings.json). Starting gear defaults live in [`src/data/npcGen/npc-gear-mappings.json`](../../src/data/npcGen/npc-gear-mappings.json); GMs can override profession and demeanor gear under **Configure Settings → Wastelander → Configure NPC gear mappings**. Age → level mapping: [`age-to-level.json`](../../src/data/npcGen/age-to-level.json).

## Output

- **Actor** in **Actors → Wastelander → Generated NPCs**
- **Journal** — world journal *Generated Friendly NPCs*, one page per NPC (linked to actor)
- `flags.wastelander.npcGen` — full roll + built stats payload

## Future: perks

Post-v1: filter perk roll table by SPECIAL + level eligibility, draw or pick one, grant via compendium embed (same pattern as character wizard).
