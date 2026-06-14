import { MODULE_ID, MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import { invokeFalloutPartySleep } from "../integrations/falloutPartySleep.js";
import { getActiveSceneId } from "../scavenging/scenePersist.js";
import { scavengerConfirmDialog } from "../scavenging/scavengerConfirm.js";
import { seedLastHexKeyFromTravelToken } from "./hexCoords.js";
import { openHexcrawlJournalPage } from "./hexcrawlJournalSync.js";
import {
  appendJourneyLog,
  defaultHexcrawlState,
  ensureStartingHexInTrail,
  loadHexcrawlSceneState,
  prepareHexcrawlStateForSave,
  saveHexcrawlSceneState,
  type HexcrawlSceneState,
} from "./hexcrawlScenePersist.js";
import {
  applyCourseCheckFail,
  applyCourseCheckPass,
  applyOneHexTravelTime,
  applySetStartingHex,
  buildInitialPartyActorIds,
  confirmAndResetTravel,
  confirmTravelDayEnd,
  courseChecksEnabled,
  confirmDayEndEnabled,
  processSetCamp,
  ensureHexGridForScene,
  resolveCurrentTravelHexKey,
} from "./hexcrawlTravel.js";
import {
  addActorToPartyIds,
  buildPartyMemberRows,
  canAddActorToParty,
  mergePartyActorIdsWithScene,
  removeActorFromPartyIds,
  resolveActorIdFromDrop,
  resolvePartyTravelRoles,
  syncPartyTravelState,
} from "./partyTravel.js";
import {
  requestPlayerHexcrawlAction,
  type PlayerHexcrawlSocketAction,
} from "./playerHexcrawlActions.js";
import { formatSceneGridDistanceLabel } from "./sceneGrid.js";
import {
  clampDifficulty,
  formatHours,
  NAVIGATION_CONDITIONS,
  navigationConditionById,
  TRAVEL_EVENT_MODES,
  type TravelEventMode,
} from "./travelRules.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

type HexcrawlTab = "scene" | "party";

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

  static override DEFAULT_OPTIONS = {
    id: "wastelander-hexcrawl-travel",
    classes: ["wastelander-wizard", "wastelander-hexcrawl-app"],
    window: {
      title: "WASTELANDER.Hexcrawl.WindowTitle",
      icon: "fa-solid fa-map",
    },
    position: { width: 520, height: 890 },
    actions: {
      coursePass: HexcrawlTravelApp.#onCoursePass,
      courseFail: HexcrawlTravelApp.#onCourseFail,
      confirmDayEnd: HexcrawlTravelApp.#onConfirmDayEnd,
      markArrival: HexcrawlTravelApp.#onMarkArrival,
      resumeTravel: HexcrawlTravelApp.#onResumeTravel,
      setStartingLocation: HexcrawlTravelApp.#onSetStartingLocation,
      setCamp: HexcrawlTravelApp.#onSetCamp,
      resetTravel: HexcrawlTravelApp.#onResetTravel,
      openJournal: HexcrawlTravelApp.#onOpenJournal,
      clearJournal: HexcrawlTravelApp.#onClearJournal,
      switchTab: HexcrawlTravelApp.onSwitchTab,
      removePartyMember: HexcrawlTravelApp.#onRemovePartyMember,
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

  static rebindForScene(sceneId: string): void {
    if (HexcrawlTravelApp.#skipExternalRefresh) return;
    const app = HexcrawlTravelApp.#open;
    if (!app || app.#sceneId !== sceneId) return;
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
    if (!root || root.dataset.wastelanderHexcrawlBound === "1") return;
    root.dataset.wastelanderHexcrawlBound = "1";
    root.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.field) {
        HexcrawlTravelApp.#onUpdateField.call(this, event, target);
      }
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
    const loaded = loadHexcrawlSceneState(sceneId) ?? defaultHexcrawlState(sceneId);
    const sceneParty = buildInitialPartyActorIds(sceneId);
    let next = {
      ...loaded,
      partyActorIds: mergePartyActorIdsWithScene(loaded.partyActorIds, sceneParty),
    };
    next = syncPartyTravelState(next, sceneId);
    next = this.#withTravelTokenSync(next);
    this.#state = next;
    if (
      currentUserIsOverseer() &&
      (next.travelTokenId !== loaded.travelTokenId ||
        next.lastHexKey !== loaded.lastHexKey ||
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
    const toSave = prepareHexcrawlStateForSave(this.#state, this.#sceneId);
    this.#state = toSave;
    HexcrawlTravelApp.#skipExternalRefresh = true;
    try {
      await saveHexcrawlSceneState(toSave);
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
    const partyRoles = resolvePartyTravelRoles(state.partyActorIds);
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

    const courseStatusLabel =
      state.courseStatus === "lost"
        ? t("WASTELANDER.Hexcrawl.CourseStatus.Lost")
        : t("WASTELANDER.Hexcrawl.CourseStatus.OnCourse");

    return {
      state,
      isOverseer,
      showPartyPanel: !isOverseer || this.#activeTab === "party",
      partyRows,
      navigationOptions,
      travelEventModeOptions,
      sceneGridDistanceLabel: this.#sceneId
        ? formatSceneGridDistanceLabel(this.#sceneId)
        : "—",
      partyMph: partyRoles.partyMph,
      maxHoursActorName: partyRoles.hoursActorName,
      hoursTodayLabel: formatHours(state.hoursTraveledToday),
      courseStatusLabel,
      courseStatusClass:
        state.courseStatus === "lost"
          ? "wastelander-hexcrawl-lost"
          : "wastelander-hexcrawl-on-course",
      courseChecksEnabled: courseChecksEnabled(state),
      confirmDayEndEnabled: confirmDayEndEnabled(state),
      journalReady: Boolean(state.enabled),
      journalHasEntries: state.journeyLog.length > 0,
      startingHexLabel: state.startingHexKey ?? "—",
      lastHexLabel: state.lastHexKey ?? "—",
      tabScene: this.#activeTab === "scene",
      tabParty: this.#activeTab === "party",
      strings: {
        enableLabel: t("WASTELANDER.Hexcrawl.EnableLabel"),
        tabScene: t("WASTELANDER.Hexcrawl.Tabs.Scene"),
        tabParty: t("WASTELANDER.Hexcrawl.Tabs.Party"),
        travelSettings: t("WASTELANDER.Hexcrawl.TravelSettings"),
        sceneGridDistance: t("WASTELANDER.Hexcrawl.SceneGridDistance"),
        travelEvents: t("WASTELANDER.Hexcrawl.TravelEvents"),
        trailOverlayColor: t("WASTELANDER.Hexcrawl.TrailOverlayColor"),
        trailOverlayColorHint: t("WASTELANDER.Hexcrawl.TrailOverlayColorHint"),
        maxHours: t("WASTELANDER.Hexcrawl.MaxHours"),
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
        setCamp: t("WASTELANDER.Hexcrawl.CampEncounter"),
        openJournal: t("WASTELANDER.Hexcrawl.OpenJournal"),
        clearJournal: t("WASTELANDER.Hexcrawl.Journal.Clear"),
      },
    };
  }

  static #onUpdateField(
    this: HexcrawlTravelApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const el = target as HTMLInputElement | HTMLSelectElement;
    const field = el.dataset.field;
    if (!field || !currentUserIsOverseer()) return;

    switch (field) {
      case "enabled":
        void this.#onToggleEnabled(_event, el as HTMLInputElement);
        break;
      case "travelEventMode": {
        const travelEventMode = el.value as TravelEventMode;
        if (travelEventMode !== "hexEntry" && travelEventMode !== "hourChange") return;
        void this.#mutate((state) => ({ ...state, travelEventMode }));
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
      default:
        break;
    }
  }

  static async #onToggleEnabled(
    this: HexcrawlTravelApp,
    _event: Event,
    target: HTMLInputElement,
  ): Promise<void> {
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

  static #onRemovePartyMember(
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
    if (!courseChecksEnabled(this.#state)) return;

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

  static #onCoursePass(this: HexcrawlTravelApp): void {
    if (!currentUserIsOverseer()) return;
    void this.#applyCourseCheck("pass");
  }

  static #onCourseFail(this: HexcrawlTravelApp): void {
    if (!currentUserIsOverseer()) return;
    void this.#applyCourseCheck("fail");
  }

  static async #onConfirmDayEnd(this: HexcrawlTravelApp): Promise<void> {
    if (!currentUserIsOverseer()) return;
    if (!this.#state || !confirmDayEndEnabled(this.#state)) return;

    const opened = await invokeFalloutPartySleep();
    if (!opened) {
      ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.PartySleepUnavailable"));
    }

    await this.#mutate((state) => confirmTravelDayEnd(state));
  }

  static #onMarkArrival(this: HexcrawlTravelApp): void {
    if (!currentUserIsOverseer()) return;
    void this.#mutate((state) => {
      const next = appendJourneyLog(
        { ...state, arrived: true },
        { kind: "arrival", travelDay: state.travelDay },
      );
      return next;
    });
  }

  static #onResumeTravel(this: HexcrawlTravelApp): void {
    if (!currentUserIsOverseer()) return;
    void this.#mutate((state) => ({ ...state, arrived: false }));
  }

  static async #onOpenJournal(this: HexcrawlTravelApp): Promise<void> {
    if (!this.#sceneId) return;
    await openHexcrawlJournalPage(this.#sceneId);
  }

  static async #onClearJournal(this: HexcrawlTravelApp): Promise<void> {
    if (!currentUserIsOverseer()) return;
    if (!this.#state?.journeyLog.length) return;

    const proceed = await scavengerConfirmDialog(
      t("WASTELANDER.Hexcrawl.Journal.ClearConfirmTitle"),
      t("WASTELANDER.Hexcrawl.Journal.ClearConfirmBody"),
    );
    if (!proceed) return;

    await this.#mutate((state) => ({
      ...state,
      journeyLog: [],
      traveledHexKeys: [],
      trailCleared: true,
    }));
    ui.notifications.info(t("WASTELANDER.Hexcrawl.Notify.JournalCleared"));
  }

  static onSwitchTab(
    this: HexcrawlTravelApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    if (this.#playerView) return;
    const el = target.closest<HTMLElement>("[data-tab]") ?? target;
    const tab = el.dataset.tab as HexcrawlTab | undefined;
    if (tab !== "scene" && tab !== "party") return;
    if (this.#activeTab === tab) return;
    this.#activeTab = tab;
    void this.render(true);
  }

  static async #onSetStartingLocation(this: HexcrawlTravelApp): Promise<void> {
    if (!currentUserIsOverseer()) return;
    if (!this.#sceneId || !this.#state) return;
    const hexKey = resolveCurrentTravelHexKey(this.#sceneId, this.#state);
    if (!hexKey) {
      ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.NoTravelHex"));
      return;
    }
    await this.#mutate((state) => applySetStartingHex(state, hexKey));
    ui.notifications.info(
      t("WASTELANDER.Hexcrawl.Notify.StartingLocationSet", { hex: hexKey }),
    );
  }

  static async #onSetCamp(this: HexcrawlTravelApp): Promise<void> {
    if (!currentUserIsOverseer()) return;
    if (!this.#sceneId || !this.#state) return;
    if (!this.#state.enabled) return;
    const next = await processSetCamp(this.#sceneId, this.#state);
    this.#state = next;
    await this.render();
  }

  static async #onResetTravel(this: HexcrawlTravelApp): Promise<void> {
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
      await this.#persistNow();
    }
    if (HexcrawlTravelApp.#open === this) {
      HexcrawlTravelApp.#open = null;
    }
    return super._onClose();
  }
}
