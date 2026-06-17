import { MODULE_ID, MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import { invokeFalloutPartySleep } from "../integrations/falloutPartySleep.js";
import { getActiveSceneId } from "../scavenging/scenePersist.js";
import { scavengerConfirmDialog } from "../scavenging/scavengerConfirm.js";
import {
  clearHexMapEdits,
  getWorldPoiIcons,
  hexHasMapEdits,
  hideTrailForHex,
  isTrailHiddenForHex,
  resolveTerrainForHex,
  resolveCurrentTravelTerrain,
  setHexAnnotation,
  setHexCoverForEditor,
  setHexPoiIcon,
  toggleHexCoverForEditor,
  unhideTrailForHex,
  normalizeHexCoverColor,
} from "./hexAnnotations.js";
import {
  addWorldPoiIconFromPicker,
  removeWorldPoiIcon,
  resolvePoiIconImageUrl,
} from "./hexPoiCatalog.js";
import {
  clearMapDestination,
  ensureInheritedProgressDestinationCached,
  invalidateInheritedProgressDestination,
  promptForDestinationName,
  progressDestinationDisplayLabel,
  setMapDestination,
} from "./hexMapDestination.js";
import {
  captureHexCoverBrushFromPicker,
  getEffectiveLastHexCoverColor,
  primeHexCoverBrushCache,
  rememberLastHexCoverColor,
  resolveHexCoverPickerColor,
} from "./hexcrawlSettings.js";
import {
  disableHexMapEditor,
  enableHexMapEditor,
  getHexMapEditorSelection,
  setHexMapEditorSelection,
} from "./hexMapEditor.js";
import { clearHexMapEditorSelectionState } from "./hexMapEditorState.js";
import { setStartingLocationForScene } from "./hexcrawlStartingLocation.js";
import { seedLastHexKeyFromTravelToken } from "./hexCoords.js";
import { refreshHexcrawlMapOverlay } from "./hexcrawlMapOverlay.js";
import { stageHexcrawlMapOverlayState } from "./hexMapOverlayState.js";
import { openHexcrawlJournalPage } from "./hexcrawlJournalSync.js";
import {
  appendJourneyLog,
  defaultHexcrawlState,
  ensureStartingHexInTrail,
  loadHexcrawlSceneState,
  resetMilesTraveledCumulative,
  saveHexcrawlSceneState,
  type HexcrawlSceneState,
} from "./hexcrawlScenePersist.js";
import { confirmAndResetMap } from "./resetHexMap.js";
import {
  applyCourseCheckFail,
  applyCourseCheckPass,
  applyOneHexTravelTime,
  buildInitialPartyActorIds,
  confirmAndResetTravel,
  confirmTravelDayEnd,
  courseChecksEnabled,
  courseFailEnabled,
  confirmDayEndEnabled,
  ensureHexGridForScene,
} from "./hexcrawlTravel.js";
import {
  addActorToPartyIds,
  buildPartyMemberRows,
  canAddActorToParty,
  mergePartyActorIdsWithScene,
  removeActorFromPartyIds,
  resolveActorIdFromDrop,
  resolvePartyTravelRoles,
  resolvePartyTravelRolesForState,
  syncPartyTravelState,
} from "./partyTravel.js";
import {
  requestPlayerHexcrawlAction,
  type PlayerHexcrawlSocketAction,
} from "./playerHexcrawlActions.js";
import { formatSceneGridDistanceLabel } from "./sceneGrid.js";
import { applySceneLinkUpdate } from "./sceneBorderTravel.js";
import {
  buildHexcrawlConfigExport,
  downloadHexcrawlConfigExport,
  hexcrawlConfigExportFilename,
  importHexcrawlConfigForScene,
  pickJsonFile,
} from "./hexcrawlSceneConfigTransfer.js";
import {
  clampDifficulty,
  formatHours,
  formatMphWithUnit,
  NAVIGATION_CONDITIONS,
  navigationConditionById,
  normalizeTravelTerrainType,
  TRAVEL_EVENT_MODES,
  TRAVEL_TERRAIN_TYPES,
  type TravelEventMode,
  type TravelTerrainType,
} from "./travelRules.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function formatMilesTraveled(miles: number): string {
  const rounded = Math.round(miles * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

type HexcrawlTab = "scene" | "party" | "map";

export default class HexcrawlTravelApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static #open: HexcrawlTravelApp | null = null;
  static #skipExternalRefresh = false;
  #sceneId: string | null = null;
  #state: HexcrawlSceneState | null = null;
  #persistDebounce: ReturnType<typeof setTimeout> | null = null;
  #activeTab: HexcrawlTab = "scene";
  #playerView = false;
  #selectedHexKey: string | null = null;

  static override DEFAULT_OPTIONS = {
    id: "wastelander-hexcrawl-travel",
    classes: ["wastelander-wizard", "wastelander-hexcrawl-app"],
    window: {
      title: "WASTELANDER.Hexcrawl.WindowTitle",
      icon: "fa-solid fa-map",
    },
    position: { width: 520, height: 890 },
    actions: {
      coursePass: HexcrawlTravelApp.onCoursePass,
      courseFail: HexcrawlTravelApp.onCourseFail,
      confirmDayEnd: HexcrawlTravelApp.onConfirmDayEnd,
      markArrival: HexcrawlTravelApp.onMarkArrival,
      resumeTravel: HexcrawlTravelApp.onResumeTravel,
      setStartingLocation: HexcrawlTravelApp.onSetStartingLocation,
      resetMap: HexcrawlTravelApp.onResetMap,
      resetTravel: HexcrawlTravelApp.onResetTravel,
      openJournal: HexcrawlTravelApp.onOpenJournal,
      clearJournal: HexcrawlTravelApp.onClearJournal,
      switchTab: HexcrawlTravelApp.onSwitchTab,
      removePartyMember: HexcrawlTravelApp.onRemovePartyMember,
      setMapPoiIcon: HexcrawlTravelApp.onSetMapPoiIcon,
      addMapPoiIcon: HexcrawlTravelApp.onAddMapPoiIcon,
      removeMapPoiIcon: HexcrawlTravelApp.onRemoveMapPoiIcon,
      setMapDestination: HexcrawlTravelApp.onSetMapDestination,
      clearMapDestination: HexcrawlTravelApp.onClearMapDestination,
      toggleMapHexCover: HexcrawlTravelApp.onToggleMapHexCover,
      hideMapTrail: HexcrawlTravelApp.onHideMapTrail,
      showMapTrail: HexcrawlTravelApp.onShowMapTrail,
      clearMapHex: HexcrawlTravelApp.onClearMapHex,
      markLost: HexcrawlTravelApp.onMarkLost,
      exportSceneConfig: HexcrawlTravelApp.onExportSceneConfig,
      importSceneConfig: HexcrawlTravelApp.onImportSceneConfig,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/hexcrawl/travel.hbs`,
    },
  };

  static async renderOpen(): Promise<void> {
    const sceneId = getActiveSceneId();
    if (!sceneId) {
      ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.NoScene"));
      return;
    }

    const isOverseer = currentUserIsOverseer();
    if (!isOverseer) {
      const loaded = loadHexcrawlSceneState(sceneId);
      if (!loaded?.enabled) {
        ui.notifications.warn(t("WASTELANDER.Hexcrawl.PlayerParty.NotEnabled"));
        return;
      }
    }

    try {
      primeHexCoverBrushCache();
      if (HexcrawlTravelApp.#open) {
        HexcrawlTravelApp.#open.#playerView = !isOverseer;
        if (HexcrawlTravelApp.#open.#playerView) {
          HexcrawlTravelApp.#open.#activeTab = "party";
        }
        await HexcrawlTravelApp.#open.#bindScene(sceneId);
        return HexcrawlTravelApp.#open.render(true);
      }

      const app = new HexcrawlTravelApp();
      app.#playerView = !isOverseer;
      if (app.#playerView) app.#activeTab = "party";
      HexcrawlTravelApp.#open = app;
      await app.#bindScene(sceneId);
      return app.render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | hexcrawl travel app failed to open`, error);
      ui.notifications.error(t("WASTELANDER.Hexcrawl.Notify.OpenFailed"));
      HexcrawlTravelApp.#open = null;
    }
  }

  static rebindForScene(sceneId: string, options?: { force?: boolean }): void {
    if (HexcrawlTravelApp.#skipExternalRefresh) return;
    const app = HexcrawlTravelApp.#open;
    if (!app || app.#sceneId !== sceneId) return;

    const loaded = loadHexcrawlSceneState(sceneId);
    if (
      !options?.force &&
      app.#state &&
      loaded &&
      app.#state.updatedAt >= loaded.updatedAt
    ) {
      return;
    }

    app.#cancelPersistDebounce();
    void app.#bindScene(sceneId).then(() => app.render());
  }

  #rootElement(): HTMLElement | null {
    const el = this.element;
    if (el instanceof HTMLElement) return el;
    if (Array.isArray(el) && el[0] instanceof HTMLElement) return el[0];
    return null;
  }

  protected override async _onRender(
    context: Record<string, unknown>,
    options: object,
  ): Promise<void> {
    await super._onRender(context, options);
    const root = this.#rootElement();
    if (!root) return;
    if (root.dataset.wastelanderHexcrawlBound !== "1") {
      root.dataset.wastelanderHexcrawlBound = "1";
      root.addEventListener("change", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.dataset.field) {
          void this.#onUpdateField(event, target);
        }
      });
      root.addEventListener("input", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.dataset.field !== "hexCoverBrushColor") return;
        this.#onHexCoverColorInput(target.value);
      });
      root.addEventListener("dragover", (event) => {
        const zone = (event.target as HTMLElement).closest("[data-hexcrawl-party-drop]");
        if (!zone) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        zone.classList.add("is-dragover");
      });
      root.addEventListener("dragleave", (event) => {
        const zone = (event.target as HTMLElement).closest("[data-hexcrawl-party-drop]");
        if (!zone) return;
        const related = event.relatedTarget as Node | null;
        if (related && zone.contains(related)) return;
        zone.classList.remove("is-dragover");
      });
      root.addEventListener("drop", (event) => {
        void this.#handlePartyDrop(event);
      });
    }
    this.#syncMapEditorMode();
    this.#fixHexCoverPickerIfInvalid();
  }

  #onHexCoverColorInput(raw: string): void {
    const color = normalizeHexCoverColor(raw.trim());
    if (!color) return;
    rememberLastHexCoverColor(color);

    const hexKey = this.#resolveMapEditHexKey();
    if (!hexKey || !this.#state?.hexAnnotations[hexKey]?.hexCoverColor) return;

    void this.#mutateMap(
      (state) => setHexCover(state, hexKey, color),
      { render: false },
    );
  }

  /** Browsers show black when the color input value is empty/invalid after re-render. */
  #fixHexCoverPickerIfInvalid(): void {
    const input = this.#rootElement()?.querySelector<HTMLInputElement>(
      "#hexcrawl-map-hex-cover-color",
    );
    if (!input || normalizeHexCoverColor(input.value)) return;

    const hexKey = this.#selectedHexKey;
    const onHex = hexKey ? this.#state?.hexAnnotations[hexKey]?.hexCoverColor : undefined;
    input.value = resolveHexCoverPickerColor(onHex);
  }

  #resolveMapEditHexKey(): string | null {
    return (
      this.#selectedHexKey ??
      this.#state?.lastHexKey ??
      this.#state?.startingHexKey ??
      null
    );
  }

  #selectMapHex(hexKey: string | null): void {
    this.#selectedHexKey = hexKey;
    if (this.#sceneId && hexKey) {
      setHexMapEditorSelection(this.#sceneId, hexKey);
    }
  }

  #syncMapEditorMode(): void {
    if (!this.#sceneId || this.#playerView || this.#activeTab !== "map") {
      disableHexMapEditor();
      return;
    }

    if (!this.#selectedHexKey) {
      const seed = this.#state?.lastHexKey ?? this.#state?.startingHexKey ?? null;
      if (seed) this.#selectMapHex(seed);
    }

    enableHexMapEditor(this.#sceneId, (hexKey) => {
      const prevKey = this.#selectedHexKey;
      if (prevKey && !this.#state?.hexAnnotations[prevKey]?.hexCoverColor) {
        captureHexCoverBrushFromPicker(this.#rootElement());
      }
      this.#selectMapHex(hexKey);
      void this.render(true);
    });
    if (this.#selectedHexKey) {
      if (getHexMapEditorSelection(this.#sceneId) !== this.#selectedHexKey) {
        setHexMapEditorSelection(this.#sceneId, this.#selectedHexKey);
      }
    }
  }

  override get title(): string {
    if (this.#playerView) {
      const scene = this.#sceneId ? game.scenes.get(this.#sceneId) : null;
      const name = scene?.name?.trim();
      return name
        ? t("WASTELANDER.Hexcrawl.PlayerParty.WindowTitleScene", { scene: name })
        : t("WASTELANDER.Hexcrawl.PlayerParty.WindowTitle");
    }
    const scene = this.#sceneId ? game.scenes.get(this.#sceneId) : null;
    const name = scene?.name?.trim();
    return name
      ? t("WASTELANDER.Hexcrawl.WindowTitleScene", { scene: name })
      : t("WASTELANDER.Hexcrawl.WindowTitle");
  }

  async #bindScene(sceneId: string): Promise<void> {
    this.#sceneId = sceneId;
    const loaded = loadHexcrawlSceneState(sceneId);
    const base = loaded ?? defaultHexcrawlState(sceneId);
    const sceneParty = buildInitialPartyActorIds(sceneId);
    let next = {
      ...base,
      partyActorIds: mergePartyActorIdsWithScene(base.partyActorIds, sceneParty),
    };
    next = syncPartyTravelState(next, sceneId);
    next = this.#withTravelTokenSync(next);
    const cached = currentUserIsOverseer()
      ? ensureInheritedProgressDestinationCached(next)
      : { state: next, changed: false };
    next = cached.state;
    this.#state = next;
    // Only auto-persist when a flag already exists. Creating a flag here races with
    // the enable checkbox and can overwrite enabled: true.
    if (
      loaded &&
      currentUserIsOverseer() &&
      (cached.changed ||
        next.travelTokenId !== loaded.travelTokenId ||
        next.maxHoursPerDay !== loaded.maxHoursPerDay ||
        next.navigatorActorId !== loaded.navigatorActorId ||
        next.partyActorIds.join() !== loaded.partyActorIds.join())
    ) {
      await this.#persistNow();
    }
  }

  #schedulePersist(): void {
    if (this.#persistDebounce) clearTimeout(this.#persistDebounce);
    this.#persistDebounce = setTimeout(() => {
      this.#persistDebounce = null;
      void this.#persistNow();
    }, 300);
  }

  #cancelPersistDebounce(): void {
    if (this.#persistDebounce) {
      clearTimeout(this.#persistDebounce);
      this.#persistDebounce = null;
    }
  }

  async #persistPartyState(state: HexcrawlSceneState): Promise<boolean> {
    if (!this.#sceneId) return false;
    const payload: PlayerHexcrawlSocketAction = {
      action: "updateHexcrawlParty",
      sceneId: this.#sceneId,
      partyActorIds: state.partyActorIds,
    };

    if (currentUserIsOverseer()) {
      this.#state = state;
      await this.#persistNow();
      return true;
    }

    const result = await requestPlayerHexcrawlAction(payload);
    if (!result.ok) {
      ui.notifications.warn(
        t("WASTELANDER.Hexcrawl.PlayerParty.UpdateFailed", {
          error: result.error,
        }),
      );
      const loaded = loadHexcrawlSceneState(this.#sceneId);
      if (loaded) this.#state = loaded;
      return false;
    }
    this.#state = result.state;
    return true;
  }

  async #persistNow(): Promise<void> {
    if (!this.#state || !this.#sceneId) return;
    HexcrawlTravelApp.#skipExternalRefresh = true;
    try {
      const saved = await saveHexcrawlSceneState(this.#state);
      if (saved) this.#state = saved;
    } catch (error) {
      console.error(`${MODULE_ID} | hexcrawl travel save failed`, error);
      ui.notifications.error(t("WASTELANDER.Hexcrawl.Notify.SaveFailed"));
      throw error;
    } finally {
      HexcrawlTravelApp.#skipExternalRefresh = false;
    }
  }

  async #mutate(
    mutator: (state: HexcrawlSceneState) => HexcrawlSceneState,
    options?: { render?: boolean },
  ): Promise<void> {
    if (!this.#state) return;
    this.#state = mutator(this.#state);
    await this.#persistNow();
    if (options?.render !== false) {
      await this.render();
    }
  }

  async #mutateMap(
    mutator: (state: HexcrawlSceneState) => HexcrawlSceneState,
    options?: { render?: boolean },
  ): Promise<void> {
    await this.#mutate(mutator, options);
    if (this.#sceneId && this.#state) {
      await refreshHexcrawlMapOverlay(this.#sceneId, this.#state);
    }
  }

  #withTravelTokenSync(state: HexcrawlSceneState): HexcrawlSceneState {
    const sceneId = this.#sceneId;
    if (!sceneId) return state;
    const lastHexKey = seedLastHexKeyFromTravelToken(state, sceneId);
    return lastHexKey ? { ...state, lastHexKey } : state;
  }

  protected override async _prepareContext(): Promise<Record<string, unknown>> {
    const state = this.#state ?? defaultHexcrawlState(this.#sceneId ?? "");
    const isOverseer = !this.#playerView;
    const userId = game.user?.id ?? "";
    const partyRoles = resolvePartyTravelRolesForState(state);
    const currentTerrain = resolveCurrentTravelTerrain(state);
    const currentTerrainLabel = t(`WASTELANDER.Hexcrawl.TerrainTypes.${currentTerrain}`);
    const milesTraveledLabel = formatMilesTraveled(state.milesTraveledCumulative);
    const selectedHexKey = this.#selectedHexKey;
    const selectedHexAnnotation = selectedHexKey
      ? state.hexAnnotations[selectedHexKey]
      : undefined;
    const selectedHexTerrain = selectedHexKey
      ? resolveTerrainForHex(state, selectedHexKey)
      : null;
    const selectedHexMph = selectedHexKey
      ? formatMphWithUnit(
          resolvePartyTravelRoles(
            state.partyActorIds,
            selectedHexTerrain ?? state.terrainType,
          ).partyMph,
        )
      : null;
    const selectedHexTerrainLabel = selectedHexTerrain
      ? t(`WASTELANDER.Hexcrawl.TerrainTypes.${selectedHexTerrain}`)
      : null;
    const mapHexTerrainOptions = [
      {
        value: "",
        label: t("WASTELANDER.Hexcrawl.MapUseDefaultTerrain"),
        selected: !selectedHexAnnotation?.terrain,
      },
      ...TRAVEL_TERRAIN_TYPES.map((terrain) => ({
        value: terrain,
        label: t(`WASTELANDER.Hexcrawl.TerrainTypes.${terrain}`),
        selected: selectedHexAnnotation?.terrain === terrain,
      })),
    ];
    const mapPoiIcons = getWorldPoiIcons().map((icon) => ({
      id: icon.id,
      label: icon.label,
      imageUrl: resolvePoiIconImageUrl(icon.path),
      selected: selectedHexAnnotation?.iconId === icon.id,
    }));
    const partyRows = buildPartyMemberRows(state, {
      sceneId: this.#sceneId,
      userId,
      isOverseer,
    });

    const navigationOptions = NAVIGATION_CONDITIONS.map((row) => ({
      ...row,
      selected: state.navigationConditionId === row.id,
    }));

    const travelEventModeOptions = TRAVEL_EVENT_MODES.map((mode) => ({
      value: mode,
      label: t(`WASTELANDER.Hexcrawl.TravelEventMode.${mode}`),
      selected: state.travelEventMode === mode,
    }));

    const terrainTypeOptions = TRAVEL_TERRAIN_TYPES.map((terrain) => ({
      value: terrain,
      label: t(`WASTELANDER.Hexcrawl.TerrainTypes.${terrain}`),
      selected: state.terrainType === terrain,
    }));

    const sceneOptions = game.scenes
      .filter((scene) => scene.id !== this.#sceneId)
      .map((scene) => ({ id: scene.id, name: scene.name }));

    const sceneLinkRows = (
      [
        { direction: "north", label: t("WASTELANDER.Hexcrawl.SceneLinkNorth") },
        { direction: "south", label: t("WASTELANDER.Hexcrawl.SceneLinkSouth") },
        { direction: "east", label: t("WASTELANDER.Hexcrawl.SceneLinkEast") },
        { direction: "west", label: t("WASTELANDER.Hexcrawl.SceneLinkWest") },
      ] as const
    ).map((row) => ({
      direction: row.direction,
      label: row.label,
      options: sceneOptions.map((scene) => ({
        ...scene,
        selected: state.sceneLinks[row.direction] === scene.id,
      })),
    }));

    const courseStatusLabel =
      state.courseStatus === "lost"
        ? t("WASTELANDER.Hexcrawl.CourseStatus.Lost")
        : t("WASTELANDER.Hexcrawl.CourseStatus.OnCourse");

    const progressDestinationLabel = progressDestinationDisplayLabel(
      this.#sceneId,
      state,
      t("WASTELANDER.Hexcrawl.DestinationNotSet"),
    );

    return {
      state,
      isOverseer,
      showPartyPanel: !isOverseer || this.#activeTab === "party",
      showMapPanel: isOverseer && this.#activeTab === "map",
      partyRows,
      navigationOptions,
      travelEventModeOptions,
      terrainTypeOptions,
      sceneLinkRows,
      sceneGridDistanceLabel: this.#sceneId
        ? formatSceneGridDistanceLabel(this.#sceneId)
        : "—",
      partyMph: formatMphWithUnit(partyRoles.partyMph),
      paceActorName: partyRoles.paceName,
      hoursActorName: partyRoles.hoursActorName,
      currentTerrainLabel,
      milesTraveledLabel,
      hoursTodayLabel: formatHours(state.hoursTraveledToday),
      courseStatusLabel,
      courseStatusClass:
        state.courseStatus === "lost"
          ? "wastelander-hexcrawl-lost"
          : "wastelander-hexcrawl-on-course",
      courseChecksEnabled: courseChecksEnabled(state),
      courseFailEnabled: courseFailEnabled(state),
      markLostEnabled: state.courseStatus !== "lost",
      confirmDayEndEnabled: confirmDayEndEnabled(state),
      journalReady: Boolean(state.enabled),
      journalHasEntries: state.journeyLog.length > 0,
      startingHexLabel: state.startingHexKey ?? "—",
      lastHexLabel: state.lastHexKey ?? "—",
      tabScene: this.#activeTab === "scene",
      tabParty: this.#activeTab === "party",
      tabMap: this.#activeTab === "map",
      selectedHexKey,
      selectedHexTerrainLabel,
      selectedHexMph,
      mapHexTerrainOptions,
      mapPoiIcons,
      mapTrailHidden: selectedHexKey
        ? isTrailHiddenForHex(state, selectedHexKey)
        : false,
      mapHexCoverActive: Boolean(selectedHexAnnotation?.hexCoverColor),
      mapHexCoverPickerColor: resolveHexCoverPickerColor(selectedHexAnnotation?.hexCoverColor),
      mapHexCoverPreviewColor: resolveHexCoverPickerColor(selectedHexAnnotation?.hexCoverColor),
      progressDestinationLabel,
      mapDestinationName: state.mapDestination?.name ?? null,
      mapDestinationHex: state.mapDestination?.hexKey ?? null,
      mapDestinationOnSelectedHex:
        Boolean(selectedHexKey && state.mapDestination?.hexKey === selectedHexKey),
      strings: {
        enableLabel: t("WASTELANDER.Hexcrawl.EnableLabel"),
        showHexCoords: t("WASTELANDER.Hexcrawl.ShowHexCoords"),
        tabScene: t("WASTELANDER.Hexcrawl.Tabs.Scene"),
        tabParty: t("WASTELANDER.Hexcrawl.Tabs.Party"),
        tabMap: t("WASTELANDER.Hexcrawl.Tabs.Map"),
        mapTabHint: t("WASTELANDER.Hexcrawl.MapTabHint"),
        mapSelectedHex: t("WASTELANDER.Hexcrawl.MapSelectedHex"),
        mapTerrain: t("WASTELANDER.Hexcrawl.MapTerrain"),
        mapUseDefaultTerrain: t("WASTELANDER.Hexcrawl.MapUseDefaultTerrain"),
        mapHideTrail: t("WASTELANDER.Hexcrawl.MapHideTrail"),
        mapShowTrail: t("WASTELANDER.Hexcrawl.MapShowTrail"),
        mapPoiIcon: t("WASTELANDER.Hexcrawl.MapPoiIcon"),
        mapPoiIconHint: t("WASTELANDER.Hexcrawl.MapPoiIconHint"),
        mapAddPoiIcon: t("WASTELANDER.Hexcrawl.MapAddPoiIcon"),
        mapNoPoiIcons: t("WASTELANDER.Hexcrawl.MapNoPoiIcons"),
        mapRemovePoiIcon: t("WASTELANDER.Hexcrawl.MapRemovePoiIcon"),
        mapDestination: t("WASTELANDER.Hexcrawl.MapDestination"),
        mapDestinationHint: t("WASTELANDER.Hexcrawl.MapDestinationHint"),
        setMapDestination: t("WASTELANDER.Hexcrawl.SetMapDestination"),
        clearMapDestination: t("WASTELANDER.Hexcrawl.ClearMapDestination"),
        mapHexCover: t("WASTELANDER.Hexcrawl.MapHexCover"),
        mapHexCoverHint: t("WASTELANDER.Hexcrawl.MapHexCoverHint"),
        mapHexCoverColor: t("WASTELANDER.Hexcrawl.MapHexCoverColor"),
        mapClearHex: t("WASTELANDER.Hexcrawl.MapClearHex"),
        mapEffectiveMph: t("WASTELANDER.Hexcrawl.MapEffectiveMph"),
        mapShowTerrainIcons: t("WASTELANDER.Hexcrawl.MapShowTerrainIcons"),
        terrain: t("WASTELANDER.Hexcrawl.Terrain"),
        milesTraveled: t("WASTELANDER.Hexcrawl.MilesTraveled"),
        markLost: t("WASTELANDER.Hexcrawl.MarkLost"),
        terrainType: t("WASTELANDER.Hexcrawl.DefaultTerrain"),
        terrainTypeHint: t("WASTELANDER.Hexcrawl.DefaultTerrainHint"),
        travelSettings: t("WASTELANDER.Hexcrawl.TravelSettings"),
        sceneGridDistance: t("WASTELANDER.Hexcrawl.SceneGridDistance"),
        travelEvents: t("WASTELANDER.Hexcrawl.TravelEvents"),
        trailOverlayColor: t("WASTELANDER.Hexcrawl.TrailOverlayColor"),
        trailOverlayColorHint: t("WASTELANDER.Hexcrawl.TrailOverlayColorHint"),
        sceneConnections: t("WASTELANDER.Hexcrawl.SceneConnections"),
        sceneConnectionsHint: t("WASTELANDER.Hexcrawl.SceneConnectionsHint"),
        sceneLinkNone: t("WASTELANDER.Hexcrawl.SceneLinkNone"),
        currentMph: t("WASTELANDER.Hexcrawl.CurrentMph"),
        partyDropHint: t("WASTELANDER.Hexcrawl.PartyDropHint"),
        removeMember: t("WASTELANDER.Hexcrawl.RemovePartyMember"),
        roleNavigator: t("WASTELANDER.Hexcrawl.RoleNavigator"),
        rolePace: t("WASTELANDER.Hexcrawl.RolePace"),
        roleMaxHours: t("WASTELANDER.Hexcrawl.RoleMaxHours"),
        navigation: t("WASTELANDER.Hexcrawl.Navigation"),
        navigationCondition: t("WASTELANDER.Hexcrawl.NavigationCondition"),
        difficulty: t("WASTELANDER.Hexcrawl.Difficulty"),
        progress: t("WASTELANDER.Hexcrawl.Progress"),
        destination: t("WASTELANDER.Hexcrawl.Destination"),
        destinationFromLinked: t("WASTELANDER.Hexcrawl.DestinationFromLinked"),
        travelDay: t("WASTELANDER.Hexcrawl.TravelDay"),
        hoursToday: t("WASTELANDER.Hexcrawl.HoursToday"),
        lastHex: t("WASTELANDER.Hexcrawl.LastHex"),
        startingHex: t("WASTELANDER.Hexcrawl.StartingHex"),
        pendingDayEnd: t("WASTELANDER.Hexcrawl.PendingDayEnd"),
        coursePass: t("WASTELANDER.Hexcrawl.CoursePass"),
        courseFail: t("WASTELANDER.Hexcrawl.CourseFail"),
        confirmDayEnd: t("WASTELANDER.Hexcrawl.SetCamp"),
        markArrival: t("WASTELANDER.Hexcrawl.MarkArrival"),
        arrived: t("WASTELANDER.Hexcrawl.Arrived"),
        resumeTravel: t("WASTELANDER.Hexcrawl.ResumeTravel"),
        setStartingLocation: t("WASTELANDER.Hexcrawl.SetStartingLocation"),
        resetTravel: t("WASTELANDER.Hexcrawl.ResetTravel"),
        resetMap: t("WASTELANDER.Hexcrawl.ResetMap"),
        openJournal: t("WASTELANDER.Hexcrawl.OpenJournal"),
        clearJournal: t("WASTELANDER.Hexcrawl.Journal.Clear"),
        exportSceneConfig: t("WASTELANDER.Hexcrawl.ExportImport.Export"),
        importSceneConfig: t("WASTELANDER.Hexcrawl.ExportImport.Import"),
      },
    };
  }

  #onUpdateField(_event: Event, target: HTMLElement): void {
    const el = target as HTMLInputElement | HTMLSelectElement;
    const field = el.dataset.field;
    if (!field || !currentUserIsOverseer()) return;

    switch (field) {
      case "enabled":
        void this.#onToggleEnabled(_event, el as HTMLInputElement).catch((error) => {
          console.error(`${MODULE_ID} | hexcrawl enable toggle failed`, error);
          ui.notifications.error(t("WASTELANDER.Hexcrawl.Notify.SaveFailed"));
          void this.render();
        });
        break;
      case "travelEventMode": {
        const travelEventMode = el.value as TravelEventMode;
        if (travelEventMode !== "hexEntry" && travelEventMode !== "hourChange") return;
        void this.#mutate((state) => ({ ...state, travelEventMode }));
        break;
      }
      case "terrainType": {
        const terrainType = normalizeTravelTerrainType(el.value) as TravelTerrainType;
        void this.#mutate((state) => ({ ...state, terrainType }));
        break;
      }
      case "navigationConditionId": {
        const condition = navigationConditionById(el.value);
        if (!condition) return;
        void this.#mutate((state) => ({
          ...state,
          navigationConditionId: condition.id,
          baseDifficulty: condition.baseDifficulty,
          currentDifficulty:
            state.courseStatus === "onCourse"
              ? condition.baseDifficulty
              : clampDifficulty(state.currentDifficulty),
        }));
        break;
      }
      case "trailOverlayColor": {
        const color = el.value.trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
        void this.#mutate((state) => ({ ...state, trailOverlayColor: color.toLowerCase() }));
        break;
      }
      case "mapHexTerrain": {
        const hexKey = this.#resolveMapEditHexKey();
        if (!hexKey) {
          ui.notifications.warn(t("WASTELANDER.Hexcrawl.MapSelectHexFirst"));
          return;
        }
        const value = el.value.trim();
        void this.#mutateMap((state) =>
          setHexAnnotation(
            state,
            hexKey,
            value ? { terrain: normalizeTravelTerrainType(value) } : { terrain: undefined },
          ),
        );
        break;
      }
      case "hexCoverBrushColor": {
        const color = normalizeHexCoverColor(el.value);
        if (!color) return;
        rememberLastHexCoverColor(color);
        const hexKey = this.#resolveMapEditHexKey();
        if (!hexKey) return;
        if (this.#state?.hexAnnotations[hexKey]?.hexCoverColor) {
          void this.#mutateMap((state) => setHexCoverForEditor(state, hexKey, color));
        }
        break;
      }
      case "showTerrainIcons": {
        const showTerrainIcons = (el as HTMLInputElement).checked;
        void this.#mutateMap(
          (state) => ({ ...state, showTerrainIcons }),
          { render: false },
        );
        void this.render();
        break;
      }
      case "showHexCoords": {
        const showHexCoords = (el as HTMLInputElement).checked;
        void this.#mutateMap(
          (state) => ({ ...state, showHexCoords }),
          { render: false },
        );
        void this.render();
        break;
      }
      default: {
        if (!field.startsWith("sceneLinks.") || !this.#sceneId) break;
        void this.#mutate((state) => {
          const withLinks = {
            ...invalidateInheritedProgressDestination(state),
            sceneLinks: applySceneLinkUpdate(
              state.sceneLinks,
              field,
              el.value,
              this.#sceneId ?? "",
            ),
          };
          return ensureInheritedProgressDestinationCached(withLinks).state;
        });
        break;
      }
    }
  }

  async #onToggleEnabled(_event: Event, target: HTMLInputElement): Promise<void> {
    const enabled = target.checked;
    await this.#mutate((state) => {
      let next = appendJourneyLog(
        { ...state, enabled, arrived: enabled ? false : state.arrived },
        {
          kind: enabled ? "enabled" : "disabled",
          travelDay: state.travelDay,
        },
      );
      if (enabled) next = this.#withTravelTokenSync(next);
      if (enabled) next = ensureStartingHexInTrail(next);
      return next;
    });
    if (enabled && this.#sceneId && this.#state) {
      await ensureHexGridForScene(this.#sceneId);
    }
  }

  async #handlePartyDrop(event: DragEvent): Promise<void> {
    const zone = (event.target as HTMLElement).closest("[data-hexcrawl-party-drop]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove("is-dragover");

    const actorId = await resolveActorIdFromDrop(event);
    if (!actorId) return;

    const userId = game.user?.id ?? "";
    if (!canAddActorToParty(actorId, this.#sceneId, userId)) {
      ui.notifications.warn(t("WASTELANDER.Hexcrawl.PlayerParty.InvalidMember"));
      return;
    }

    if (this.#state?.partyActorIds.includes(actorId)) {
      ui.notifications.info(t("WASTELANDER.Hexcrawl.PartyMemberAlready"));
      return;
    }

    void this.#mutateParty((state) =>
      syncPartyTravelState(
        {
          ...state,
          partyActorIds: addActorToPartyIds(state.partyActorIds, actorId),
        },
        this.#sceneId ?? "",
      ),
    );
  }

  static onRemovePartyMember(
    this: HexcrawlTravelApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const actorId = target.dataset.actorId;
    if (!actorId || !this.#state) return;

    const userId = game.user?.id ?? "";
    const row = buildPartyMemberRows(this.#state, {
      sceneId: this.#sceneId,
      userId,
      isOverseer: !this.#playerView,
    }).find((member) => member.actorId === actorId);
    if (!row?.canRemove) return;

    void this.#mutateParty((state) =>
      syncPartyTravelState(
        {
          ...state,
          partyActorIds: removeActorFromPartyIds(state.partyActorIds, actorId),
        },
        this.#sceneId ?? "",
      ),
    );
  }

  async #mutateParty(
    mutator: (state: HexcrawlSceneState) => HexcrawlSceneState,
  ): Promise<void> {
    if (!this.#state) return;
    const next = mutator(this.#state);
    await this.#persistPartyState(next);
    await this.render();
  }

  async #applyCourseCheck(kind: "pass" | "fail"): Promise<void> {
    if (!this.#state || !this.#sceneId) return;
    if (kind === "pass" && !courseChecksEnabled(this.#state)) return;
    if (kind === "fail" && !courseFailEnabled(this.#state)) return;

    const wasLost = this.#state.courseStatus === "lost";
    let next =
      kind === "pass"
        ? applyCourseCheckPass(this.#state)
        : applyCourseCheckFail(this.#state);

    if (wasLost || kind === "fail") {
      next = await applyOneHexTravelTime(next, this.#sceneId);
    }

    this.#state = next;
    await this.#persistNow();
    await this.render();
  }

  static onCoursePass(this: HexcrawlTravelApp): void {
    if (!currentUserIsOverseer()) return;
    void this.#applyCourseCheck("pass");
  }

  static onCourseFail(this: HexcrawlTravelApp): void {
    if (!currentUserIsOverseer()) return;
    void this.#applyCourseCheck("fail");
  }

  static async onConfirmDayEnd(this: HexcrawlTravelApp): Promise<void> {
    if (!currentUserIsOverseer()) return;
    if (!this.#state || !confirmDayEndEnabled(this.#state)) return;

    const opened = await invokeFalloutPartySleep();
    if (!opened) {
      ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.PartySleepUnavailable"));
    }

    await this.#mutate((state) => confirmTravelDayEnd(state));
  }

  static onMarkArrival(this: HexcrawlTravelApp): void {
    if (!currentUserIsOverseer()) return;
    void this.#mutate((state) => {
      const next = appendJourneyLog(
        resetMilesTraveledCumulative({ ...state, arrived: true }),
        { kind: "arrival", travelDay: state.travelDay },
      );
      return next;
    });
  }

  static onMarkLost(this: HexcrawlTravelApp): void {
    if (!currentUserIsOverseer()) return;
    void this.#mutate((state) => {
      if (state.courseStatus === "lost") return state;
      return applyCourseCheckFail(state);
    });
  }

  static onResumeTravel(this: HexcrawlTravelApp): void {
    if (!currentUserIsOverseer()) return;
    void this.#mutate((state) => ({ ...state, arrived: false }));
  }

  static async onOpenJournal(this: HexcrawlTravelApp): Promise<void> {
    if (!this.#sceneId) return;
    await openHexcrawlJournalPage(this.#sceneId);
  }

  static async onClearJournal(this: HexcrawlTravelApp): Promise<void> {
    if (!currentUserIsOverseer()) return;
    if (!this.#state?.journeyLog.length) return;

    const proceed = await scavengerConfirmDialog(
      t("WASTELANDER.Hexcrawl.Journal.ClearConfirmTitle"),
      t("WASTELANDER.Hexcrawl.Journal.ClearConfirmBody"),
    );
    if (!proceed) return;

    this.#cancelPersistDebounce();
    await this.#mutate((state) => ({
      ...state,
      journeyLog: [],
      traveledHexKeys: [],
      trailCleared: true,
    }));
    ui.notifications.info(t("WASTELANDER.Hexcrawl.Notify.JournalCleared"));
  }

  static onExportSceneConfig(this: HexcrawlTravelApp, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!currentUserIsOverseer()) return;
    if (!this.#sceneId) return;

    const scene = game.scenes?.get(this.#sceneId);
    if (!scene) return;

    const bundle = buildHexcrawlConfigExport(this.#sceneId);
    if (!bundle) {
      ui.notifications.error(t("WASTELANDER.Hexcrawl.Notify.NoScene"));
      return;
    }

    downloadHexcrawlConfigExport(bundle, hexcrawlConfigExportFilename(scene.name));
    ui.notifications.info(
      t("WASTELANDER.Hexcrawl.ExportImport.ExportSuccess", { scene: scene.name }),
    );
  }

  static async onImportSceneConfig(this: HexcrawlTravelApp): Promise<void> {
    if (!currentUserIsOverseer()) return;
    if (!this.#sceneId) return;

    const scene = game.scenes?.get(this.#sceneId);
    if (!scene) return;

    const proceed = await scavengerConfirmDialog(
      t("WASTELANDER.Hexcrawl.ExportImport.ImportConfirmTitle"),
      t("WASTELANDER.Hexcrawl.ExportImport.ImportConfirmBody"),
    );
    if (!proceed) return;

    const bundleRaw = await pickJsonFile();
    if (!bundleRaw) return;

    const result = await importHexcrawlConfigForScene(this.#sceneId, bundleRaw);
    if (!result.ok) {
      const key =
        result.reason === "no_match"
          ? "WASTELANDER.Hexcrawl.ExportImport.ImportNoMatch"
          : result.reason === "invalid_version"
            ? "WASTELANDER.Hexcrawl.ExportImport.ImportInvalidVersion"
            : result.reason === "invalid_bundle"
              ? "WASTELANDER.Hexcrawl.ExportImport.ImportInvalidBundle"
              : result.reason === "save_failed"
                ? "WASTELANDER.Hexcrawl.ExportImport.ImportSaveFailed"
                : "WASTELANDER.Hexcrawl.ExportImport.ImportReadFailed";
      ui.notifications.error(t(key));
      return;
    }

    if (result.idMismatch) {
      ui.notifications.warn(t("WASTELANDER.Hexcrawl.ExportImport.ImportIdMismatch"));
    }

    this.#state = result.state;
    this.#cancelPersistDebounce();
    stageHexcrawlMapOverlayState(result.state);
    await refreshHexcrawlMapOverlay(this.#sceneId, result.state);
    await this.render();
    ui.notifications.info(
      t("WASTELANDER.Hexcrawl.ExportImport.ImportSuccess", { scene: scene.name }),
    );
  }

  static onSwitchTab(
    this: HexcrawlTravelApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    if (this.#playerView) return;
    const el = target.closest<HTMLElement>("[data-tab]") ?? target;
    const tab = el.dataset.tab as HexcrawlTab | undefined;
    if (tab !== "scene" && tab !== "party" && tab !== "map") return;
    if (this.#activeTab === tab) return;
    this.#activeTab = tab;
    this.#syncMapEditorMode();
    void this.render(true);
  }

  static async onAddMapPoiIcon(this: HexcrawlTravelApp): Promise<void> {
    if (this.#playerView) return;
    const added = await addWorldPoiIconFromPicker();
    if (!added) return;
    void this.render(true);
  }

  static async onRemoveMapPoiIcon(
    this: HexcrawlTravelApp,
    event: Event,
    target: HTMLElement,
  ): Promise<void> {
    if (this.#playerView) return;
    event.stopPropagation();
    const iconId =
      target.closest<HTMLElement>("[data-poi-icon-id]")?.dataset.poiIconId ??
      target.dataset.poiIconId;
    if (!iconId) return;
    const removed = await removeWorldPoiIcon(iconId);
    if (!removed) return;
    void this.render(true);
  }

  static async onSetMapDestination(this: HexcrawlTravelApp): Promise<void> {
    if (this.#playerView) return;
    const hexKey = this.#resolveMapEditHexKey();
    if (!hexKey) {
      ui.notifications.warn(t("WASTELANDER.Hexcrawl.MapSelectHexFirst"));
      return;
    }

    const currentName = this.#state?.mapDestination?.hexKey === hexKey
      ? this.#state.mapDestination.name
      : "";
    const name = await promptForDestinationName(currentName);
    if (!name) return;

    void this.#mutateMap((state) => setMapDestination(state, hexKey, name));
  }

  static async onClearMapDestination(this: HexcrawlTravelApp): Promise<void> {
    if (this.#playerView) return;
    void this.#mutateMap((state) => clearMapDestination(state));
  }

  static onSetMapPoiIcon(
    this: HexcrawlTravelApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const button =
      target.closest<HTMLElement>('[data-action="setMapPoiIcon"]') ?? target;
    const hexKey = this.#resolveMapEditHexKey();
    const iconId = button.dataset.iconId;
    if (!hexKey) {
      ui.notifications.warn(t("WASTELANDER.Hexcrawl.MapSelectHexFirst"));
      return;
    }
    if (!iconId) return;

    void this.#mutateMap((state) => {
      const currentIconId = state.hexAnnotations[hexKey]?.iconId ?? null;
      const nextIconId = currentIconId === iconId ? null : iconId;
      return setHexPoiIcon(state, hexKey, nextIconId);
    });
  }

  static onToggleMapHexCover(this: HexcrawlTravelApp): void {
    const hexKey = this.#resolveMapEditHexKey();
    if (!hexKey) {
      ui.notifications.warn(t("WASTELANDER.Hexcrawl.MapSelectHexFirst"));
      return;
    }

    captureHexCoverBrushFromPicker(this.#rootElement());
    const color = getEffectiveLastHexCoverColor();
    void this.#mutateMap((state) => toggleHexCoverForEditor(state, hexKey, color));
  }

  static onHideMapTrail(this: HexcrawlTravelApp): void {
    const hexKey = this.#resolveMapEditHexKey();
    if (!hexKey) return;
    void this.#mutateMap((state) => hideTrailForHex(state, hexKey));
  }

  static onShowMapTrail(this: HexcrawlTravelApp): void {
    const hexKey = this.#resolveMapEditHexKey();
    if (!hexKey) return;
    void this.#mutateMap((state) => unhideTrailForHex(state, hexKey));
  }

  static async onClearMapHex(this: HexcrawlTravelApp): Promise<void> {
    const hexKey = this.#resolveMapEditHexKey();
    if (!hexKey) {
      ui.notifications.warn(t("WASTELANDER.Hexcrawl.MapSelectHexFirst"));
      return;
    }
    const state = this.#state;
    if (!state || !hexHasMapEdits(state, hexKey)) {
      ui.notifications.info(t("WASTELANDER.Hexcrawl.MapClearHexNothing"));
      return;
    }

    const proceed = await scavengerConfirmDialog(
      t("WASTELANDER.Hexcrawl.MapClearHexConfirmTitle"),
      t("WASTELANDER.Hexcrawl.MapClearHexConfirmBody", { hex: hexKey }),
    );
    if (!proceed) return;

    await this.#mutateMap((state) => clearHexMapEdits(state, hexKey));
    ui.notifications.info(t("WASTELANDER.Hexcrawl.Notify.MapHexCleared", { hex: hexKey }));
  }

  static async onSetStartingLocation(this: HexcrawlTravelApp): Promise<void> {
    if (!currentUserIsOverseer()) return;
    if (!this.#sceneId || !this.#state) return;
    const saved = await setStartingLocationForScene(this.#sceneId);
    if (!saved) return;
    this.#state = saved;
    await this.render();
  }

  static async onResetMap(this: HexcrawlTravelApp): Promise<void> {
    if (!currentUserIsOverseer()) return;
    if (!this.#sceneId || !this.#state) return;
    this.#cancelPersistDebounce();
    const resetState = await confirmAndResetMap(this.#sceneId, this.#state);
    if (!resetState) return;
    this.#state = resetState;
    await this.render();
  }

  static async onResetTravel(this: HexcrawlTravelApp): Promise<void> {
    if (!currentUserIsOverseer()) return;
    if (!this.#sceneId || !this.#state) return;
    const resetState = await confirmAndResetTravel(this.#sceneId, this.#state);
    if (!resetState) return;
    this.#state = resetState;
    await this.render();
  }

  override async _onClose(): Promise<void> {
    if (this.#persistDebounce) {
      clearTimeout(this.#persistDebounce);
      this.#persistDebounce = null;
    }
    const sceneId = this.#sceneId;
    const closingState = this.#state;
    if (closingState && sceneId && currentUserIsOverseer()) {
      try {
        await this.#persistNow();
      } catch {
        // Notified in #persistNow.
      }
    }
    const root = this.#rootElement();
    if (root) delete root.dataset.wastelanderHexcrawlBound;
    if (HexcrawlTravelApp.#open === this) {
      HexcrawlTravelApp.#open = null;
    }
    disableHexMapEditor();
    if (sceneId) {
      clearHexMapEditorSelectionState(sceneId);
      const overlayState = this.#state ?? closingState;
      if (overlayState) {
        await refreshHexcrawlMapOverlay(sceneId, overlayState);
      } else {
        await refreshHexcrawlMapOverlay(sceneId);
      }
    }
    return super._onClose();
  }
}
