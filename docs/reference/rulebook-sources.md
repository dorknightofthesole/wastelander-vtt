# Rulebook sources

## Agent policy (required)

**Rules for this module come only from the PDF below and in-repo data derived from it.**

- Do **not** use the web (search, wikis, fandom, etc.) to look up Fallout RPG rules unless the user **explicitly** gives permission in that conversation.
- Compendium items are for Foundry integration (UUIDs, names), not as a substitute for the rulebook when defining mechanics.

## Source document

Character creation rules for the Wastelander wizard come from the **Fallout: The Roleplaying Game** core rulebook (Modiphius), Chapter 3.

## Primary PDF (local)

Path on Eddie’s machine (not committed to git — copyrighted PDF):

```
/Users/eddiegonzales/Documents/ttrpg/Fallout/wasteland/Fallout-Core-Rulebook-Char-Creation.pdf
```

This extract covers origins, S.P.E.C.I.A.L., skills, perks (including companion stat blocks such as **Dogmeat**, p. 63), derived stats, and starting equipment.

When working in Cursor, attach or reference this path if the agent needs to verify rules text.

## In-repo rule data

| File | Source |
|------|--------|
| `src/data/origins-core.json` | Origins + tag/perk hooks |
| `src/data/survivor-traits.json` | Survivor traits (p. 51–52) |
| `src/data/perk-companion-statblocks.json` | Companion profiles printed beside perks (e.g. Dogmeat) |
| `docs/fallout-character-wizard.plan.md` | Wizard scope and step list |

Fallout **items** (traits, perks, skills, gear) resolve from the [foundryvtt-fallout](https://github.com/Muttley/foundryvtt-fallout) compendiums at runtime. Companion stat blocks are not always present in the compendium perk description, so we mirror the rulebook in `perk-companion-statblocks.json`.
