# Rulebook sources

## Agent policy (required)

**Rules for this module come only from the PDF below and in-repo data derived from it.**

- Do **not** use the web (search, wikis, fandom, etc.) to look up Fallout RPG rules unless the user **explicitly** gives permission in that conversation.
- Compendium items are for Foundry integration (UUIDs, names), not as a substitute for the rulebook when defining mechanics.

## Source document

Character creation rules for the Wastelander wizard come from the **Fallout: The Roleplaying Game** core rulebook (Modiphius), Chapter 3.

## Primary PDFs (local)

Paths in-repo (gitignored under `docs/reference/source/*.pdf`) or on Eddie’s machine:

| PDF | Use |
|-----|-----|
| `docs/reference/source/Fallout-Core-Rulebook.pdf` | Scavenging play + loot tables (Ch.5); character creation |
| `docs/reference/source/Fallout-GM-Screen-Booklet.pdf` | **Creating scavenging locations** (pp.17–19), loot tables on screen (pp.8–16) |

Char-creation extract (machine copy):

```
/Users/eddiegonzales/Documents/ttrpg/Fallout/wasteland/Fallout-Core-Rulebook-Char-Creation.pdf
```

When working in Cursor, attach or reference these paths if the agent needs to verify rules text.

## In-repo rule data

| File | Source |
|------|--------|
| `src/data/origins-core.json` | Origins + tag/perk hooks |
| `src/data/survivor-traits.json` | Survivor traits (p. 51–52) |
| `src/data/perk-companion-statblocks.json` | Companion profiles printed beside perks (e.g. Dogmeat) |
| `docs/fallout-character-wizard.plan.md` | Wizard scope and step list |
| `src/data/scavenging/**` | Scavenger location generator (creation + loot JSON) |

Fallout **items** (traits, perks, skills, gear) resolve from the [foundryvtt-fallout](https://github.com/Muttley/foundryvtt-fallout) compendiums at runtime. Companion stat blocks are not always present in the compendium perk description, so we mirror the rulebook in `perk-companion-statblocks.json`.
