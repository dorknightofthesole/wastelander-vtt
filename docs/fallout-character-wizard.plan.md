---
name: wastelander
overview: Wastelander — a Foundry v13 module suite for Fallout 2d20 (foundryvtt-fallout). MVP is a player character creation wizard; future GM/player toolkit features can live under the same brand.
todos:
  - id: extract-core-data
    content: Build origins/equipment JSON with compendium UUIDs; generate compendium-manifest from Fallout packs
    status: pending
  - id: scaffold-module
    content: Scaffold v13 module with fallout dependency, Vite build, sheet hook
    status: completed
  - id: wizard-shell
    content: Multi-step ApplicationV2 wizard with back/next, clickable stepper, draft WizardState, review/apply
    status: completed
  - id: step-origin-ui
    content: Origin step UI: clickable cards, detail panel, mock-inspired styling; Phase 2 origins visible but disabled
    status: completed
  - id: steps-origin-special
    content: Implement Origin + S.P.E.C.I.A.L. (5-point buy from base 5, min 4 max 10, origin caps)
    status: pending
  - id: steps-skills-perks
    content: Implement tag skills (3 + origin extras), skill ranks (9+INT pts), first perk from compendium
    status: pending
  - id: steps-traits-gear
    content: Survivor trait choice, origin traits, equipment packs, tag-skill items, trinket
    status: pending
  - id: apply-to-actor
    content: "Transactional apply: actor.update + createEmbeddedDocuments; creationComplete flag"
    status: pending
isProject: false
---

# Wastelander (Fallout 2d20 module)

## Naming (recommended)
| Use | Value | Notes |
| --- | --- | --- |
| **Brand / title** | **Wastelander** | Fits player creation *and* future GM tools; not tied to survival mechanics |
| **Module id** | `wastelander` | Stable Foundry package id (`flags.wastelander.*`) |
| **Repo** | [dorknightofthesole/wastelander-vtt](https://github.com/dorknightofthesole/wastelander-vtt) | Update `git remote` if still pointing at old URL |
| **Subtitle** | “Fallout 2d20 Toolkit” or “for Fallout: The Roleplaying Game” | Helps Foundry package search; clarify system dependency in `module.json` |

**Avoid keeping “Wasteland Survival”** as the primary name — it implies hunger/thirst tracking (already in the Fallout system) and doesn’t describe character creation.

**MVP scope stays one feature** (character wizard); additional tools ship as new subsystems under the same module (e.g. settings tabs, separate apps) unless a feature grows large enough to split.

## Verified gap
[foundryvtt-fallout](https://github.com/Muttley/foundryvtt-fallout) has **no character creation wizard**. Creation today is manual:
- `system.origin` / `system.trait` strings on the actor ([`template.json`](https://github.com/Muttley/foundryvtt-fallout/blob/develop/system/template.json))
- Embedded **items** for skills, perks, traits (`type: "trait"`, etc.)
- **Traits compendium** exists (`packs/traits`); **no origins compendium** in `system.json` (origin item templates exist in repo but origins are not shipped as a pack)
- **`FalloutLevelUp`** is for leveling an existing PC only
- S.P.E.C.I.A.L. edited on sheet (`special-editor.hbs`); creation uses **5-point buy** (all stats start at 5), not a 40-point pool

## Goals (MVP)
- **Player-run** wizard launched from owned Character actor (button on sheet or Actor directory)
- **Core rulebook only**: origins, origin traits, optional player traits, S.P.E.C.I.A.L., tag skill, starting equipment
- **Sheet as output**: all results applied via `actor.update()` + `actor.createEmbeddedDocuments("Item", …)` — no parallel module state on the actor
- **Reuse system where possible**: traits/skills/gear from Fallout compendiums; mirror [`CompendiumItemSelector`](https://github.com/Muttley/foundryvtt-fallout/tree/develop/system/src/apps/CompendiumItemSelectors) patterns if API allows

## Wizard flow (matches Core Rulebook Ch. 3)

```mermaid
flowchart LR
  s1[1_Origin] --> s2[2_SPECIAL]
  s2 --> s3[3_Skills]
  s3 --> s4[4_Perk]
  s4 --> s5[5_Derived]
  s5 --> s6[6_Equipment]
  s6 --> review[Review_apply]
```

### Step 1 — Choose origin
| Origin | Origin trait / rules | Wizard notes |
| --- | --- | --- |
| **Brotherhood Initiate** | *The Chain that Binds* — +1 extra **tag** (Energy Weapons, Science, or Repair only) | Set `system.origin`; embed trait item; 4 tag skills total |
| **Ghoul** | *Necrotic Post-Human* — Survival is a tag skill (+2 ranks) | May use Wastelander equipment packs |
| **Super Mutant** | *Forced Evolution* — STR/END +2 (max 12); INT/CHA max 6; skills max rank **4**; immune rad/poison | Different body/rules; **phase 2** or simplified MVP |
| **Mister Handy** | *Mister Handy Robot* — robot sheet, arm attachments, no food/rest | Actor type `robot`; **phase 2** |
| **Survivor** | Pick **2 traits** from list **OR** **1 trait + 1 extra perk** | Traits: Educated, Fast Shot, Gifted, Heavy Handed, Small Frame |
| **Vault Dweller** | *Vault Kid* — +1 extra tag skill; END vs disease | Optional GM-approved Ghoul variant → Necrotic Post-Human instead |

### Step 2 — S.P.E.C.I.A.L.
- All attributes start at **5** (unless origin changes this).
- Spend **5 points** to increase stats (+1 each); may **lower one stat to 4** to gain **1** point back.
- Min **4**, max **10** (origin may change per-stat max, e.g. Super Mutant INT/CHA 6, STR/END 12).
- Optional UI: preset arrays (Balanced / Focused / Specialized) then apply origin modifiers.
- Apply to `system.attributes.{str,per,end,cha,int,agi,luc}.value` (and `.current` if required by system).

### Step 3 — Tag skills and skill ranks
- Choose **3 tag skills** (+ origin extras from step 1).
- Each tag skill starts at **rank 2**; all other skills at **0**.
- Spend **9 + INT** skill points (1 point = +1 rank); **max rank 3** at level 1 creation.
- Embed/update skill items from `packs/skills` compendium with correct ranks.

### Step 4 — First perk
- Choose **1 perk** from perks compendium (`packs/perks`) that meets level 1 requirements.
- Survivor option: **1 trait + 1 perk** counts as using the “extra perk” instead of a second trait.
- Embed perk item on actor.

### Derived statistics (review only)
No dedicated wizard step. Computed from S.P.E.C.I.A.L. + traits and shown on **Review**:
- **HP** = END + LCK
- **Carry weight** = 150 + (STR × 10) — Small Frame: 150 + (5 × STR); Mister Handy: 150 fixed
- **Initiative** = PER + AGI
- **Defense** = 1 if AGI ≤ 8, else 2
- **Melee bonus** = +1/+2/+3 CD for STR 7–8 / 9–10 / 11+

### Step 5 — Equipment
- Pick **origin equipment pack** (Brotherhood / Mister Handy / Super Mutant / Vault / Wastelander lists in rulebook).
- Gain **tag skill items** per tagged skill (table p.81 — e.g. Lockpick → bobby pins, Barter → 2d20 caps).
- Roll or choose **personal trinket** if pack includes one (d20 table).
- Resolve ammo “10 +5 DC” etc. at apply time (roll or average — setting).
- Create items from Fallout compendiums by name/UUID lookup.

### Review and apply
- Summary of all choices → **Finish** → single `actor.update` + `createEmbeddedDocuments` batch.
- Set `flags.wastelander.creationComplete` (and store wizard version for re-runs).

## Compendium-first items (no Wastelander compendiums)

**Rule:** Use Fallout’s existing compendiums as the **only** item source. Wastelander does **not** ship its own item compendiums or duplicate item stat blocks.

**On the actor sheet:** Copying is correct and expected. At Finish, we **embed copies** of compendium items on the actor (normal Foundry flow: compendium → `toObject()` → `createEmbeddedDocuments(\"Item\", …)`). Players get real items on their sheet that behave like drag-and-drop from the Fallout packs.

**What we maintain:** Wizard config JSON (UUID refs, quantities, rules) — **not** parallel Item compendiums.

### How linking works at apply time
1. Module data stores **references only**: `compendiumUuid` (preferred) or `{ pack, id }` + optional `quantity` / ammo formula.
2. Resolve: `await fromUuid(uuid)` (or open pack + getDocument(id)).
3. Add to actor: `item.toObject()` → `actor.createEmbeddedDocuments(\"Item\", [data], { keepId: false })` so the sheet gets a normal embedded copy with correct `system` schema.
4. For skills: set rank on the embedded copy’s `system` fields after creation (tag = 2, bought ranks, etc.).
5. Store provenance on the actor if useful: `flags.wastelander.sourceUuid` on created items (optional, for debugging/re-run).

### Fallout compendiums to use (from `system.json`)
| Pack | Use for |
| --- | --- |
| `traits` | Origin traits, Survivor traits |
| `perks` | First perk (+ Survivor extra perk) |
| `skills` | Tag skills + ranks |
| `weapons` | Starting weapons |
| `apparel` | Armor, clothing, vault suit, etc. |
| `consumables` | Stimpaks, food, chems |
| `ammo` | Ammunition / fusion cells |
| `miscellany` | Holotags, Pip-Boy, trinkets, tools |

### UI: pick from compendium, don’t invent
- **Perk / trait steps:** browse/filter compendium entries (reuse patterns from Fallout [`CompendiumItemSelector`](https://github.com/Muttley/foundryvtt-fallout/tree/develop/system/src/apps/CompendiumItemSelectors) where possible).
- **Skills:** dropdown of compendium skills by name; enforce tag count and rank limits in wizard logic.
- **Equipment packs:** `equipment-packs.json` is a list of **compendium refs**, not item stat blocks.
- **Tag-skill loot / trinkets:** each row maps to a compendium item (or caps-only entries with no item).

### Lookup and fallbacks
- **Primary:** UUID baked into module data at build time (script scans Fallout compendium JSON in `data/packs/*.db` for stable ids).
- **Fallback:** `CompendiumIndex` search by exact item name if UUID missing (homebrew worlds, pack renames).
- **Missing item:** show warning on Review step; block Finish or allow skip (module setting).

## Module-owned data files
Ship JSON derived from the char-creation PDF (see `docs/reference/rulebook-sources.md` for local path):

| File | Contents |
| --- | --- |
| `data/perk-companion-statblocks.json` | Companion stat blocks beside perks in the rulebook (e.g. Dogmeat on p. 63) |
| `data/origins-core.json` | Per origin: trait **compendiumUuid**, extra tag rules, SPECIAL overrides, equipment pack id |
| `data/survivor-traits.json` | Five Survivor traits → **compendiumUuid** + mechanical hooks (SPECIAL deltas only where not on item) |
| `data/equipment-packs.json` | Pack id → array of `{ compendiumUuid, quantity?, ammoRoll? }` |
| `data/tag-skill-loot.json` | Tag skill → compendium refs or `{ type: \"caps\", formula: \"2d20\" }` |
| `data/trinkets-d20.json` | d20 → compendiumUuid or miscellany name (for worlds with trinket items) |
| `data/compendium-manifest.json` | *(generated)* UUID index for core book items used by wizard — rebuild when Fallout system updates |

## Integration strategy
1. **Prefer system APIs**: `actor.update`, `createEmbeddedDocuments`, compendium resolution via `fromUuid`; reuse Fallout `ItemSelector` / compendium browse if exportable.
2. **Compendium-first items**: never duplicate Item data in module; all gear/traits/perks/skills link to Fallout packs (see above).
3. **SPECIAL validation**: enforce 5-point buy from base 5, dump-to-4 option, origin min/max; show points remaining.
4. **Traits with mechanical text** (e.g. Gifted): embed compendium trait item; apply attribute deltas in wizard only if not handled by the item/Active Effects.
5. **Origin traits**: auto-add required trait from compendium when origin selected.
6. **Starting gear**: batch `createEmbeddedDocuments` from compendium refs; avoid duplicates on re-run (`flags.wastelander.creationComplete` or confirm overwrite).

## Visual design target
**Goal:** Get **as close as possible** to the approved mockup using **CSS + light assets**. This is a firm product requirement, not a loose inspiration.

**Design reference (in repo):** `docs/reference/wastelander-wizard-ui-mockup.png` — use during implementation for layout, colors, and left sidebar navigation.

**Avoid:** Bethesda-owned art pasted into the module; keep original or system-licensed assets only.

