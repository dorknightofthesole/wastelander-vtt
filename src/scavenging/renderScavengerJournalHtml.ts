import { enrichFalloutHtml } from "../integrations/foundryText.js";
import { readPartyApForDisplay } from "./playerSearchActions.js";
import { t } from "../integrations/i18n.js";
import {
  buildCurrentTabContext,
  type CurrentTabContext,
} from "./currentTabContext.js";
import { formatLootCategoryLabel } from "./lootGrid.js";
import type {
  PartyActorRow,
  ScavengerLocation,
  ScavengerLocationProblems,
} from "./ScavengerLocation.js";
import {
  buildScavengerLootGridRows,
  type ScavengerLootGridRow,
} from "./scavengerLootGrid.js";
import {
  getRollTableKeysForLocation,
  getScavengingRollTableStatus,
  SCAVENGING_ROLL_TABLE_KEYS,
} from "./rollTableRegistry.js";
import { buildLuckNeighborRows } from "./rollTableLookup.js";
import {
  emptyPlayerSearchState,
  type AssistSearchRollLog,
  type PlayerLootRollEntry,
  type PlayerSearchRollLog,
  type ScavengerPlayerSearchState,
} from "./playerSearchState.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function section(title: string, body: string, panel = false): string {
  const panelClass = panel ? " wastelander-scavenger-panel" : "";
  return `
<section class="wastelander-scavenger-section${panelClass}">
  <h2>${escapeHtml(title)}</h2>
  ${body}
</section>`;
}

function hint(text: string, className = "wastelander-scavenger-hint"): string {
  return `<p class="${className}">${text}</p>`;
}

function noneBlock(): string {
  return hint(t("WASTELANDER.Scavenging.Current.None"));
}

function renderLocationSection(current: CurrentTabContext): string {
  const concept = current.concept
    ? hint(escapeHtml(current.concept))
    : "";
  return `
<section class="wastelander-scavenger-section">
  <h2>${escapeHtml(current.name ?? "")}</h2>
  ${concept}
  <dl class="wastelander-scavenger-location-meta">
    <div><dt>${t("WASTELANDER.Scavenging.Fields.Scale")}</dt><dd>${escapeHtml(current.scaleLabel ?? "")}</dd></div>
    <div><dt>${t("WASTELANDER.Scavenging.Fields.Category")}</dt><dd>${escapeHtml(current.categoryLabel ?? "")}</dd></div>
    <div><dt>${t("WASTELANDER.Scavenging.Fields.Degree")}</dt><dd>${escapeHtml(current.degreeLabel ?? "")}</dd></div>
  </dl>
</section>`;
}

function renderGeneratedStats(current: CurrentTabContext): string {
  const g = current.generated;
  if (!g) return "";
  return `
<section class="wastelander-scavenger-section wastelander-scavenger-generated-stats">
  <div class="wastelander-scavenger-stat">
    <span class="wastelander-scavenger-stat-label">${t("WASTELANDER.Scavenging.Fields.Level")}</span>
    <span class="wastelander-scavenger-stat-value">${escapeHtml(g.level)}</span>
  </div>
  <div class="wastelander-scavenger-stat">
    <span class="wastelander-scavenger-stat-label">${t("WASTELANDER.Scavenging.Generated.SearchDifficulty")}</span>
    <span class="wastelander-scavenger-stat-value">${g.searchDifficulty}</span>
  </div>
  <div class="wastelander-scavenger-stat">
    <span class="wastelander-scavenger-stat-label">${t("WASTELANDER.Scavenging.Generated.TimeTaken")}</span>
    <span class="wastelander-scavenger-stat-value">${g.searchMinutes} ${t("WASTELANDER.Scavenging.Generated.Minutes")} <span class="wastelander-scavenger-stat-sub">(${escapeHtml(g.searchTimeLabel)})</span></span>
  </div>
</section>`;
}

function renderInhabitants(current: CurrentTabContext): string {
  const inh = current.inhabitants;
  if (!inh) return noneBlock();

  const parts: string[] = [];
  if (inh.countSummary) {
    parts.push(`<p class="wastelander-scavenger-inhabitant-count">${escapeHtml(inh.countSummary)}</p>`);
    parts.push(hint(escapeHtml(inh.typeLabel)));
  }
  if (inh.overseerOverride) {
    parts.push(hint(t("WASTELANDER.Scavenging.Inhabitants.OverseerOverrideNote")));
  } else if (inh.rosterEmpty) {
    parts.push(
      hint(t("WASTELANDER.Scavenging.Inhabitants.RosterEmpty"), "wastelander-scavenger-warning"),
    );
  } else {
    const rows = inh.roster
      .map((r) => {
        const meta = `(${t("WASTELANDER.Scavenging.Inhabitants.LevelShort")} ${r.level})${r.sizeLabel ? ` — ${escapeHtml(r.sizeLabel)}` : ""}`;
        const name = r.actorUuid
          ? `<a class="entity-link" data-uuid="${r.actorUuid}"><i class="fas fa-user" aria-hidden="true"></i> ${escapeHtml(r.name)}</a>`
          : escapeHtml(r.name);
        return `<li class="wastelander-scavenger-inhabitant-row">${name} <span class="wastelander-scavenger-inhabitant-meta">${meta}</span></li>`;
      })
      .join("");
    parts.push(`<ul class="wastelander-scavenger-inhabitant-roster">${rows}</ul>`);
  }
  return parts.join("\n");
}

async function renderHazards(current: CurrentTabContext): Promise<string> {
  if (!current.hazard.present) return noneBlock();

  const parts: string[] = [];
  if (current.hazard.kindLabel) {
    parts.push(
      `<p class="wastelander-scavenger-inhabitant-count">${escapeHtml(current.hazard.kindLabel)}</p>`,
    );
  }
  if (current.hazard.summary) {
    parts.push(
      `<p class="wastelander-scavenger-hint">${await enrichFalloutHtml(current.hazard.summary)}</p>`,
    );
  }

  const damageUi = current.hazard.damageUi;
  if (damageUi?.show) {
    const formulaHtml = damageUi.formulaHint
      ? await enrichFalloutHtml(damageUi.formulaHint)
      : "";
    parts.push(`
<div class="wastelander-scavenger-hazard-damage">
  <p class="wastelander-scavenger-hint wastelander-scavenger-hazard-damage-formula">
    ${formulaHtml}
    <span class="wastelander-scavenger-hazard-damage-time">(${escapeHtml(damageUi.searchTimeLabel)})</span>
  </p>
  <h3 class="wastelander-scavenger-subheading">${t("WASTELANDER.Scavenging.HazardDamage.PartyTitle")}</h3>
  ${renderHazardParty(damageUi)}
</div>`);
  }

  return parts.join("\n");
}

function renderHazardParty(
  damageUi: NonNullable<CurrentTabContext["hazard"]["damageUi"]>,
): string {
  if (damageUi.partyEmpty) {
    return hint(t("WASTELANDER.Scavenging.HazardDamage.PartyEmpty"));
  }
  const rows = damageUi.players
    .map(
      (p) => `
    <li>
      <span class="wastelander-scavenger-hazard-damage-name">${escapeHtml(p.actorName)}</span>
      <span class="wastelander-scavenger-hazard-damage-user">${escapeHtml(p.userName)}</span>
    </li>`,
    )
    .join("");
  return `<ul class="wastelander-scavenger-hazard-damage-party">${rows}</ul>`;
}

function renderObstacles(current: CurrentTabContext): string {
  if (!current.obstacle.present) return noneBlock();

  const parts: string[] = [];
  if (current.obstacle.summary) {
    parts.push(`<p>${escapeHtml(current.obstacle.summary)}</p>`);
  }
  if (current.obstacle.showOvercome) {
    const label = t("WASTELANDER.Scavenging.Current.ObstacleOvercome");
    const status = current.obstacle.overcome
      ? t("WASTELANDER.Scavenging.Journal.Yes")
      : t("WASTELANDER.Scavenging.Journal.No");
    parts.push(
      `<p class="wastelander-scavenger-journal-check"><strong>${label}:</strong> ${status}</p>`,
    );
  }
  return parts.join("\n");
}

function renderLootGrid(rows: ScavengerLootGridRow[], allInstalled: boolean): string {
  const status = allInstalled
    ? `<p class="wastelander-scavenger-ok">${t("WASTELANDER.Scavenging.Tables.AllInstalled")}</p>`
    : `<p class="wastelander-scavenger-warning">${t("WASTELANDER.Scavenging.Tables.Missing")}</p>`;

  const gridRows = rows
    .map((row) => {
      const name = row.installed && row.tableId
        ? `<a class="entity-link content-link" data-link data-uuid="RollTable.${row.tableId}"><i class="fas fa-dice" aria-hidden="true"></i> ${escapeHtml(row.label)}</a>`
        : escapeHtml(row.label);
      return `
      <div class="wastelander-scavenger-loot-grid-row" role="row">
        <span class="wastelander-scavenger-loot-name" role="cell">${name}</span>
        <span class="wastelander-scavenger-loot-min" role="cell">${row.min}</span>
        <span class="wastelander-scavenger-loot-max" role="cell">${row.max}</span>
      </div>`;
    })
    .join("");

  return `
    ${hint(t("WASTELANDER.Scavenging.Tables.SidebarHint"))}
    ${status}
    <div class="wastelander-scavenger-loot-grid" role="table">
      <div class="wastelander-scavenger-loot-grid-header" role="row">
        <span role="columnheader">${t("WASTELANDER.Scavenging.Tables.ColumnTable")}</span>
        <span role="columnheader">${t("WASTELANDER.Scavenging.Tables.ColumnMin")}</span>
        <span role="columnheader">${t("WASTELANDER.Scavenging.Tables.ColumnMax")}</span>
      </div>
      ${gridRows}
    </div>`;
}

function searchStatusLabel(playerSearch: ScavengerPlayerSearchState): string {
  if (playerSearch.searchSuccess === true) {
    return t("WASTELANDER.Scavenging.Journal.SearchSuccess");
  }
  if (playerSearch.searchSuccess === false) {
    return t("WASTELANDER.Scavenging.Journal.SearchFail");
  }
  return t("WASTELANDER.Scavenging.Journal.SearchPending");
}

function renderPlayerLootRow(
  location: ScavengerLocation,
  playerSearch: ScavengerPlayerSearchState,
): string {
  const keys = new Set(
    location.items
      .filter((i) => i.category !== "junk")
      .map((i) => i.category),
  );
  if (!keys.size) return "";

  const header = `
    <thead>
      <tr>
        <th>${t("WASTELANDER.Scavenging.Tables.ColumnTable")}</th>
        <th>${t("WASTELANDER.Scavenging.Tables.ColumnMin")}</th>
        <th>${t("WASTELANDER.Scavenging.Tables.ColumnMax")}</th>
        <th>${t("WASTELANDER.Scavenging.PlayerSearch.RemainingMin")}</th>
        <th>${t("WASTELANDER.Scavenging.Journal.LootRollsUsed")}</th>
      </tr>
    </thead>`;

  const rows = location.items
    .filter((item) => item.category !== "junk")
    .map((item) => {
      const category = item.category;
      const label = formatLootCategoryLabel(category);
      const rem = playerSearch.remainingMin[category] ?? 0;
      const used = playerSearch.rollsUsed[category] ?? 0;
      return `
      <tr>
        <td>${escapeHtml(label)}</td>
        <td>${item.min}</td>
        <td>${item.max}</td>
        <td>${rem}</td>
        <td>${used}</td>
      </tr>`;
    })
    .join("");

  return `<table class="wastelander-scavenger-loot-table">${header}<tbody>${rows}</tbody></table>`;
}

function actorEntityLink(actorId: string): string {
  const actor = (game as { actors?: { get: (id: string) => { name?: string; uuid?: string } | undefined } })
    .actors?.get(actorId);
  const name = actor?.name?.trim() || actorId;
  const uuid = actor?.uuid ?? `Actor.${actorId}`;
  return `<a class="entity-link" data-uuid="${escapeHtml(uuid)}"><i class="fas fa-user" aria-hidden="true"></i> ${escapeHtml(name)}</a>`;
}

function lootSourceLabel(source: PlayerLootRollEntry["source"]): string {
  return source === "min"
    ? t("WASTELANDER.Scavenging.Journal.LootSourceMin")
    : t("WASTELANDER.Scavenging.Journal.LootSourceAp");
}

function renderSearchRollLog(log: PlayerSearchRollLog, heading: string): string {
  const outcome = log.success
    ? t("WASTELANDER.Scavenging.Journal.SearchSuccess")
    : t("WASTELANDER.Scavenging.Journal.SearchFail");
  const when = new Date(log.at).toLocaleString();
  const bonusAp =
    log.bonusApGranted && log.bonusApGranted > 0
      ? `<p class="wastelander-scavenger-ok">${t("WASTELANDER.Scavenging.PlayerSearch.BonusApGranted", { amount: log.bonusApGranted })}</p>`
      : "";
  const assistLine =
    log.assistBonusSuccesses && log.assistBonusSuccesses > 0
      ? `<p class="wastelander-scavenger-hint">${t("WASTELANDER.Scavenging.Journal.AssistBonusLine", { count: log.assistBonusSuccesses })}</p>`
      : "";
  return `
<h4 class="wastelander-scavenger-journal-roll-title">${escapeHtml(heading)}</h4>
<dl class="wastelander-scavenger-journal-roll-meta">
  <div><dt>${t("WASTELANDER.Scavenging.PlayerSearch.ActingCharacter")}</dt><dd>${actorEntityLink(log.actorId)}</dd></div>
  <div><dt>${t("WASTELANDER.Scavenging.Journal.SearchRollPlayer")}</dt><dd>${escapeHtml(log.userName)}</dd></div>
  <div><dt>${t("WASTELANDER.Scavenging.Journal.SearchRollOutcome")}</dt><dd>${escapeHtml(outcome)} (${log.successes} / ${log.difficulty} successes, TN ${log.targetNumber})</dd></div>
  <div><dt>${t("WASTELANDER.Scavenging.Journal.SearchRollDice")}</dt><dd>[${log.faces.join(", ")}]</dd></div>
  <div><dt>${t("WASTELANDER.Scavenging.Journal.SearchRollWhen")}</dt><dd>${escapeHtml(when)}</dd></div>
</dl>
${assistLine}
${bonusAp}
<p class="wastelander-scavenger-hint">${escapeHtml(log.detail)}</p>`;
}

function renderAssistRollLog(log: AssistSearchRollLog): string {
  const when = new Date(log.at).toLocaleString();
  const outcome = log.contributesSuccess
    ? t("WASTELANDER.Scavenging.Journal.AssistHelps")
    : t("WASTELANDER.Scavenging.Journal.AssistNoHelp");
  return `
<li class="wastelander-scavenger-roll-entry">
  <p><strong>${actorEntityLink(log.actorId)}</strong> <span class="wastelander-scavenger-hint">— ${escapeHtml(log.userName)} · ${escapeHtml(when)}</span></p>
  <p class="wastelander-scavenger-hint">${escapeHtml(outcome)} · d20 [${log.face}] → ${log.successes} success(es), TN ${log.targetNumber}</p>
  <p class="wastelander-scavenger-hint">${escapeHtml(log.detail)}</p>
</li>`;
}

async function renderLuckLadder(
  entry: PlayerLootRollEntry,
  locationLevel: number,
): Promise<string> {
  if (entry.rollSum <= 0 || entry.category === "junk" || entry.luckSpent > 0) {
    return "";
  }

  const rows = await buildLuckNeighborRows(
    entry,
    locationLevel,
    (cost) => t("WASTELANDER.Scavenging.PlayerSearch.LuckSpend", { cost }),
  );
  if (!rows.length) return "";

  const items = rows
    .map((row) => {
      const rowClass = row.isCurrent
        ? "wastelander-scavenger-luck-ladder-row is-current"
        : "wastelander-scavenger-luck-ladder-row";
      const prefix = row.luckPrefix
        ? `<span class="wastelander-scavenger-luck-cost">${escapeHtml(row.luckPrefix)}</span> `
        : "";
      return `<li class="${rowClass}">${prefix}<span class="wastelander-scavenger-luck-roll">${row.rollSum}.</span> <span class="wastelander-scavenger-luck-item">${escapeHtml(row.label)}</span></li>`;
    })
    .join("");

  return `<ul class="wastelander-scavenger-luck-ladder wastelander-scavenger-journal-luck-ladder">${items}</ul>`;
}

function renderUnlockedLoot(entry: PlayerLootRollEntry): string {
  if (entry.rollSum <= 0) return "";

  const inner = entry.itemUuid
    ? `<a class="entity-link" data-uuid="${escapeHtml(entry.itemUuid)}"><span class="wastelander-scavenger-luck-roll">${entry.rollSum}.</span> <span class="wastelander-scavenger-luck-item">${escapeHtml(entry.label)}</span></a>`
    : `<span class="wastelander-scavenger-luck-roll">${entry.rollSum}.</span> <span class="wastelander-scavenger-luck-item">${escapeHtml(entry.label)}</span>`;

  return `
<div class="wastelander-scavenger-loot-unlocked">
  <span class="wastelander-scavenger-loot-unlocked-label">${t("WASTELANDER.Scavenging.PlayerSearch.UnlockedLoot")}</span>
  ${inner}
</div>`;
}

async function renderLootRollEntry(
  entry: PlayerLootRollEntry,
  location: ScavengerLocation,
): Promise<string> {
  const categoryLabel = formatLootCategoryLabel(entry.category);
  const source = lootSourceLabel(entry.source);
  const when = new Date(entry.createdAt).toLocaleString();
  const baseRoll =
    typeof entry.baseRollSum === "number"
      ? entry.baseRollSum
      : entry.rollSum - entry.luckShift;

  const luckMeta =
    entry.luckShift !== 0 || entry.luckSpent > 0
      ? t("WASTELANDER.Scavenging.Journal.LootLuck", {
          shift: entry.luckShift,
          spent: entry.luckSpent,
        })
      : "";

  const quantityLine = entry.quantityFormula
    ? `<p class="wastelander-scavenger-hint">${escapeHtml(entry.quantityFormula)}</p>`
    : "";

  const ladder = await renderLuckLadder(entry, location.level);
  const unlocked = entry.rollSum > 0 ? renderUnlockedLoot(entry) : "";

  return `
  <li class="wastelander-scavenger-roll-entry">
    <div class="wastelander-scavenger-roll-entry-header">
      <strong>${escapeHtml(categoryLabel)}</strong>
      <span class="wastelander-scavenger-hint">— ${escapeHtml(entry.userName)} · ${escapeHtml(source)}</span>
    </div>
    <p class="wastelander-scavenger-hint">${actorEntityLink(entry.actorId)} · ${t("WASTELANDER.Scavenging.PlayerSearch.RollSum")} ${entry.rollSum} (${t("WASTELANDER.Scavenging.Journal.LootRollBase", { base: baseRoll })}${luckMeta ? `; ${luckMeta}` : ""}) · ${escapeHtml(when)}</p>
    ${quantityLine}
    ${ladder}
    ${unlocked}
  </li>`;
}

async function renderPlayerScavenge(
  location: ScavengerLocation | null,
  playerSearch: ScavengerPlayerSearchState | undefined,
): Promise<string> {
  if (!location) {
    return noneBlock();
  }

  const ps: ScavengerPlayerSearchState = playerSearch ?? emptyPlayerSearchState();

  const ap = await readPartyApForDisplay();
  const apLabel =
    ap.available && ap.value !== null
      ? String(ap.value)
      : t("WASTELANDER.Scavenging.PlayerSearch.PartyApUnavailable");

  const parts: string[] = [
    `<dl class="wastelander-scavenger-location-meta">
      <div><dt>${t("WASTELANDER.Scavenging.Fields.Level")}</dt><dd>${location.level}</dd></div>
      <div><dt>${t("WASTELANDER.Scavenging.Generated.SearchDifficulty")}</dt><dd>${location.searchDifficulty}</dd></div>
      <div><dt>${t("WASTELANDER.Scavenging.PlayerSearch.PartyAp")}</dt><dd>${escapeHtml(apLabel)}</dd></div>
    </dl>`,
    `<p><strong>${t("WASTELANDER.Scavenging.Journal.SearchStatus")}:</strong> ${searchStatusLabel(ps)}</p>`,
  ];

  const assistLogs = Object.values(ps.assistRolls ?? {}).sort((a, b) => a.at - b.at);
  if (assistLogs.length || ps.searchRollLog) {
    parts.push(
      `<h3 class="wastelander-scavenger-subheading">${t("WASTELANDER.Scavenging.PlayerSearch.SearchSection")}</h3>`,
    );
    if (assistLogs.length) {
      parts.push(
        `<h4 class="wastelander-scavenger-journal-roll-title">${t("WASTELANDER.Scavenging.Journal.AssistRollsTitle")}</h4>`,
        `<ul class="wastelander-scavenger-roll-results">${assistLogs.map(renderAssistRollLog).join("")}</ul>`,
      );
    }
    if (ps.searchRollLog) {
      parts.push(
        renderSearchRollLog(
          ps.searchRollLog,
          t("WASTELANDER.Scavenging.Journal.PrimaryRollTitle"),
        ),
      );
    }
  }

  if (ps.searchSuccess === false) {
    parts.push(
      hint(t("WASTELANDER.Scavenging.PlayerSearch.SearchFailed"), "wastelander-scavenger-warning"),
    );
  }

  if (ps.searchSuccess === true) {
    parts.push(
      `<h3 class="wastelander-scavenger-subheading">${t("WASTELANDER.Scavenging.PlayerSearch.LootSection")}</h3>`,
      hint(t("WASTELANDER.Scavenging.PlayerSearch.LootHint", { luckMax: location.level })),
      renderPlayerLootRow(location, ps),
    );
  } else if (ps.searchSuccess === null && !ps.searchRollLog) {
    parts.push(hint(t("WASTELANDER.Scavenging.PlayerSearch.SearchHint")));
  }

  if (ps.entries.length) {
    const entries = await Promise.all(
      [...ps.entries]
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((entry) => renderLootRollEntry(entry, location)),
    );
    parts.push(
      `<h3 class="wastelander-scavenger-subheading">${t("WASTELANDER.Scavenging.PlayerSearch.ResultsSection")}</h3>`,
      `<ul class="wastelander-scavenger-roll-results">${entries.join("")}</ul>`,
    );
  } else if (ps.searchSuccess === true) {
    parts.push(hint(t("WASTELANDER.Scavenging.Journal.NoLootRollsYet")));
  }

  return parts.join("\n");
}

export async function renderScavengerJournalHtml(params: {
  sceneId: string;
  sceneName: string;
  location: ScavengerLocation | null;
  formProblems: ScavengerLocationProblems;
  party: PartyActorRow[];
  playerSearch: ScavengerPlayerSearchState | undefined;
}): Promise<string> {
  const updated = new Date().toLocaleString();
  const current = buildCurrentTabContext(params.location, params.formProblems, {
    sceneId: params.sceneId,
    party: params.party,
  });

  if (current.empty) {
    return `
<div class="wastelander-scavenger-journal fallout">
  <header class="wastelander-scavenger-journal-header">
    <h1>${escapeHtml(params.sceneName)}</h1>
    <p class="wastelander-scavenger-scene-scope">${t("WASTELANDER.Scavenging.Journal.SceneLabel", { scene: escapeHtml(params.sceneName) })}</p>
    <p class="wastelander-scavenger-journal-muted">${t("WASTELANDER.Scavenging.Journal.Updated", { time: updated })}</p>
  </header>
  ${hint(t("WASTELANDER.Scavenging.Current.Empty"))}
</div>`;
  }

  const rollTableKeys = params.location
    ? getRollTableKeysForLocation(params.location.items)
    : [...SCAVENGING_ROLL_TABLE_KEYS].filter((k) => k !== "otherFoundItems");
  const rollTableStatus = await getScavengingRollTableStatus(rollTableKeys);
  const lootRows = buildScavengerLootGridRows(
    params.location,
    rollTableStatus.tables,
  );
  const allInstalled = rollTableStatus.allInstalled;

  const blocks = [
    `<header class="wastelander-scavenger-journal-header">
      <p class="wastelander-scavenger-scene-scope">${t("WASTELANDER.Scavenging.Journal.SceneLabel", { scene: escapeHtml(params.sceneName) })}</p>
      <p class="wastelander-scavenger-journal-muted">${t("WASTELANDER.Scavenging.Journal.Updated", { time: updated })}</p>
    </header>`,
    renderLocationSection(current),
    renderGeneratedStats(current),
    section(t("WASTELANDER.Scavenging.Current.Inhabitants"), renderInhabitants(current), true),
    section(t("WASTELANDER.Scavenging.Current.Hazards"), await renderHazards(current), true),
    section(t("WASTELANDER.Scavenging.Current.Obstacles"), renderObstacles(current)),
    section(
      t("WASTELANDER.Scavenging.Tables.Title"),
      renderLootGrid(lootRows, allInstalled),
    ),
    section(
      t("WASTELANDER.Scavenging.Journal.PlayerTitle"),
      await renderPlayerScavenge(params.location, params.playerSearch),
      true,
    ),
  ];

  return `<div class="wastelander-scavenger-journal fallout">${blocks.filter(Boolean).join("\n")}</div>`;
}
