import { MODULE_ID, MODULE_PATH } from "../constants.js";
import {
  closeAllRenderedActorSheets,
} from "../integrations/falloutActor.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import { t } from "../integrations/i18n.js";
import { levelFromAgeLabel, previewCharacterNpcStats } from "./buildCharacterNpcStats.js";
import { createFriendlyNpcActor } from "./createFriendlyNpcActor.js";
import { buildNpcGenAiPrompt } from "./npcGenActorData.js";
import { copyTextToClipboard } from "./npcGenClipboard.js";
import {
  buildDenizenGearSection,
  buildProfessionDemeanorGearSections,
  extractCombatGearFromActor,
  listNpcGenDenizenActors,
  resolveDenizenActor,
} from "./npcGenGear.js";
import {
  allRollStepsComplete,
  createInitialNpcGeneratorState,
  isNpcRollStep,
  isRollStepComplete,
  npcFullName,
  NPC_GEN_STEPS,
  type NpcGenStepId,
  type NpcGeneratorState,
  resolvedNpcType,
} from "./npcGeneratorState.js";
import {
  rollNpcAge,
  rollNpcDemeanor,
  rollNpcDistinctiveFeature,
  rollNpcGender,
  rollNpcGivenName,
  rollNpcProfession,
  rollNpcSecret,
  rollNpcSurname,
  rollNpcTruth,
  rollNpcType,
} from "./rollFriendlyNpc.js";
import {
  applyManualNpcStepPick,
  buildNpcStepPickerRows,
  rerollNpcStep,
  stepHasPicker,
  stepIsClickable,
  stepValueDisplay,
  type NpcStepPickerRow,
} from "./npcStepPicker.js";
import {
  assertGenerateNpcTablesReady,
  assertNpcStepTablesReady,
  diagnoseNpcGenTables,
  diagnoseWandererTableKey,
  isWandererTableUsable,
  logNpcGenTableDiagnostics,
  notifyNpcStepTableDiagnostics,
} from "./wandererRollTables.js";
import { GENERATE_NPC_REQUIRED_TABLES } from "./wandererTableTitles.js";

const LAUNCH_STEP_DELAY_MS = 400;

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

type StepUi = {
  id: string;
  number: number;
  label: string;
  active: boolean;
  complete: boolean;
  value: string;
  clickable: boolean;
  focused: boolean;
};

const ROLL_ACTIONS: Record<string, (state: NpcGeneratorState) => Promise<NpcGeneratorState>> = {
  rollGender: rollNpcGender,
  rollGivenName: rollNpcGivenName,
  rollSurname: rollNpcSurname,
  rollAge: rollNpcAge,
  rollDemeanor: rollNpcDemeanor,
  rollDistinctiveFeature1: (s) => rollNpcDistinctiveFeature(s, 1),
  rollDistinctiveFeature2: (s) => rollNpcDistinctiveFeature(s, 2),
  rollProfession: rollNpcProfession,
  rollSecret: rollNpcSecret,
  rollTruth: rollNpcTruth,
  rollNpcType: rollNpcType,
};

const STEP_ROLL_ACTION: Partial<Record<NpcGenStepId, string>> = {
  gender: "rollGender",
  givenName: "rollGivenName",
  surname: "rollSurname",
  age: "rollAge",
  demeanor: "rollDemeanor",
  distinctiveFeature1: "rollDistinctiveFeature1",
  distinctiveFeature2: "rollDistinctiveFeature2",
  profession: "rollProfession",
  secret: "rollSecret",
  truth: "rollTruth",
  npcType: "rollNpcType",
};

/** Inline d20 rolls — no Wanderer RollTable required. */
const INLINE_ROLL_ACTIONS = new Set(["rollGender", "rollNpcType"]);

function stepNeedsWandererTables(step: NpcGenStepId): boolean {
  return step !== "gender" && step !== "npcType" && step !== "gear" && step !== "review";
}

export default class NpcGeneratorApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static #open: NpcGeneratorApp | null = null;

  state: NpcGeneratorState = createInitialNpcGeneratorState();
  #rolling = false;
  #lastTableDiagnosticKey = "";
  #focusedStepId: NpcGenStepId | null = null;
  #pickerRows: NpcStepPickerRow[] = [];
  #showAiPromptFallback = false;
  #aiPromptText = "";

  static override DEFAULT_OPTIONS = {
    id: "wastelander-npc-generator",
    uniqueId: true,
    classes: ["wastelander-wizard", "wastelander-npc-gen-app"],
    window: {
      title: "WASTELANDER.NpcGen.WindowTitle",
      icon: "fa-solid fa-user-plus",
      resizable: true,
    },
    position: {
      width: 960,
      height: 840,
    },
    actions: {
      finish: NpcGeneratorApp.#onFinish,
      reset: NpcGeneratorApp.#onReset,
      generate: NpcGeneratorApp.#onGenerate,
      focusStep: NpcGeneratorApp.#onFocusStep,
      rerollStep: NpcGeneratorApp.#onRerollStep,
      pickStepOption: NpcGeneratorApp.#onPickStepOption,
      approveDenizenGear: NpcGeneratorApp.#onApproveDenizenGear,
      copyAiPrompt: NpcGeneratorApp.#onCopyAiPrompt,
      dismissAiPrompt: NpcGeneratorApp.#onDismissAiPrompt,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/npcGen/generator.hbs`,
      scrollable: [
        ".wastelander-npc-gen-step-list",
        ".wastelander-npc-gen-step-content",
      ],
    },
  };

  get title(): string {
    return t("WASTELANDER.NpcGen.WindowTitle");
  }

  /** Current wizard state when the app is open (for console diagnostics). */
  static getOpenState(): NpcGeneratorState | null {
    return NpcGeneratorApp.#open?.state ?? null;
  }

  static async renderOpen(): Promise<NpcGeneratorApp> {
    if (!currentUserIsOverseer()) {
      throw new Error(t("WASTELANDER.NpcGen.Errors.GmOnly"));
    }
    if (NpcGeneratorApp.#open?.rendered) {
      NpcGeneratorApp.#open.#rolling = false;
      NpcGeneratorApp.#open.bringToFront?.();
      void NpcGeneratorApp.#open.render({ force: true });
      return NpcGeneratorApp.#open;
    }
    const app = new NpcGeneratorApp();
    NpcGeneratorApp.#open = app;
    await app.render({ force: true });
    return app;
  }

  static async closeOpen(): Promise<void> {
    if (NpcGeneratorApp.#open?.rendered) {
      await NpcGeneratorApp.#open.close();
    }
    NpcGeneratorApp.#open = null;
  }

  override async close(options?: ApplicationClosingOptions): Promise<this> {
    if (NpcGeneratorApp.#open === this) NpcGeneratorApp.#open = null;
    return super.close(options);
  }

  #rootElement(): HTMLElement | null {
    const el = this.element;
    const base =
      el instanceof HTMLElement
        ? el
        : Array.isArray(el) && el[0] instanceof HTMLElement
          ? el[0]
          : null;
    if (!base) return null;
    return (
      base.querySelector<HTMLElement>('[data-application-part="body"]') ?? base
    );
  }

  protected override async _onRender(
    context: Record<string, unknown>,
    options: ApplicationRenderOptions,
  ): Promise<void> {
    await super._onRender(context, options);
    const root = this.#rootElement();
    if (!root || root.dataset.wastelanderNpcGenSelectBound === "1") return;
    root.dataset.wastelanderNpcGenSelectBound = "1";

    root.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (!target.matches("select[data-npc-gen-select]")) return;
      const field = target.dataset.npcGenSelect;
      switch (field) {
        case "denizen":
          NpcGeneratorApp.#applyDenizenSelection(this, target);
          break;
        case "level":
          NpcGeneratorApp.#applyLevelSelection(this, target);
          break;
        case "npcType":
          NpcGeneratorApp.#applyNpcTypeSelection(this, target);
          break;
        default:
          break;
      }
    });

    if (this.#showAiPromptFallback) {
      const textarea = root.querySelector<HTMLTextAreaElement>(
        ".wastelander-npc-gen-ai-prompt-text",
      );
      if (textarea) {
        textarea.focus();
        textarea.select();
      }
    }
  }

  protected override async _prepareContext(): Promise<Record<string, unknown>> {
    const activeStep = this.#activeRollStep();
    const viewStep = this.#viewStep();
    const diagnosticStep = isNpcRollStep(viewStep) ? viewStep : activeStep;
    const tableReport =
      diagnosticStep && stepNeedsWandererTables(diagnosticStep)
        ? diagnoseNpcGenTables(diagnosticStep, this.state)
        : null;
    const blockingDiagnostics = tableReport?.blocking ?? [];
    const tablesReady = !tableReport || blockingDiagnostics.length === 0;

    if (tableReport && (blockingDiagnostics.length || tableReport.warnings.length)) {
      const diagnosticKey = `${activeStep}:${tableReport.tables.map((row) => `${row.key ?? row.title}:${row.status}`).join()}`;
      if (diagnosticKey !== this.#lastTableDiagnosticKey) {
        this.#lastTableDiagnosticKey = diagnosticKey;
        logNpcGenTableDiagnostics(tableReport);
        notifyNpcStepTableDiagnostics(tableReport);
      }
    }

    const rollBlockReason = this.#rollBlockReason(
      activeStep,
      tablesReady,
      blockingDiagnostics,
    );

    const rollsComplete = allRollStepsComplete(this.state);

    this.#pickerRows = isNpcRollStep(viewStep)
      ? buildNpcStepPickerRows(viewStep, this.state)
      : [];
    const focusedStepValue = isNpcRollStep(viewStep)
      ? stepValueDisplay(this.state, viewStep)
      : "";
    const showFocusedStep = isNpcRollStep(viewStep) && stepHasPicker(viewStep);
    const statsPreview = previewCharacterNpcStats(this.state);
    const selectedLevel =
      this.state.review.level ?? levelFromAgeLabel(this.state.rolls.age);
    const selectedType = resolvedNpcType(this.state);

    return {
      steps: this.#buildSteps(),
      tablesReady,
      rollBlockReason,
      stepTableStatus: tableReport?.tables.map((row) => ({
        title: row.title,
        status: row.status,
        reason: row.reason,
        ok: row.status === "ok",
        warning: row.status === "wrong_folder",
      })),
      missingTableDiagnostics: blockingDiagnostics.map((row) => ({
        title: row.title,
        reason: row.reason,
      })),
      tableWarnings: (tableReport?.warnings ?? []).map((row) => ({
        title: row.title,
        reason: row.reason,
      })),
      isGearStep: viewStep === "gear",
      isReviewStep: viewStep === "review",
      showRollStatus: isNpcRollStep(this.state.step),
      gearSections: buildProfessionDemeanorGearSections(this.state.rolls),
      denizenCombatSection: buildDenizenGearSection(
        this.state.gear.denizenCombatItems,
        t("WASTELANDER.NpcGen.Gear.DenizenApproved"),
      ),
      denizenOptions: listNpcGenDenizenActors().map((row) => ({
        ...row,
        label: `${row.name} (${row.subfolder})`,
        selected: row.id === this.state.gear.previewDenizenId,
      })),
      denizenPreviewSection: this.#buildDenizenPreviewSection(),
      reviewName: npcFullName(this.state.rolls) || "—",
      rolls: this.state.rolls,
      levelOptions: [1, 2, 3, 4, 5].map((value) => ({
        value,
        selected: value === selectedLevel,
      })),
      typeOptions: [
        { id: "normal", label: t("WASTELANDER.NpcGen.Type.Normal") },
        { id: "notable", label: t("WASTELANDER.NpcGen.Type.Notable") },
        { id: "major", label: t("WASTELANDER.NpcGen.Type.Major") },
      ].map((row) => ({ ...row, selected: row.id === selectedType })),
      selectedLevel,
      selectedType,
      statsPreview: statsPreview
        ? {
            ...statsPreview,
            tagSkillsJoined: statsPreview.tagSkills.join(", "),
          }
        : null,
      finishDisabled: !rollsComplete || this.#rolling,
      finishEnabled: rollsComplete && !this.#rolling,
      aiPromptEnabled: rollsComplete && !this.#rolling,
      showAiPromptFallback: this.#showAiPromptFallback,
      aiPromptText: this.#aiPromptText,
      activeStepLabel: activeStep ? this.#stepLabel(activeStep) : "",
      activeStepValue: activeStep ? this.#stepValue(activeStep) : "",
      focusedStepId: viewStep,
      focusedStepLabel: isNpcRollStep(viewStep) ? this.#stepLabel(viewStep) : "",
      focusedStepValue,
      showFocusedStep,
      showReroll: showFocusedStep && Boolean(focusedStepValue) && !this.#rolling,
      pickerRows: this.#pickerRows.map((row, index) => ({ ...row, index })),
      rolling: this.#rolling,
      generateEnabled:
        !this.#rolling && !rollsComplete && this.#allGenerateTablesReady(),
      showGenerateButton: !rollsComplete,
    };
  }

  #selectedDenizenId(): string | null {
    const fromState = this.state.gear.previewDenizenId?.trim();
    if (fromState) return fromState;
    const select = this.#rootElement()?.querySelector<HTMLSelectElement>(
      'select[data-npc-gen-select="denizen"]',
    );
    const fromDom = select?.value?.trim();
    return fromDom || null;
  }

  #buildDenizenPreviewSection() {
    const actor = resolveDenizenActor(this.#selectedDenizenId());
    if (!actor) return null;
    const items = extractCombatGearFromActor(actor);
    return buildDenizenGearSection(
      items,
      t("WASTELANDER.NpcGen.Gear.DenizenPreview", { name: actor.name }),
    );
  }

  #activeRollStep(): NpcGenStepId | null {
    if (!isNpcRollStep(this.state.step)) return null;
    return this.state.step;
  }

  /** Main panel step — sidebar focus when set, otherwise wizard progress. */
  #viewStep(): NpcGenStepId {
    if (this.#focusedStepId) return this.#focusedStepId;
    return this.state.step;
  }

  async #resetGenerator(): Promise<void> {
    await closeAllRenderedActorSheets();
    this.#rolling = false;
    this.#focusedStepId = null;
    this.#lastTableDiagnosticKey = "";
    this.#showAiPromptFallback = false;
    this.#aiPromptText = "";
    this.state = createInitialNpcGeneratorState();
    await this.render({ force: true });
  }

  #allGenerateTablesReady(): boolean {
    return GENERATE_NPC_REQUIRED_TABLES.every((key) =>
      isWandererTableUsable(diagnoseWandererTableKey(key).status),
    );
  }

  #rollBlockReason(
    activeStep: NpcGenStepId | null,
    tablesReady: boolean,
    blocking: { title: string; reason: string }[],
  ): string {
    if (!activeStep) {
      return t("WASTELANDER.NpcGen.Diagnostics.NoActiveStep");
    }
    if (this.#rolling) {
      return t("WASTELANDER.NpcGen.Diagnostics.Rolling");
    }
    if (!STEP_ROLL_ACTION[activeStep]) {
      return t("WASTELANDER.NpcGen.Diagnostics.NoRollAction", { step: activeStep });
    }
    if (stepNeedsWandererTables(activeStep) && !tablesReady && blocking.length) {
      return blocking.map((row) => `${row.title}: ${row.reason}`).join(" ");
    }
    return "";
  }

  #buildSteps(): StepUi[] {
    const viewStep = this.#viewStep();
    return NPC_GEN_STEPS.map((id, index) => ({
      id,
      number: index + 1,
      label: this.#stepLabel(id),
      active: viewStep === id,
      complete: isRollStepComplete(this.state, id),
      value: stepValueDisplay(this.state, id),
      clickable: stepIsClickable(this.state, id),
      focused: viewStep === id,
    }));
  }

  #stepLabel(step: NpcGenStepId): string {
    return t(`WASTELANDER.NpcGen.Steps.${step}`);
  }

  #stepValue(step: NpcGenStepId): string {
    if (step === "review") return npcFullName(this.state.rolls);
    return stepValueDisplay(this.state, step);
  }

  async #executeRollAction(actionName: string): Promise<boolean> {
    const fn = ROLL_ACTIONS[actionName];
    if (!fn) return false;
    const activeStep = this.#activeRollStep();
    if (
      !INLINE_ROLL_ACTIONS.has(actionName) &&
      activeStep &&
      !assertNpcStepTablesReady(activeStep, this.state)
    ) {
      return false;
    }
    this.state = await fn(this.state);
    return true;
  }

  async #renderAfterRoll(): Promise<void> {
    try {
      await this.render({ force: true });
    } catch (error) {
      console.warn(`${MODULE_ID} | NPC generator render after roll failed`, error);
    }
  }

  async #runGenerate(): Promise<void> {
    if (this.#rolling || allRollStepsComplete(this.state)) return;
    if (!assertGenerateNpcTablesReady()) return;

    await closeAllRenderedActorSheets();

    this.#rolling = true;
    try {
      this.state = createInitialNpcGeneratorState();
      this.#focusedStepId = null;
      await this.#renderAfterRoll();

      while (isNpcRollStep(this.state.step)) {
        const activeStep = this.#activeRollStep();
        const actionName = activeStep ? STEP_ROLL_ACTION[activeStep] : undefined;
        if (!actionName) break;

        const rolled = await this.#executeRollAction(actionName);
        if (!rolled) break;

        if (activeStep) this.#focusedStepId = activeStep;
        await this.#renderAfterRoll();

        if (isNpcRollStep(this.state.step)) {
          await new Promise((resolve) => setTimeout(resolve, LAUNCH_STEP_DELAY_MS));
        }
      }

      if (allRollStepsComplete(this.state)) {
        this.state = { ...this.state, step: "review" };
        this.#focusedStepId = null;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      ui.notifications?.error(message);
    } finally {
      this.#rolling = false;
      await this.#renderAfterRoll();
    }
  }

  static #applyLevelSelection(app: NpcGeneratorApp, select: HTMLSelectElement): void {
    const value = Number(select.value ?? 1);
    app.state = {
      ...app.state,
      review: {
        ...app.state.review,
        level: Number.isFinite(value) ? value : null,
      },
    };
    void app.render({ force: true });
  }

  static #applyNpcTypeSelection(app: NpcGeneratorApp, select: HTMLSelectElement): void {
    const value = select.value as "normal" | "notable" | "major";
    app.state = {
      ...app.state,
      review: {
        ...app.state.review,
        npcType: value ?? null,
      },
    };
    void app.render({ force: true });
  }

  static async #onFinish(this: NpcGeneratorApp): Promise<void> {
    if (!allRollStepsComplete(this.state) || this.#rolling) return;
    await closeAllRenderedActorSheets();
    this.#rolling = true;
    try {
      const { actor } = await createFriendlyNpcActor(this.state, {
        openSheet: false,
      });
      ui.notifications?.info(
        t("WASTELANDER.NpcGen.Success", { name: actor.name }),
      );
      await this.#resetGenerator();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      ui.notifications?.error(message);
    } finally {
      this.#rolling = false;
    }
  }

  static async #onReset(this: NpcGeneratorApp): Promise<void> {
    await this.#resetGenerator();
  }

  static async #onCopyAiPrompt(this: NpcGeneratorApp): Promise<void> {
    if (!allRollStepsComplete(this.state) || this.#rolling) return;
    const prompt = buildNpcGenAiPrompt(
      this.state,
      previewCharacterNpcStats(this.state),
    );
    const copied = await copyTextToClipboard(prompt);
    if (copied) {
      this.#showAiPromptFallback = false;
      this.#aiPromptText = "";
      ui.notifications?.info(t("WASTELANDER.NpcGen.AiPrompt.Copied"));
      void this.render({ force: true });
      return;
    }
    this.#aiPromptText = prompt;
    this.#showAiPromptFallback = true;
    void this.render({ force: true });
  }

  static #onDismissAiPrompt(this: NpcGeneratorApp): void {
    this.#showAiPromptFallback = false;
    this.#aiPromptText = "";
    void this.render({ force: true });
  }

  static async #onGenerate(this: NpcGeneratorApp): Promise<void> {
    await this.#runGenerate();
  }

  static #onFocusStep(
    this: NpcGeneratorApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const stepId = target.closest("[data-step-id]")?.getAttribute("data-step-id") as
      | NpcGenStepId
      | undefined;
    if (!stepId || !stepIsClickable(this.state, stepId)) return;

    if (stepId === "review") {
      this.#focusedStepId = null;
      if (allRollStepsComplete(this.state)) {
        this.state = { ...this.state, step: "review" };
      }
      void this.render({ force: true });
      return;
    }

    if (stepId === "gear") {
      this.#focusedStepId = "gear";
      void this.render({ force: true });
      return;
    }

    this.#focusedStepId = stepId;
    void this.render({ force: true });
  }

  static #applyDenizenSelection(app: NpcGeneratorApp, select: HTMLSelectElement): void {
    const value = select.value?.trim() ?? "";
    app.state = {
      ...app.state,
      gear: {
        ...app.state.gear,
        previewDenizenId: value || null,
      },
    };
    void app.render({ force: true });
  }

  static #onApproveDenizenGear(this: NpcGeneratorApp): void {
    const select = this.#rootElement()?.querySelector<HTMLSelectElement>(
      'select[data-npc-gen-select="denizen"]',
    );
    const id = select?.value?.trim() || this.state.gear.previewDenizenId?.trim() || null;
    if (id && id !== this.state.gear.previewDenizenId) {
      this.state = {
        ...this.state,
        gear: { ...this.state.gear, previewDenizenId: id },
      };
    }
    const actor = resolveDenizenActor(id);
    if (!actor) {
      ui.notifications?.warn(t("WASTELANDER.NpcGen.Gear.DenizenActorMissing"));
      return;
    }
    const items = extractCombatGearFromActor(actor);
    if (!items.length) {
      ui.notifications?.warn(t("WASTELANDER.NpcGen.Gear.NoDenizenItems"));
      return;
    }
    this.state = {
      ...this.state,
      gear: {
        ...this.state.gear,
        denizenCombatItems: items,
      },
    };
    void this.render({ force: true });
  }

  static async #onRerollStep(
    this: NpcGeneratorApp,
    _event: Event,
    target: HTMLElement,
  ): Promise<void> {
    const stepId = target.closest("[data-step-id]")?.getAttribute("data-step-id") as
      | NpcGenStepId
      | undefined;
    if (
      !stepId ||
      stepId === "review" ||
      stepId === "gear" ||
      this.#rolling
    ) {
      return;
    }

    this.#rolling = true;
    try {
      this.state = await rerollNpcStep(this.state, stepId);
      this.#focusedStepId = stepId;
      await this.render({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ui.notifications?.error(message);
    } finally {
      this.#rolling = false;
      await this.render({ force: true });
    }
  }

  static #onPickStepOption(
    this: NpcGeneratorApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const button = target.closest("[data-picker-index]") as HTMLElement | null;
    const index = Number(button?.dataset.pickerIndex);
    const viewStep = this.#viewStep();
    const row = this.#pickerRows[index];
    if (!isNpcRollStep(viewStep) || !row || Number.isNaN(index)) return;

    this.state = applyManualNpcStepPick(this.state, viewStep, row);
    this.#focusedStepId = viewStep;
    void this.render({ force: true });
  }
}
