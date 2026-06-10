import { MODULE_PATH } from "../constants.js";
import {
  isFalloutSkillDialogAvailable,
  promptSurvivalSearchRoll,
} from "../integrations/falloutSkillDialog.js";
import { t } from "../integrations/i18n.js";
import type { LootCategoryKey, PartyActorRow, ScavengerLocation } from "./ScavengerLocation.js";
import { buildPlayerLootRows } from "./lootGrid.js";
import { getPartyActorsOnScene, userControlsActor } from "./partyContext.js";
import { canSearchLocation } from "./problemRules.js";
import {
  canRollMin,
  canSpendApOnCategory,
  emptyPlayerSearchState,
  normalizePlayerSearch,
  remainingMinFor,
  rollsUsedFor,
  type ScavengerPlayerSearchState,
  type SearchTeamRole,
} from "./playerSearchState.js";
import {
  assistActorIds,
  ensureSearchTeam,
  getPerSurvivalTargetNumber,
  getSearchTeamRole,
  hasPendingAssistRolls,
  isSearchTeamActor,
  primaryCanScavengeSearch,
  searchTeamActorIds,
  searchTeamLocked,
} from "./searchTeam.js";
import {
  readPartyApForDisplay,
  notifyScavengeSearchAppClosed,
  requestPlayerSearchAction,
  type AssistSearchRollPayload,
  type PlayerSearchSocketAction,
  type PrimarySearchRollPayload,
} from "./playerSearchActions.js";
import { openScavengingRollTable } from "./rollTableRegistry.js";
import { handleLootItemPointer } from "./lootItemInteract.js";
import {
  buildLuckNeighborRows,
  clearRollTableLookupCache,
  type LuckNeighborRow,
} from "./rollTableLookup.js";
import {
  getActiveSceneId,
  getSceneDocument,
  loadScavengerSceneState,
  type ScavengerScenePersistedState,
} from "./scenePersist.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

type LuckActorOption = {
  actorId: string;
  name: string;
  roleLabel: string;
  selected: boolean;
  luckPoints: number;
};

type LootRowContext = {
  category: LootCategoryKey;
  label: string;
  min: number;
  max: number;
  remainingMin: number;
  rollsUsed: number;
  canRollMin: boolean;
  canSpendAp: boolean;
  installed: boolean;
  tableId?: string;
};

type TeamRowContext = {
  actorId: string;
  actorName: string;
  userName: string;
  userActive: boolean;
  perSurvivalLabel: string;
  role: SearchTeamRole;
  roleOptions: { value: SearchTeamRole; label: string; selected: boolean }[];
  canScavenge: boolean;
  scavengeTitle: string;
  assistRollDetail: string;
  primaryRollDetail: string;
};

type RollEntryContext = {
  id: string;
  label: string;
  categoryLabel: string;
  rollSum: number;
  luckShift: number;
  luckSpent: number;
  userName: string;
  luckLocked: boolean;
  itemUuid?: string;
  /** Ladder options only (excludes the committed roll). */
  previewRows: Array<LuckNeighborRow & { canJump: boolean }>;
  showUnlockedLoot: boolean;
};

export default class ScavengerSearchApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static #open: ScavengerSearchApp | null = null;

  #sceneId: string | null = null;
  #sceneState: ScavengerScenePersistedState | null = null;
  #actingActorId: string | null = null;
  #partyAp: number | null = null;
  #partyApAvailable = false;
  #busy = false;

  constructor(options: ApplicationConfiguration = {}) {
    super(options);
    ScavengerSearchApp.#open = this;
  }

  static override DEFAULT_OPTIONS = {
    id: "wastelander-scavenger-search",
    uniqueId: true,
    classes: ["wastelander-wizard", "wastelander-scavenger-app", "wastelander-scavenger-search"],
    window: {
      title: "WASTELANDER.Scavenging.PlayerSearch.WindowTitle",
      icon: "fa-solid fa-magnifying-glass",
      resizable: true,
    },
    position: { width: 640, height: 720 },
    actions: {
      rollTeamSearch: ScavengerSearchApp.onRollTeamSearch,
      setTeamRole: ScavengerSearchApp.onSetTeamRole,
      rollMin: ScavengerSearchApp.onRollMin,
      spendAp: ScavengerSearchApp.onSpendAp,
      openRollTable: ScavengerSearchApp.onOpenRollTable,
      luckJump: ScavengerSearchApp.onLuckJump,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/scavenging/search-player.hbs`,
      scrollable: [".wastelander-scavenger-scroll"],
    },
  };

  get title(): string {
    const scene = this.#sceneId ? getSceneDocument(this.#sceneId) : undefined;
    if (scene?.name) {
      return t("WASTELANDER.Scavenging.PlayerSearch.WindowTitleScene", {
        scene: scene.name,
      });
    }
    return t("WASTELANDER.Scavenging.PlayerSearch.WindowTitle");
  }

  static async onActivateScene(sceneId: string): Promise<void> {
    const app = ScavengerSearchApp.#open;
    if (!app?.rendered) return;
    await app.#bindScene(sceneId);
    void app.render();
  }

  static onSceneUpdated(sceneId: string): void {
    const app = ScavengerSearchApp.#open;
    if (!app?.rendered || app.#sceneId !== sceneId) return;
    void app.#bindScene(sceneId).then(() => app.render());
  }

  static async renderOpen(): Promise<ScavengerSearchApp> {
    if (ScavengerSearchApp.#open?.rendered) {
      const activeId = getActiveSceneId();
      if (activeId && ScavengerSearchApp.#open.#sceneId !== activeId) {
        await ScavengerSearchApp.#open.#bindScene(activeId);
        void ScavengerSearchApp.#open.render();
      }
      ScavengerSearchApp.#open.bringToFront?.();
      return ScavengerSearchApp.#open;
    }
    const app = new ScavengerSearchApp();
    await app.#bindScene(getActiveSceneId());
    return app.render({ force: true });
  }

  protected override async _onClose(options?: object): Promise<void> {
    if (this.#sceneId) {
      notifyScavengeSearchAppClosed(this.#sceneId);
    }
    if (ScavengerSearchApp.#open === this) {
      ScavengerSearchApp.#open = null;
    }
    return super._onClose(options);
  }

  async #bindScene(sceneId: string | undefined): Promise<void> {
    this.#sceneId = sceneId ?? null;
    this.#sceneState = sceneId ? loadScavengerSceneState(sceneId) : null;

    const ap = await readPartyApForDisplay();
    this.#partyAp = ap.value;
    this.#partyApAvailable = ap.available;

    const playerSearch = this.#normalizedPlayerSearch();
    const teamIds = searchTeamActorIds(playerSearch);
    if (!this.#actingActorId || !teamIds.includes(this.#actingActorId)) {
      this.#actingActorId = this.#resolveDefaultActorId(playerSearch);
    }
  }

  /** Mirror server {@link preparePlayerSearch} so default team roles match the UI. */
  #normalizedPlayerSearch(): ScavengerPlayerSearchState {
    const base =
      normalizePlayerSearch(this.#sceneState?.playerSearch) ?? emptyPlayerSearchState();
    if (!this.#sceneId) return base;
    return ensureSearchTeam(base, this.#partyOnScene().map((r) => r.actorId));
  }

  #resolveDefaultActorId(playerSearch?: ScavengerPlayerSearchState): string | null {
    const teamIds = playerSearch ? searchTeamActorIds(playerSearch) : [];
    const userId = game.user?.id ?? "";

    const char = (game.user as { character?: { id: string } | string | null })
      ?.character;
    const charId = typeof char === "string" ? char : char?.id;
    if (charId && teamIds.includes(charId) && game.actors.get(charId)) {
      return charId;
    }

    const controlled = teamIds.find((id) => this.#canControlActor(id, userId));
    if (controlled) return controlled;

    if (teamIds[0] && game.actors.get(teamIds[0])) return teamIds[0];

    if (charId && game.actors.get(charId)) return charId;
    const rows = this.#partyActorsForUi();
    return rows[0]?.actorId ?? null;
  }

  #partyOnScene(): PartyActorRow[] {
    if (!this.#sceneId) return [];
    return getPartyActorsOnScene(this.#sceneId);
  }

  #partyActorsForUi(): PartyActorRow[] {
    const rows = this.#partyOnScene();
    const list = game.user?.isGM
      ? rows
      : rows.filter((r) => r.userId === game.user?.id);

    if (list.length > 0) return list;

    const char = (game.user as { character?: { id: string; name?: string } | string | null })
      ?.character;
    const charId = typeof char === "string" ? char : char?.id;
    const actor = charId ? game.actors.get(charId) : undefined;
    if (!actor) return [];

    return [
      {
        actorId: actor.id,
        actorName: actor.name,
        userId: game.user?.id ?? "",
        userName: (game.user as { name?: string })?.name ?? "",
        userActive: true,
        level: Number((actor.system as { level?: { value?: number } }).level?.value ?? 1),
        selected: true,
      },
    ];
  }

  #canControlActor(actorId: string, userId: string): boolean {
    return userControlsActor(actorId, userId, this.#sceneId);
  }

  #buildTeamRows(
    playerSearch: ScavengerPlayerSearchState,
    searchPending: boolean,
  ): TeamRowContext[] {
    const party = this.#partyOnScene();
    const ps = ensureSearchTeam(
      playerSearch,
      party.map((r) => r.actorId),
    );
    const canEditTeam = searchPending && !searchTeamLocked(ps);
    const partyIds = party.map((r) => r.actorId);
    const pendingAssists = hasPendingAssistRolls(ps, partyIds);
    const primaryCanRoll = primaryCanScavengeSearch(ps, partyIds);
    const userId = game.user?.id ?? "";

    return party.map((row) => {
      const actor = game.actors.get(row.actorId);
      const { per, survival, targetNumber } = actor
        ? getPerSurvivalTargetNumber(actor)
        : { per: 0, survival: 0, targetNumber: 0 };
      const role = getSearchTeamRole(ps, row.actorId);
      const roleOptions: TeamRowContext["roleOptions"] = (
        ["none", "assist", "primary"] as const
      ).map((value) => ({
        value,
        label: t(`WASTELANDER.Scavenging.PlayerSearch.TeamRole.${value}`),
        selected: value === role,
      }));

      const assistLog = ps.assistRolls[row.actorId];
      const isPrimary = role === "primary";
      const isAssist = role === "assist";
      const owns = this.#canControlActor(row.actorId, userId);

      let canScavenge = false;
      let scavengeTitle = "";

      if (searchPending && owns) {
        if (isAssist && !assistLog) {
          canScavenge = true;
          scavengeTitle = t("WASTELANDER.Scavenging.PlayerSearch.ScavengeAssistHint");
        } else if (isPrimary) {
          if (primaryCanRoll) {
            canScavenge = true;
            scavengeTitle = t("WASTELANDER.Scavenging.PlayerSearch.ScavengePrimaryHint");
          } else if (pendingAssists) {
            scavengeTitle = t("WASTELANDER.Scavenging.PlayerSearch.PrimaryWaitingAssists", {
              count: assistActorIds(ps).filter((id) => !ps.assistRolls[id]).length,
            });
          }
        } else if (isAssist && assistLog) {
          scavengeTitle = t("WASTELANDER.Scavenging.PlayerSearch.AssistAlreadyRolled");
        } else if (role === "none") {
          scavengeTitle = t("WASTELANDER.Scavenging.PlayerSearch.TeamRoleNone");
        }
      } else if (!owns) {
        scavengeTitle = t("WASTELANDER.Scavenging.PlayerSearch.NotYourCharacter");
      }

      const assistRollDetail = assistLog
        ? assistLog.detail
        : "";
      const primaryRollDetail =
        isPrimary && ps.searchRollLog ? ps.searchRollLog.detail : "";

      return {
        actorId: row.actorId,
        actorName: row.actorName,
        userName: row.userName,
        userActive: row.userActive,
        perSurvivalLabel: t("WASTELANDER.Scavenging.PlayerSearch.PerSurvivalShort", {
          per,
          survival,
          tn: targetNumber,
        }),
        role,
        roleOptions,
        canScavenge,
        scavengeDisabled: !canScavenge,
        scavengeTitle,
        assistRollDetail,
        primaryRollDetail,
      };
    });
  }

  #location(): ScavengerLocation | null {
    return this.#sceneState?.location ?? null;
  }

  #playerSearch(): ScavengerPlayerSearchState | undefined {
    return this.#sceneState?.playerSearch;
  }

  protected override async _onRender(
    context: Record<string, unknown>,
    options: object,
  ): Promise<void> {
    await super._onRender(context, options);
    const root = this.#rootElement();
    if (!root || root.dataset.wastelanderSearchBound === "1") return;
    root.dataset.wastelanderSearchBound = "1";
    root.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (target.dataset.action === "selectLuckActor") {
        const actorId = target.value;
        if (actorId) {
          this.#actingActorId = actorId;
          void this.render();
        }
        return;
      }
      if (target.dataset.action === "setTeamRole") {
        const actorId = target.dataset.actorId;
        const role = target.value as SearchTeamRole;
        if (!actorId || !this.#sceneId) return;
        if (role !== "primary" && role !== "assist" && role !== "none") return;
        void this.#runAction({
          action: "setSearchTeamRole",
          sceneId: this.#sceneId,
          actorId,
          role,
        });
      }
    });

    if (root.dataset.wastelanderLootInteractBound !== "1") {
      root.dataset.wastelanderLootInteractBound = "1";
      root.addEventListener("dragstart", (event) => {
        handleLootItemPointer(event, "dragstart");
      });
      root.addEventListener("click", (event) => {
        handleLootItemPointer(event, "click");
      });
    }
  }

  #rootElement(): HTMLElement | null {
    const el = this.element;
    if (el instanceof HTMLElement) return el;
    if (Array.isArray(el) && el[0] instanceof HTMLElement) return el[0];
    return null;
  }

  protected override async _prepareContext(
    _options?: object,
  ): Promise<Record<string, unknown>> {
    if (this.#sceneId) {
      this.#sceneState = loadScavengerSceneState(this.#sceneId);
    }

    const location = this.#location();
    const playerSearch = this.#playerSearch();
    const scene = this.#sceneId ? getSceneDocument(this.#sceneId) : undefined;

    const empty = !location;
    const searchSuccess = playerSearch?.searchSuccess === true;
    const searchFailed = playerSearch?.searchSuccess === false;
    const showLootTables = searchSuccess && Boolean(location);

    const obstacleBlocked =
      Boolean(location) && !canSearchLocation(location!.problems);

    const luckMax = location?.level ?? 0;
    const playerSearchForLoot =
      playerSearch && location
        ? ensureSearchTeam(playerSearch, this.#partyOnScene().map((r) => r.actorId))
        : undefined;
    const luckActorOptions = playerSearchForLoot
      ? this.#buildLuckActorOptions(playerSearchForLoot)
      : [];
    if (
      luckActorOptions.length &&
      !luckActorOptions.some((o) => o.actorId === this.#actingActorId)
    ) {
      this.#actingActorId = luckActorOptions[0]!.actorId;
    }
    const selectedLuckPoints = this.#actorLuck(this.#actingActorId);
    const canSpendLuck = this.#canSpendLuck(playerSearchForLoot);
    const searchPending =
      !playerSearch ||
      playerSearch.searchSuccess === null ||
      playerSearch.searchSuccess === undefined;

    const teamPlayerSearch = ensureSearchTeam(
      playerSearch ?? emptyPlayerSearchState(),
      this.#partyOnScene().map((r) => r.actorId),
    );
    const teamRows = searchPending
      ? this.#buildTeamRows(teamPlayerSearch, true)
      : this.#buildTeamRows(teamPlayerSearch, false);
    const teamPartyIds = this.#partyOnScene().map((r) => r.actorId);
    const assistsPendingHint =
      searchPending && hasPendingAssistRolls(teamPlayerSearch, teamPartyIds)
        ? t("WASTELANDER.Scavenging.PlayerSearch.AssistsPending")
        : "";

    let lootRows: LootRowContext[] = [];
    let rollEntries: RollEntryContext[] = [];

    if (showLootTables && location && playerSearch) {
      clearRollTableLookupCache();
      lootRows = (await buildPlayerLootRows(location)).map((row) => ({
        category: row.category,
        label: row.label,
        min: row.min,
        max: row.max,
        remainingMin: remainingMinFor(playerSearch, row.category),
        rollsUsed: rollsUsedFor(playerSearch, row.category),
        canRollMin: canRollMin(playerSearch, location, row.category),
        canSpendAp:
          this.#partyApAvailable &&
          (this.#partyAp ?? 0) >= 1 &&
          canSpendApOnCategory(playerSearch, location, row.category),
        installed: row.installed,
        tableId: row.tableId,
      }));

      const luckSpendLabel = (cost: number) =>
        t("WASTELANDER.Scavenging.PlayerSearch.LuckSpend", { cost });

      const reversed = [...playerSearch.entries].reverse();
      rollEntries = await Promise.all(
        reversed.map(async (entry) => {
          const row = lootRows.find((r) => r.category === entry.category);
          const shift = entry.luckShift;
          const luckLocked = entry.luckSpent > 0;
          const neighborRows = luckLocked
            ? []
            : (
                await buildLuckNeighborRows(entry, luckMax, luckSpendLabel)
              ).map((row) => ({
                ...row,
                canJump:
                  canSpendLuck &&
                  !row.isCurrent &&
                  row.jumpCost > 0 &&
                  row.jumpCost <= selectedLuckPoints,
              }));
          const previewRows = neighborRows.filter((row) => !row.isCurrent);
          return {
            id: entry.id,
            label: entry.label,
            categoryLabel: row?.label ?? entry.category,
            rollSum: entry.rollSum,
            luckShift: shift,
            luckSpent: entry.luckSpent,
            userName: entry.userName,
            luckLocked,
            itemUuid: entry.itemUuid,
            previewRows,
            showUnlockedLoot: entry.rollSum > 0,
          };
        }),
      );
    }

    return {
      empty,
      sceneScope: scene?.name
        ? t("WASTELANDER.Scavenging.SceneScope", { scene: scene.name })
        : "",
      locationName: location?.name ?? "",
      locationConcept: location?.concept ?? "",
      level: location?.level ?? "—",
      searchDifficulty: location?.searchDifficulty ?? "—",
      partyAp: this.#partyApAvailable
        ? String(this.#partyAp ?? 0)
        : t("WASTELANDER.Scavenging.PlayerSearch.PartyApUnavailable"),
      partyApAvailable: this.#partyApAvailable,
      obstacleBlocked,
      obstacleBlockedHint: t("WASTELANDER.Scavenging.PlayerSearch.ObstacleBlocked"),
      showLootTables,
      searchSuccess,
      searchFailed,
      searchPending,
      searchResolved: searchSuccess || searchFailed,
      searchLog: playerSearch?.searchRollLog?.detail ?? "",
      bonusApMessage:
        playerSearch?.searchRollLog?.bonusApGranted &&
        playerSearch.searchRollLog.bonusApGranted > 0
          ? t("WASTELANDER.Scavenging.PlayerSearch.BonusApGranted", {
              amount: playerSearch.searchRollLog.bonusApGranted,
            })
          : "",
      noLootMessage: searchFailed
        ? t("WASTELANDER.Scavenging.PlayerSearch.SearchFailed")
        : "",
      teamRows,
      canEditTeam: searchPending && !searchTeamLocked(teamPlayerSearch),
      assistsPendingHint,
      luckMax,
      luckActorOptions,
      selectedLuckPoints,
      canSpendLuck,
      lootRows,
      rollEntries,
      busy: this.#busy,
    };
  }

  #buildLuckActorOptions(
    playerSearch: ScavengerPlayerSearchState,
  ): LuckActorOption[] {
    const userId = game.user?.id ?? "";
    return searchTeamActorIds(playerSearch)
      .filter((actorId) => game.user?.isGM || this.#canControlActor(actorId, userId))
      .map((actorId) => {
        const actor = game.actors.get(actorId);
        const role = getSearchTeamRole(playerSearch, actorId);
        return {
          actorId,
          name: actor?.name ?? actorId,
          roleLabel: t(`WASTELANDER.Scavenging.PlayerSearch.TeamRole.${role}`),
          selected: actorId === this.#actingActorId,
          luckPoints: this.#actorLuck(actorId),
        };
      });
  }

  #canSpendLuck(playerSearch?: ScavengerPlayerSearchState): boolean {
    if (!this.#actingActorId || !playerSearch) return false;
    if (!isSearchTeamActor(playerSearch, this.#actingActorId)) return false;
    return this.#canControlActor(this.#actingActorId, game.user?.id ?? "");
  }

  #actorLuck(actorId: string | null): number {
    if (!actorId) return 0;
    const actor = game.actors.get(actorId);
    if (!actor) return 0;
    return Math.max(0, Math.floor(Number((actor.system as { luckPoints?: number }).luckPoints ?? 0)));
  }

  async #runAction(data: PlayerSearchSocketAction): Promise<void> {
    if (this.#busy || !this.#sceneId) return;
    this.#busy = true;
    void this.render();
    try {
      const result = await requestPlayerSearchAction(data);
      if (!result.ok) {
        ui.notifications.warn(result.error);
        return;
      }
      this.#sceneState = result.state;
      const ap = await readPartyApForDisplay();
      this.#partyAp = ap.value;
      this.#partyApAvailable = ap.available;
      ui.notifications.info(t("WASTELANDER.Scavenging.PlayerSearch.ActionDone"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.notifications.error(message);
    } finally {
      this.#busy = false;
      void this.render();
    }
  }

  static onRollTeamSearch(
    this: ScavengerSearchApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    if (!this.#sceneId) {
      ui.notifications.warn(t("WASTELANDER.Scavenging.PlayerSearch.NoActiveScene"));
      return;
    }
    const el = target.closest<HTMLElement>("[data-actor-id]") ?? target;
    const actorId = el.dataset.actorId;
    if (!actorId) {
      ui.notifications.warn(t("WASTELANDER.Scavenging.PlayerSearch.NoCharacter"));
      return;
    }
    void this.#rollTeamSearch(actorId);
  }

  async #rollTeamSearch(actorId: string): Promise<void> {
    if (this.#busy || !this.#sceneId) return;

    const playerSearch = this.#normalizedPlayerSearch();
    const role = getSearchTeamRole(playerSearch, actorId);
    let primaryRoll: PrimarySearchRollPayload | undefined;
    let assistRoll: AssistSearchRollPayload | undefined;

    if ((role === "primary" || role === "assist") && isFalloutSkillDialogAvailable()) {
      const actor = game.actors.get(actorId);
      if (!actor) {
        ui.notifications.warn(t("WASTELANDER.Scavenging.PlayerSearch.ActorNotFound"));
        return;
      }

      const location = this.#location();
      const isAssist = role === "assist";
      this.#busy = true;
      void this.render();
      let dialogResult;
      try {
        dialogResult = await promptSurvivalSearchRoll(actor, {
          diceNum: isAssist ? 1 : 2,
          rollName: isAssist
            ? t("WASTELANDER.Scavenging.PlayerSearch.SurvivalAssistRollName", {
                location: location?.name ?? "",
              })
            : t("WASTELANDER.Scavenging.PlayerSearch.SurvivalSearchRollName", {
                location: location?.name ?? "",
              }),
        });
      } finally {
        this.#busy = false;
        void this.render();
      }

      if (!dialogResult) {
        ui.notifications.info(t("WASTELANDER.Scavenging.PlayerSearch.SearchRollCancelled"));
        return;
      }

      if (isAssist) {
        assistRoll = {
          faces: dialogResult.faces,
          successes: dialogResult.successes,
          targetNumber: dialogResult.targetNumber,
        };
      } else {
        primaryRoll = {
          faces: dialogResult.faces,
          successes: dialogResult.successes,
          targetNumber: dialogResult.targetNumber,
          difficulty: location?.searchDifficulty ?? 0,
        };
      }
    }

    await this.#runAction({
      action: "searchRoll",
      sceneId: this.#sceneId,
      actorId,
      ...(primaryRoll ? { primaryRoll } : {}),
      ...(assistRoll ? { assistRoll } : {}),
    });
  }

  static onSetTeamRole(
    this: ScavengerSearchApp,
    _event: Event,
    _target: HTMLElement,
  ): void {
    // Handled via change listener on <select data-action="setTeamRole">.
  }

  static onOpenRollTable(
    this: ScavengerSearchApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const el = target.closest<HTMLElement>("[data-table-id]") ?? target;
    const tableId = el.dataset.tableId;
    if (!tableId) return;
    openScavengingRollTable(tableId);
  }

  static onRollMin(
    this: ScavengerSearchApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const el = target.closest<HTMLElement>("[data-category]") ?? target;
    const category = el.dataset.category as LootCategoryKey | undefined;
    if (!this.#sceneId || !this.#actingActorId || !category) return;
    void this.#runAction({
      action: "lootRollMin",
      sceneId: this.#sceneId,
      actorId: this.#actingActorId,
      category,
    });
  }

  static onSpendAp(
    this: ScavengerSearchApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const el = target.closest<HTMLElement>("[data-category]") ?? target;
    const category = el.dataset.category as LootCategoryKey | undefined;
    if (!this.#sceneId || !this.#actingActorId || !category) return;
    void this.#runAction({
      action: "lootRollAp",
      sceneId: this.#sceneId,
      actorId: this.#actingActorId,
      category,
    });
  }

  static onLuckJump(
    this: ScavengerSearchApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const el = target.closest<HTMLElement>("[data-entry-id][data-target-shift]") ?? target;
    const entryId = el.dataset.entryId;
    const targetShift = Number(el.dataset.targetShift);
    if (!this.#sceneId || !this.#actingActorId || !entryId) return;
    if (!Number.isFinite(targetShift)) return;
    void this.#runAction({
      action: "luckJump",
      sceneId: this.#sceneId,
      actorId: this.#actingActorId,
      entryId,
      targetShift,
    });
  }
}
