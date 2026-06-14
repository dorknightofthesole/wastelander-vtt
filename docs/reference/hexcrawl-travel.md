# Hexcrawl travel (GM Toolkit)

Scene-tied hexcrawl travel using rules from **Fallout 2d20 GM Toolkit** (travel pp.9–17, encounters pp.20–24).

## Encounter tables (local build)

1. Place `Fallout-2d20-GM-Toolkit.pdf` at `docs/reference/source/`.
2. Extract manifests: `npm run extract:encounters`
3. Build Foundry JSON: `npm run build:encounters`
4. Bundle module: `npm run build`
5. In Foundry: **Settings → Wastelander → Import encounter tables**

Tables appear under **Roll Tables → Wastelander → Encounters**.

## Using hexcrawl in a scene

1. Open the overworld scene and use the **route** token toolbar button (Overseer).
2. Enable **Hexcrawl on this scene** (off by default on other scenes).
3. Optionally accept hex grid setup (6 mi/hex default; adjust scale to your map).
4. Select the **party travel token** and party actors.
5. Drag the travel token across hex boundaries.

On each new hex:

- World clock advances (if Simple Calendar + setting enabled)
- 1CD is rolled; on Effect, encounter type → detail table
- **Wasteland Travels** journal updates (one page per scene)
- A **travel trail** border appears on that hex (see below)

## Travel trail (map overlay)

When hexcrawl is enabled on a hex scene, traveled hexes show an amber **border-only** outline aligned to Foundry's hex grid. The overlay sits below tokens and is not selectable.

| Event | Trail on map |
| --- | --- |
| Set starting hex | Starting hex outlined |
| Enter hex during travel | Hex added to trail; current hex highlighted |
| Set camp / new travel day | Trail **persists** (cumulative breadcrumb) |
| Reset travel | Trail resets to starting hex only |
| Clear journal | Trail **cleared** from map (starting hex hidden until next travel or set starting) |
| Disable hexcrawl | Trail hidden (data retained) |

Trail state is stored in scene flags as `traveledHexKeys` and syncs to all connected clients when travel state updates. The starting hex is always outlined when set, even if it was not yet visited during travel. Revisiting a hex does not duplicate its border.

Overseers can change **Travel trail color** in the Scene tab under Travel settings; the new color applies immediately to all outlined hexes on the map.

## Navigation (MVP)

- Set **Navigation difficulty** from GM Toolkit conditions (base difficulty).
- At day end, Overseer marks **course check pass/fail** or **lost / on course**.
- **Mark arrival** pauses travel until resumed.

## Deferred

Terrain speed modifiers, camping watches, and player Survival assist UI are not in MVP.
