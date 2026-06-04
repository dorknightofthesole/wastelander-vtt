import { MODULE_ID, MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import type {
  HazardKind,
  InhabitantType,
  ItemCategoryRange,
  LocationCategoryId,
  LocationDegree,
  LocationScale,
  LootCategoryKey,
  ObstacleType,
  PartyActorRow,
  ScavengerLocation,
  ScavengerLocationProblems,
} from "./ScavengerLocation.js";
import {
  canHaveInhabitants,
  formatInhabitantCountSummary,
  INHABITANT_TYPE_OPTIONS,
} from "./inhabitantRules.js";
import { loadDenizens } from "./loadDenizens.js";
import { openActorByUuid, startActorDrag } from "./resolveDenizenActor.js";
import {
  getDegreeReductionPoints,
  getSearchDifficulty,
  SEARCH_TIME_BY_SCALE,
} from "./locationRules.js";
import {
  generateScavengerLocation,
  getCategoryOptions,
} from "./locationGenerator.js";
import { getPartyActorsOnScene } from "./partyContext.js";
import {
  applyScavengerSceneState,
  defaultFormState,
  getActiveSceneId,
  getSceneDocument,
  loadScavengerSceneState,
  persistScavengerSceneState,
  type ScavengerFormState,
  type ScavengerTab,
} from "./scenePersist.js";
import { saveLocationToJournal } from "./journalPersist.js";
import {
  getRollTableDisplayName,
  getRollTableKeysForLocation,
  SCAVENGING_ROLL_TABLE_KEYS,
  getScavengingRollTableStatus,
  type ScavengingRollTableStatusRow,
  openScavengingRollTable,
  resolveRollTableKey,
} from "./rollTableRegistry.js";
import {
  canSearchLocation,
  formatHazardSummary,
  formatObstacleSummary,
  HAZARD_KINDS,
  normalizeHazardKind,
  OBSTACLE_TYPES,
  resolveLocationProblems,
} from "./problemRules.js";
import { formatLootCategoryLabel } from "./lootGrid.js";
import { executePlayerSearchAction } from "./playerSearchActions.js";
import ScavengerSearchApp from "./ScavengerSearchApp.js";
import { getScavengingSettingBoolean, SCAVENGING_SETTINGS } from "./scavengingSettings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

type FormState = ScavengerFormState;

export default class ScavengerLocationApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static #open: ScavengerLocationApp | null = null;
  static #generating = false;

  party: PartyActorRow[] = [];
  location: ScavengerLocation | null = null;
  #activeTab: ScavengerTab = "current";
  #form: FormState = defaultFormState();
  #sceneId: string | null = null;
  #persistDebounce: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ApplicationConfiguration = {}) {
    super(options);
    ScavengerLocationApp.#open = this;
  }

  static override DEFAULT_OPTIONS = {
    id: "wastelander-scavenger-generator",
    uniqueId: true,
    classes: ["wastelander-wizard", "wastelander-scavenger-app"],
    window: {
      title: "WASTELANDER.Scavenging.WindowTitle",
      icon: "fa-solid fa-warehouse",
      resizable: true,
    },
    position: { width: 720, height: 820 },
    actions: {
      switchTab: ScavengerLocationApp.onSwitchTab,
      refreshParty: ScavengerLocationApp.onRefreshParty,
      generate: ScavengerLocationApp.onGenerate,
      saveJournal: ScavengerLocationApp.onSaveJournal,
      openRollTable: ScavengerLocationApp.onOpenRollTable,
      openInhabitantActor: ScavengerLocationApp.onOpenInhabitantActor,
      toggleObstacleOvercome: ScavengerLocationApp.onToggleObstacleOvercome,
      markSearchSuccess: ScavengerLocationApp.onMarkSearchSuccess,
      markSearchFail: ScavengerLocationApp.onMarkSearchFail,
      resetPlayerSearch: ScavengerLocationApp.onResetPlayerSearch,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/scavenging/generator.hbs`,
      scrollable: [".wastelander-scavenger-scroll"],
    },
  };

  get title(): string {
    const scene = this.#sceneId ? getSceneDocument(this.#sceneId) : undefined;
    if (scene?.name) {
      return t("WASTELANDER.Scavenging.WindowTitleScene", { scene: scene.name });
    }
    return t("WASTELANDER.Scavenging.WindowTitle");
  }

  static async onActivateScene(sceneId: string): Promise<void> {
    const app = ScavengerLocationApp.#open;
    if (!app?.rendered) return;
    await app.#bindScene(sceneId);
    void app.render();
  }

  static async renderOpen(): Promise<ScavengerLocationApp> {
    if (ScavengerLocationApp.#open?.rendered) {
      const activeId = getActiveSceneId();
      if (activeId && ScavengerLocationApp.#open.#sceneId !== activeId) {
        await ScavengerLocationApp.#open.#bindScene(activeId);
        void ScavengerLocationApp.#open.render();
      }
      ScavengerLocationApp.#open.bringToFront?.();
      return ScavengerLocationApp.#open;
    }
    const app = new ScavengerLocationApp();
    await app.#bindScene(getActiveSceneId());
    return app.render({ force: true });
  }

  static async closeOpen(): Promise<void> {
    if (ScavengerLocationApp.#open) {
      await ScavengerLocationApp.#open.close();
      ScavengerLocationApp.#open = null;
    }
  }

  protected override async _onClose(options?: object): Promise<void> {
    if (this.#persistDebounce) {
      clearTimeout(this.#persistDebounce);
      this.#persistDebounce = null;
    }
    await this.#persistSceneState();
    const root = this.#rootElement();
    if (root) delete root.dataset.wastelanderBound;
    if (ScavengerLocationApp.#open === this) {
      ScavengerLocationApp.#open = null;
    }
    ScavengerLocationApp.#generating = false;
    return super._onClose(options);
  }

  async #bindScene(sceneId: string | undefined): Promise<void> {
    if (!sceneId) {
      if (this.#sceneId) await this.#persistSceneState();
      this.#sceneId = null;
      const applied = applyScavengerSceneState(null, "");
      this.#form = applied.form;
      this.location = applied.location;
      this.#activeTab = applied.activeTab;
      this.party = applied.party;
      return;
    }

    if (this.#sceneId && this.#sceneId !== sceneId) {
      await this.#persistSceneState();
    }

    const saved = loadScavengerSceneState(sceneId);
    const applied = applyScavengerSceneState(saved, sceneId);
    this.#form = applied.form;
    this.location = applied.location;
    this.#activeTab = applied.activeTab;
    this.party = applied.party;
    this.#sceneId = sceneId;
  }

  async #persistSceneState(options?: { clearPlayerSearch?: boolean }): Promise<void> {
    const sceneId = this.#sceneId ?? getActiveSceneId();
    if (!sceneId) return;
    await persistScavengerSceneState({
      sceneId,
      form: this.#form,
      location: this.location,
      activeTab: this.#activeTab,
      party: this.party,
      clearPlayerSearch: options?.clearPlayerSearch,
    });
  }

  #schedulePersistSceneState(): void {
    if (this.#persistDebounce) clearTimeout(this.#persistDebounce);
    this.#persistDebounce = setTimeout(() => {
      this.#persistDebounce = null;
      void this.#persistSceneState();
    }, 400);
  }

  protected override async _onRender(
    context: Record<string, unknown>,
    options: object,
  ): Promise<void> {
    await super._onRender(context, options);
    const root = this.#rootElement();
    if (!root || root.dataset.wastelanderBound === "1") return;
    root.dataset.wastelanderBound = "1";
    root.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (action === "updateField") {
        ScavengerLocationApp.#onUpdateField.call(this, event, target);
      } else if (action === "toggleParty") {
        ScavengerLocationApp.#onToggleParty.call(this, event, target);
      } else if (action === "toggleProblem") {
        ScavengerLocationApp.#onToggleProblem.call(this, event, target);
      }
    });
    root.addEventListener("dragstart", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const el = target.closest<HTMLElement>("[data-inhabitant-drag]");
      if (!el) return;
      const actorUuid = el.dataset.actorUuid?.trim();
      if (!actorUuid) return;
      void startActorDrag(event, actorUuid);
    });
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
    const scaleOptions = (
      ["tiny", "small", "average", "large"] as LocationScale[]
    ).map((value) => ({
      value,
      label: value.charAt(0).toUpperCase() + value.slice(1),
      selected: value === this.#form.scale,
    }));

    const degreeOptions = (
      ["untouched", "partly", "mostly", "heavily"] as LocationDegree[]
    ).map((value) => ({
      value,
      label: value.charAt(0).toUpperCase() + value.slice(1),
      selected: value === this.#form.degree,
    }));

    const categoryOptions = getCategoryOptions().map((c) => ({
      ...c,
      selected: c.id === this.#form.categoryId,
    }));

    const scale = this.location?.scale ?? this.#form.scale;
    const degree = this.location?.degree ?? this.#form.degree;
    const searchTime = SEARCH_TIME_BY_SCALE[scale];

    const generated = {
      level:
        this.location != null
          ? String(this.location.level)
          : t("WASTELANDER.Scavenging.Generated.NotYet"),
      searchDifficulty:
        this.location?.searchDifficulty ?? getSearchDifficulty(degree),
      searchMinutes: this.location?.searchMinutes ?? searchTime.minutes,
      searchTimeLabel: searchTime.label,
    };

    const rollTableKeys = (
      this.location
        ? getRollTableKeysForLocation(this.location.items)
        : [...SCAVENGING_ROLL_TABLE_KEYS]
    ).filter((k) => k !== "otherFoundItems");
    const rollTableStatus = await getScavengingRollTableStatus(rollTableKeys);
    const lootGridRows = buildLootGridRows(this.location, rollTableStatus.tables);

    const reductionPts = getDegreeReductionPoints(degree, scale);
    const scaleLabel = scale.charAt(0).toUpperCase() + scale.slice(1);
    const reduction = {
      formulaLine: t("WASTELANDER.Scavenging.Tables.ReductionFormula", {
        tinyReduced: reductionPts.tinyReduced,
        degree: reductionPts.degreeLabel,
        scaleMult: reductionPts.scaleMultiplier,
        scale: scaleLabel,
        total: reductionPts.total,
      }),
      hint: t("WASTELANDER.Scavenging.Tables.ReductionHint", {
        total: reductionPts.total,
      }),
    };

    const simulateLoot = (this.location?.lootResults ?? []).filter(
      (r) => r.category !== "junk",
    );

    const otherFound =
      this.#activeTab === "create"
        ? (this.location?.otherFoundRolls ?? []).map((roll) => ({
            d20: roll.d20,
            label: formatLootCategoryLabel(roll.category),
          }))
        : [];

    const inhabitantsAllowed = canHaveInhabitants(scale);
    const inhabitantType =
      this.location?.inhabitants?.type ??
      this.#form.inhabitantType ??
      "raiders";
    if (this.location?.inhabitants) {
      this.#form.inhabitantType = inhabitantType;
      this.#form.problems.inhabitantType = inhabitantType;
    }

    const denizenCatalog = await loadDenizens();
    const denizenCatalogSize = denizenCatalog.length;

    const inhabitantTypeOptions = INHABITANT_TYPE_OPTIONS.map((value) => ({
      value,
      label: t(`WASTELANDER.Scavenging.Inhabitants.Types.${value}`),
      selected: value === inhabitantType,
    }));

    const inh = this.location?.inhabitants;
    const locationLevel = this.location?.level ?? 1;
    const countSummary = inh
      ? formatInhabitantCountSummary(inh, locationLevel)
      : null;
    const isOverseerOverride = inh?.type === "overseerOverride";

    const inhabitantsUi = {
      allowed: inhabitantsAllowed,
      checkboxDisabled: !inhabitantsAllowed,
      typeSelectDisabled:
        !inhabitantsAllowed || !this.#form.problems.inhabitants,
      typeOptions: inhabitantTypeOptions,
      showCount: Boolean(inh),
      showRoster: Boolean(inh) && !isOverseerOverride,
      overseerOverride: isOverseerOverride,
      countSummary,
      roster: (inh?.roster ?? []).map((r) => ({
        name: r.name,
        level: r.level,
        actorUuid: r.foundryUuid ?? null,
        sizeLabel: r.npcSize
          ? t(`WASTELANDER.Scavenging.Inhabitants.Size.${r.npcSize}`)
          : "",
      })),
      denizenDataOk: denizenCatalogSize > 0,
      rosterEmpty:
        Boolean(inh) && !isOverseerOverride && (inh?.roster.length ?? 0) === 0,
    };

    const tabCurrent = this.#activeTab === "current";
    const tabCreate = this.#activeTab === "create";
    const problemsUi = buildProblemsUiContext(this.#form.problems, this.location);
    const sceneDoc = this.#sceneId ? getSceneDocument(this.#sceneId) : undefined;

    return {
      tabCurrent,
      tabCreate,
      generating: ScavengerLocationApp.#generating,
      sceneScope: sceneDoc?.name
        ? t("WASTELANDER.Scavenging.SceneScope", { scene: sceneDoc.name })
        : null,
      current: buildCurrentTabContext(this.location),
      problemsUi,
      party: this.party,
      partyEmpty: this.party.length === 0,
      name: this.#form.name,
      concept: this.#form.concept,
      scaleOptions,
      categoryOptions,
      degreeOptions,
      problems: this.#form.problems,
      generated,
      location: this.location ? { simulateLoot } : null,
      rollTables: {
        rows: lootGridRows,
        allInstalled: rollTableStatus.allInstalled,
        sidebarHint: t("WASTELANDER.Scavenging.Tables.SidebarHint"),
        showMinMax: Boolean(this.location),
        reduction,
      },
      otherFound,
      inhabitantsUi,
    };
  }

  static onSwitchTab(
    this: ScavengerLocationApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const tab = target.dataset.tab as ScavengerTab | undefined;
    if (tab !== "current" && tab !== "create") return;
    if (this.#activeTab === tab) return;
    this.#activeTab = tab;
    void this.#persistSceneState();
    void this.render();
  }

  static onRefreshParty(
    this: ScavengerLocationApp,
    _event: Event,
    _target: HTMLElement,
  ): void {
    const sceneId = this.#sceneId ?? getActiveSceneId();
    const saved = sceneId ? loadScavengerSceneState(sceneId) : null;
    this.party = getPartyActorsOnScene(sceneId);
    if (saved?.partySelections) {
      this.party = this.party.map((row) => ({
        ...row,
        selected: saved.partySelections[row.actorId] ?? row.selected,
      }));
    }
    void this.#persistSceneState();
    void this.render();
  }

  static #onToggleParty(
    this: ScavengerLocationApp,
    event: Event,
    target: HTMLElement,
  ): void {
    const actorId = target.dataset.actorId;
    if (!actorId) return;
    const row = this.party.find((p) => p.actorId === actorId);
    if (row) row.selected = (target as HTMLInputElement).checked;
    void this.#persistSceneState();
  }

  static #onUpdateField(
    this: ScavengerLocationApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const el = target as HTMLInputElement | HTMLSelectElement;
    const field = el.dataset.field as keyof FormState | undefined;
    if (!field) return;
    if (field === "scale") {
      this.#form.scale = el.value as LocationScale;
      if (!canHaveInhabitants(this.#form.scale)) {
        this.#form.problems.inhabitants = false;
      }
      void this.render();
    } else if (field === "categoryId") {
      this.#form.categoryId = el.value as LocationCategoryId;
      void this.render();
    } else if (field === "inhabitantType") {
      this.#form.inhabitantType = el.value as InhabitantType;
      this.#form.problems.inhabitantType = this.#form.inhabitantType;
    } else if (field === "degree") {
      this.#form.degree = el.value as LocationDegree;
      void this.render();
    } else if (field === "name") {
      this.#form.name = el.value;
      this.#schedulePersistSceneState();
      return;
    } else if (field === "concept") {
      this.#form.concept = el.value;
      this.#schedulePersistSceneState();
      return;
    } else if (field === "obstacleType") {
      this.#form.problems.obstacleType = el.value as ObstacleType;
      void this.render();
    } else if (field === "hazardKind") {
      this.#form.problems.hazardKind = el.value as HazardKind;
      void this.render();
    }
    void this.#persistSceneState();
  }

  static #onToggleProblem(
    this: ScavengerLocationApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const key = target.dataset.problem as keyof ScavengerLocationProblems | undefined;
    if (!key || !(key in this.#form.problems)) return;
    (this.#form.problems as Record<string, boolean>)[key] = (
      target as HTMLInputElement
    ).checked;
    if (key === "obstacle" && this.#form.problems.obstacle) {
      this.#form.problems.obstacleType ??= "mechanical";
    }
    if (key === "hazard" && this.#form.problems.hazard) {
      this.#form.problems.hazardKind ??= "ongoing";
    }
    if (key === "obstacle" || key === "hazard" || key === "inhabitants") {
      void this.render();
    }
    void this.#persistSceneState();
  }

  static onToggleObstacleOvercome(
    this: ScavengerLocationApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    if (!this.location?.problems.obstacle) return;
    this.location = {
      ...this.location,
      problems: {
        ...this.location.problems,
        obstacleOvercome: (target as HTMLInputElement).checked,
      },
    };
    void this.#persistSceneState();
    void this.render();
  }

  static async onGenerate(
    this: ScavengerLocationApp,
    _event: Event,
    _target: HTMLElement,
  ): Promise<void> {
    if (ScavengerLocationApp.#generating) return;

    const sceneId = getActiveSceneId() ?? this.#sceneId ?? undefined;
    if (sceneId) this.#sceneId = sceneId;
    const problemsForGenerate = problemsForGeneration(this.#form.problems);

    ScavengerLocationApp.#generating = true;
    const generateBtn =
      _target instanceof HTMLButtonElement ? _target : null;
    if (generateBtn) generateBtn.disabled = true;

    try {
      this.location = await generateScavengerLocation({
        name: this.#form.name.trim() || "Scavenger location",
        concept: this.#form.concept.trim() || undefined,
        scale: this.#form.scale,
        categoryId: this.#form.categoryId,
        degree: this.#form.degree,
        party: this.party,
        problems: {
          ...problemsForGenerate,
          inhabitantType: this.#form.inhabitantType,
        },
        levelOverride: null,
        autoAllocateDegree: getScavengingSettingBoolean(
          SCAVENGING_SETTINGS.autoAllocateDegreeReduction,
        ),
        sceneId,
        animateLevelRoll: true,
        animateInhabitantRoll: problemsForGenerate.inhabitants,
      });

      this.#activeTab = "current";
      this.#form.problems = { ...this.location.problems };
      ui.notifications.info(
        t("WASTELANDER.Scavenging.Notify.Generated", {
          level: this.location.level,
        }),
      );
      for (const warning of this.location.warnings ?? []) {
        ui.notifications.warn(warning);
      }
      await this.#persistSceneState({ clearPlayerSearch: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.notifications.error(
        t("WASTELANDER.Scavenging.Notify.GenerateError", { error: message }),
      );
    } finally {
      ScavengerLocationApp.#generating = false;
      if (generateBtn) generateBtn.disabled = false;
      void this.render();
    }
  }

  static async onSaveJournal(
    this: ScavengerLocationApp,
    _event: Event,
    _target: HTMLElement,
  ): Promise<void> {
    if (!this.location) return;
    try {
      this.location = await saveLocationToJournal(this.location);
      await this.#persistSceneState();
      ui.notifications.info(t("WASTELANDER.Scavenging.Notify.JournalSaved"));
      void this.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.notifications.error(
        t("WASTELANDER.Scavenging.Notify.JournalError", { error: message }),
      );
    }
  }

  static onOpenRollTable(
    this: ScavengerLocationApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const tableId = target.dataset.tableId;
    if (!tableId) return;
    openScavengingRollTable(tableId);
  }

  static onOpenInhabitantActor(
    this: ScavengerLocationApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const actorUuid = target.dataset.actorUuid;
    if (!actorUuid) return;
    void openActorByUuid(actorUuid);
  }

  static onMarkSearchSuccess(
    this: ScavengerLocationApp,
    _event: Event,
    _target: HTMLElement,
  ): void {
    void this.#gmSetSearchOutcome("success");
  }

  static onMarkSearchFail(
    this: ScavengerLocationApp,
    _event: Event,
    _target: HTMLElement,
  ): void {
    void this.#gmSetSearchOutcome("fail");
  }

  static onResetPlayerSearch(
    this: ScavengerLocationApp,
    _event: Event,
    _target: HTMLElement,
  ): void {
    void this.#gmSetSearchOutcome("reset");
  }

  async #gmSetSearchOutcome(
    outcome: "success" | "fail" | "reset",
  ): Promise<void> {
    const sceneId = this.#sceneId ?? getActiveSceneId();
    if (!sceneId) return;
    const result = await executePlayerSearchAction(
      { action: "gmSetSearchOutcome", sceneId, outcome },
      game.user?.id ?? "",
    );
    if (!result.ok) {
      ui.notifications.warn(result.error);
      return;
    }
    const applied = applyScavengerSceneState(result.state, sceneId);
    this.#form = applied.form;
    this.location = applied.location;
    this.#activeTab = applied.activeTab;
    this.party = applied.party;
    void this.render();
    if (outcome === "reset") {
      ScavengerSearchApp.onSceneUpdated(sceneId);
      ui.notifications.info(t("WASTELANDER.Scavenging.PlayerSearch.GmResetSearchDone"));
    } else {
      ui.notifications.info(
        t("WASTELANDER.Scavenging.PlayerSearch.GmOutcomeSet", { outcome }),
      );
    }
  }
}

type CurrentTabContext = {
  empty: boolean;
  name?: string;
  concept?: string;
  scaleLabel?: string;
  categoryLabel?: string;
  degreeLabel?: string;
  generated?: {
    level: string;
    searchDifficulty: number;
    searchMinutes: number;
    searchTimeLabel: string;
  };
  inhabitants?: {
    countSummary: string | null;
    typeLabel: string;
    overseerOverride: boolean;
    rosterEmpty: boolean;
    roster: {
      name: string;
      level: number;
      actorUuid: string | null;
      sizeLabel: string;
    }[];
  } | null;
  hazard: { present: boolean; kindLabel?: string; summary?: string };
  obstacle: {
    present: boolean;
    summary?: string;
    showOvercome: boolean;
    overcome: boolean;
  };
};

function problemSummaryLabelBase() {
  return {
    obstacleTypeLabel: "",
    obstacleSkillLabel: "",
    obstacleOvercomeNote: ` (${t("WASTELANDER.Scavenging.Problems.ObstacleOvercome")})`,
    obstacleNotOvercomeNote: ` (${t("WASTELANDER.Scavenging.Problems.ObstacleNotOvercome")})`,
  };
}

function buildProblemsUiContext(
  formProblems: ScavengerLocationProblems,
  location: ScavengerLocation | null,
) {
  const obstacleType = formProblems.obstacleType ?? "mechanical";
  const hazardKind = formProblems.hazardKind ?? "ongoing";

  let obstacleSummary: string | null = null;
  let hazardSummary: string | null = null;
  if (location) {
    const p = location.problems;
    if (p.obstacle) {
      const type = p.obstacleType ?? "mechanical";
      obstacleSummary = formatObstacleSummary(p, {
        ...problemSummaryLabelBase(),
        obstacleTypeLabel: t(
          `WASTELANDER.Scavenging.Problems.ObstacleTypes.${type}`,
        ),
        obstacleSkillLabel: t(
          `WASTELANDER.Scavenging.Problems.ObstacleSkills.${type}`,
        ),
      });
    }
    if (p.hazard) {
      hazardSummary = formatHazardSummary(p, location.level);
    }
  }

  return {
    showObstacleFields: formProblems.obstacle,
    showHazardFields: formProblems.hazard,
    obstacleTypeOptions: OBSTACLE_TYPES.map((value) => ({
      value,
      label: t(`WASTELANDER.Scavenging.Problems.ObstacleTypes.${value}`),
      selected: value === obstacleType,
    })),
    hazardKindOngoing: hazardKind === "ongoing",
    hazardKindOccasional: hazardKind === "occasional",
    hazardKinds: HAZARD_KINDS,
    obstacleSummary,
    hazardSummary,
    hasGenerated: Boolean(location),
    configureHint: t("WASTELANDER.Scavenging.Problems.ConfigureOnCreate"),
  };
}

function buildCurrentTabContext(
  location: ScavengerLocation | null,
): CurrentTabContext {
  if (!location) {
    return {
      empty: true,
      hazard: { present: false },
      obstacle: { present: false },
    };
  }

  const scaleLabel =
    location.scale.charAt(0).toUpperCase() + location.scale.slice(1);
  const degreeLabel =
    location.degree.charAt(0).toUpperCase() + location.degree.slice(1);
  const category =
    getCategoryOptions().find((c) => c.id === location.categoryId)?.label ??
    location.categoryId;
  const searchTime = SEARCH_TIME_BY_SCALE[location.scale];

  const p = resolveLocationProblems(location.problems, location.level);
  const base = problemSummaryLabelBase();
  const obstacle = {
    present: Boolean(p.obstacle),
    summary: p.obstacle
      ? formatObstacleSummary(p, {
          ...base,
          obstacleTypeLabel: t(
            `WASTELANDER.Scavenging.Problems.ObstacleTypes.${p.obstacleType ?? "mechanical"}`,
          ),
          obstacleSkillLabel: t(
            `WASTELANDER.Scavenging.Problems.ObstacleSkills.${p.obstacleType ?? "mechanical"}`,
          ),
        })
      : undefined,
    showOvercome: Boolean(p.obstacle),
    overcome: Boolean(p.obstacleOvercome),
  };
  const hazardKind = p.hazard
    ? normalizeHazardKind(p, location.level)
    : null;
  const hazard = {
    present: Boolean(p.hazard),
    kindLabel: hazardKind
      ? t(`WASTELANDER.Scavenging.Problems.HazardKinds.${hazardKind}`)
      : undefined,
    summary: p.hazard ? formatHazardSummary(p, location.level) : undefined,
  };

  const inh = location.inhabitants;
  let inhabitants: CurrentTabContext["inhabitants"] = null;
  if (inh) {
    const isOverseerOverride = inh.type === "overseerOverride";
    inhabitants = {
      countSummary: formatInhabitantCountSummary(inh, location.level),
      typeLabel: t(`WASTELANDER.Scavenging.Inhabitants.Types.${inh.type}`),
      overseerOverride: isOverseerOverride,
      rosterEmpty: !isOverseerOverride && inh.roster.length === 0,
      roster: inh.roster.map((r) => ({
        name: r.name,
        level: r.level,
        actorUuid: r.foundryUuid ?? null,
        sizeLabel: r.npcSize
          ? t(`WASTELANDER.Scavenging.Inhabitants.Size.${r.npcSize}`)
          : "",
      })),
    };
  }

  return {
    empty: false,
    name: location.name,
    concept: location.concept,
    scaleLabel,
    categoryLabel: category,
    degreeLabel,
    generated: {
      level: String(location.level),
      searchDifficulty: location.searchDifficulty,
      searchMinutes: location.searchMinutes,
      searchTimeLabel: searchTime.label,
    },
    inhabitants,
    hazard,
    obstacle,
  };
}

type LootGridRow = {
  label: string;
  min: string;
  max: string;
  installed: boolean;
  tableId?: string;
  resultCount?: number;
};

function buildLootGridRows(
  location: ScavengerLocation | null,
  statusRows: ScavengingRollTableStatusRow[],
): LootGridRow[] {
  const statusByKey = new Map(
    statusRows.map((row) => [row.tableKey, row] as const),
  );

  if (!location) {
    return statusRows.map((row) => ({
      label: row.name,
      min: "—",
      max: "—",
      installed: row.installed,
      tableId: row.tableId,
      resultCount: row.resultCount,
    }));
  }

  return location.items
    .map((item) => lootGridRowFromItem(item, statusByKey))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function lootGridRowFromItem(
  item: ItemCategoryRange,
  statusByKey: Map<string, ScavengingRollTableStatusRow>,
): LootGridRow {
  const tableKey = resolveRollTableKey(item.category);
  const label = formatLootCategoryLabel(item.category);
  const status = tableKey ? statusByKey.get(tableKey) : undefined;

  return {
    label,
    min: String(item.min),
    max: String(item.max),
    installed: status?.installed ?? false,
    tableId: status?.tableId,
    resultCount: status?.resultCount,
  };
}

/** Strip resolved-only fields so generation does not pass stale data into rolls. */
function problemsForGeneration(
  problems: ScavengerLocationProblems,
): ScavengerLocationProblems {
  const next: ScavengerLocationProblems = {
    obstacle: problems.obstacle,
    hazard: problems.hazard,
    inhabitants: problems.inhabitants,
  };
  if (problems.obstacle) {
    next.obstacleType = problems.obstacleType ?? "mechanical";
  }
  if (problems.hazard) {
    next.hazardKind = problems.hazardKind ?? "ongoing";
  }
  if (problems.inhabitants) {
    next.inhabitantType = problems.inhabitantType;
  }
  return next;
}

