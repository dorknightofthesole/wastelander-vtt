# Bundled compendiums

Wastelander ships two Fallout compendium packs, grouped under **Wastelander** in the Compendiums sidebar:

| Pack | Type | Module id | Purpose |
|------|------|-----------|---------|
| **Items** | Item | `wastelander.items` | Custom/homebrew items for scavenging and loot resolution |
| **Wastelander** | RollTable | `wastelander.wastelander` | Scavenging loot tables (GM Screen booklet names) |

Scavenging prefers these packs when **Prefer Foundry RollTables** is enabled and when resolving loot item links.

## Updating packs from Foundry

1. Edit compendiums in your Foundry world (or in the module’s packs after install).
2. **Close Foundry** (or ensure the pack is not locked).
3. Copy the LevelDB folder from your world into this repo:

```bash
# Example: copy from a world named "fallout"
rsync -a --exclude LOCK \
  "$HOME/Library/Application Support/FoundryVTT/Data/worlds/fallout/packs/items/" \
  packs/items/
rsync -a --exclude LOCK \
  "$HOME/Library/Application Support/FoundryVTT/Data/worlds/fallout/packs/wastelander/" \
  packs/wastelander/
```

On Windows, use the equivalent path under `%LOCALAPPDATA%/FoundryVTT/Data/`.

4. Commit the updated `packs/` directory.

## Roll table item links

For tables that award items, set each result’s document to a **compendium UUID** (e.g. `Compendium.fallout.ammunition.Item.…` or `Compendium.wastelander.items.Item.…`), not a world-only `Item.<id>`. World-scoped links work in one world but break when the module is installed elsewhere.
