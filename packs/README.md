# Bundled compendiums

Wastelander ships three Fallout compendium packs, grouped under **Wastelander** in the Compendiums sidebar:

| Pack | Type | Module id | Purpose |
|------|------|-----------|---------|
| **Wastelander Items** | Item | `wastelander.wastelander-items` | Apparel, consumables, weapons, and other custom/homebrew items |
| **Bobbleheads** | Item | `wastelander.wastelander-bobbleheads` | SPECIAL bobblehead miscellany items (automation via Wastelander inventory bonuses) |
| **Wastelander Rollable Tables** | RollTable | `wastelander.wastelander-rollable-tables` | Scavenging loot tables (GM Screen booklet names) |

Scavenging prefers these packs when **Prefer Foundry RollTables** is enabled and when resolving loot item links.

## Updating packs from Foundry

1. Edit compendiums in your Foundry world (or in the module’s packs after install).
2. **Close Foundry** (or ensure the pack is not locked).
3. Copy the LevelDB folder from your world into this repo:

```bash
# Example: copy from a world named "fallout"
WORLD="$HOME/Library/Application Support/FoundryVTT/Data/worlds/fallout/packs"
REPO="packs"

rsync -a --delete --exclude LOCK "$WORLD/wastelander-items/" "$REPO/wastelander-items/"
rsync -a --delete --exclude LOCK "$WORLD/wastelander-bobbleheads/" "$REPO/wastelander-bobbleheads/"
rsync -a --delete --exclude LOCK "$WORLD/wastelander-rollable-tables/" "$REPO/wastelander-rollable-tables/"
```

On Windows, use the equivalent path under `%LOCALAPPDATA%/FoundryVTT/Data/`.

4. Commit the updated `packs/` directory.

## Relinking roll-table item references

If scavenging tables still point at world-scoped `Item.<id>` UUIDs, relink them to Fallout system compendiums in bulk:

```bash
# Close Foundry first (no LOCK on packs)
npm run relink:scavenging-tables
```

The script unpacks `wastelander-rollable-tables`, matches each document result by name against local Fallout **Items & Abilities** packs (and `wastelander-items` for homebrew), writes `Compendium.fallout.*` / `Compendium.wastelander.*` UUIDs, and repacks the bundle.

**Close Foundry first** — if a `LOCK` file exists in the pack folder, Foundry can corrupt or empty the compendium during repack.

Text-only results (caps, keys, containers) are left unchanged.

## Roll table item links

For tables that award items, set each result’s document to a **compendium UUID** (e.g. `Compendium.wastelander.wastelander-items.Item.…` or `Compendium.fallout.ammunition.Item.…`), not a world-only `Item.<id>`. World-scoped links work in one world but break when the module is installed elsewhere.
