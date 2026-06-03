import { MODULE_ID, MODULE_PATH } from "../constants.js";
import { resolveActor } from "../integrations/falloutActor.js";
import originsData from "../data/origins-core.json";
import survivorTraitsData from "../data/survivor-traits.json";
import {
  type FalloutAttributeKey,
  getCompendiumItem,
  openCompendiumItemSheet,
  listPerksFromCompendium,
  listPerksRequiringAttribute,
  listSkillsFromCompendium,
  type PerkCompendiumEntry,
  type SkillCompendiumEntry,
} from "../integrations/fallout.js";
import {
  getPerkStepSummary,
  getRequiredPerkCount,
} from "./perkRules.js";
import { getCompanionStatBlockHtmlForPerk } from "./perkStatBlocks.js";
import {
  computeDerivedStatistics,
  formatDerivedStatisticsForDisplay,
} from "./derivedStats.js";
import {
  buildEquipmentItemIndex,
  enrichEquipmentLine,
  enrichEquipmentLines,
  type CompendiumItemIndexEntry,
} from "../integrations/equipmentItems.js";
import {
  getEquipmentPack,
  getEquipmentPackGroup,
  getTagSkillLootLines,
  resolvePackItems,
  rollTrinket,
  rollTrinketRandom,
  type EquipmentPackDefinition,
} from "./equipmentRules.js";
import {
  applyTagOff,
  applyTagOn,
  canAddSkillTag,
  canRemoveSkillTag,
  countVoluntaryTagged,
  ensureForcedTags,
  getEffectiveSkillRank,
  getSkillBaseRank,
  getSkillPointsBudget,
  getSkillsTagConfig,
  getTagRulesSummary,
} from "./skillsRules.js";
import { getSkillSummary } from "./skillSummaries.js";
import {
  getOriginDisableReason,
  isOriginCompatibleWithActorType,
} from "./actorTypeRules.js";
import {
  getDefaultSpecialForOrigin,
  getMaxSkillRankAtCreation,
  getOriginImmunities,
  getSpecialAttributeMax,
  getSpecialAttributeMin,
  parseOriginSpecialOverrides,
  resolveActorSystemOrigin,
  type PackSystemOriginRule,
  type SpecialKey,
} from "./originRules.js";
import {
  canSetSpecialValue,
  clampSpecialValue,
  computeSpecialPointsBudget,
} from "./specialRules.js";
import { enrichHtml } from "../integrations/foundryText.js";
import { t } from "../integrations/i18n.js";
import { wrapPipBoyGlossary } from "../integrations/pipBoyGlossary.js";
import { wrapTagSkillGlossary } from "../integrations/tagSkillGlossary.js";
import { ROBOT_ARM_WEAPON_AMMO_SHOTS } from "./robotArmEquipment.js";
import { applyWizardToActor } from "./applyWizardToActor.js";
import {
  createInitialWizardState,
  isStepComplete,
  stepIndex,
  validateAllWizardSteps,
  validateCurrentStep,
  WIZARD_STEPS,
  type ValidateWizardContext,
  type WizardState,
  type WizardStepId,
} from "./WizardState.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export interface OriginDefinition {
  id: string;
  label: string;
  phase: 1 | 2;
  systemOrigin: string;
  tagline: string;
  traitName: string | null;
  traitCompendiumUuid: string | null;
  extraTagRules: unknown[];
  extraPerkRules?: unknown[];
  equipmentPackId: string;
  packSystemOrigin?: PackSystemOriginRule;
  specialOverrides: Record<string, unknown>;
  detail: { flavor: string; benefit: string; penalty: string; flavorHighlight?: string };
}

export interface SurvivorTraitDefinition {
  id: string;
  label: string;
  icon: string;
  traitCompendiumUuid: string;
  benefit: string;
  penalty: string;
}

const ORIGINS = originsData as OriginDefinition[];
const SURVIVOR_TRAITS = survivorTraitsData as SurvivorTraitDefinition[];

export default class CharacterWizardApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static #openByActorId = new Map<string, CharacterWizardApp>();

  declare actor: Actor;
  state: WizardState;
  #skillsCache: SkillCompendiumEntry[] = [];
  #perksCache: Array<PerkCompendiumEntry & { met: boolean; reasons: string[] }> = [];
  #equipmentItemIndex: CompendiumItemIndexEntry[] = [];

  constructor(actor: Actor, options: ApplicationConfiguration = {}) {
    super(options);
    this.actor = actor;
    this.state = createInitialWizardState();
    this.#sanitizeOriginForActor();
    CharacterWizardApp.#openByActorId.set(actor.id, this);
  }

  /** Drop an origin that does not match this actor's sheet type (character vs robot). */
  #sanitizeOriginForActor(): void {
    const id = this.state.originId;
    if (!id || isOriginCompatibleWithActorType(id, this.actor.type)) return;
    this.#clearWizardProgressFromOrigin();
  }

  #resetWizardDownstreamFromOrigin(): void {
    this.state.skillRanks = {};
    this.state.taggedSkillNames = [];
    this.state.selectedPerkUuids = [];
    this.state.focusedPerkUuid = null;
    this.state.selectedEquipmentPackId = null;
    this.state.equipmentChoices = {};
    this.state.trinketRoll = null;
  }

  #clearWizardProgressFromOrigin(): void {
    this.state.originId = null;
    this.state.special = getDefaultSpecialForOrigin(
      parseOriginSpecialOverrides(undefined),
    );
    this.state.survivorTraitIds = [];
    this.state.survivorExtraPerk = false;
    this.#resetWizardDownstreamFromOrigin();
  }

  static override DEFAULT_OPTIONS = {
    id: "wastelander-character-wizard",
    uniqueId: true,
    classes: ["wastelander-wizard"],
    window: {
      title: "WASTELANDER.Wizard.Title",
      icon: "fa-solid fa-user-astronaut",
      resizable: true,
    },
    position: {
      width: 1122,
      height: 840,
    },
    actions: {
      back: CharacterWizardApp.#onBack,
      next: CharacterWizardApp.#onNext,
      goStep: CharacterWizardApp.#onGoStep,
      selectOrigin: CharacterWizardApp.#onSelectOrigin,
      toggleSurvivorTrait: CharacterWizardApp.#onToggleSurvivorTrait,
      adjustSpecial: CharacterWizardApp.#onAdjustSpecial,
      focusSpecial: CharacterWizardApp.#onFocusSpecial,
      resetSpecial: CharacterWizardApp.#onResetSpecial,
      toggleSkillTag: CharacterWizardApp.#onToggleSkillTag,
      adjustSkillRank: CharacterWizardApp.#onAdjustSkillRank,
      resetSkills: CharacterWizardApp.#onResetSkills,
      focusPerk: CharacterWizardApp.#onFocusPerk,
      togglePerkSelection: CharacterWizardApp.#onTogglePerkSelection,
      setSurvivorMode: CharacterWizardApp.#onSetSurvivorMode,
      selectEquipmentPack: CharacterWizardApp.#onSelectEquipmentPack,
      setEquipmentChoice: CharacterWizardApp.#onSetEquipmentChoice,
      rollTrinket: CharacterWizardApp.#onRollTrinket,
      viewCompendiumItem: CharacterWizardApp.#onViewCompendiumItem,
      finish: CharacterWizardApp.#onFinish,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/wizard/shell.hbs`,
      scrollable: [".wastelander-step-content", ".wastelander-skills-table", ".wastelander-perk-list"],
    },
  };

  get title(): string {
    return t("WASTELANDER.Wizard.WindowTitle");
  }

  static async renderForActor(actor: Actor): Promise<CharacterWizardApp | null> {
    const parent = resolveActor(actor);
    const existing = CharacterWizardApp.#openByActorId.get(parent.id);
    if (existing?.rendered) {
      existing.bringToFront?.();
      return existing;
    }
    const app = new CharacterWizardApp(parent);
    return app.render({ force: true });
  }

  /** Stop click-to-focus from scrolling nested lists back to the focused control. */
  #bindPreventFocusScroll(root: HTMLElement, selector: string): void {
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      el.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
      });
    });
  }

  #originById(id: string | null): OriginDefinition | undefined {
    if (!id) return undefined;
    return ORIGINS.find((o) => o.id === id);
  }

  async #enrichTraitHtml(origin: OriginDefinition | undefined): Promise<string> {
    if (!origin?.traitCompendiumUuid) return "";
    const item = await getCompendiumItem(origin.traitCompendiumUuid);
    if (!item) return "";
    const raw = (item.system as { description?: string }).description ?? "";
    return enrichHtml(raw);
  }

  /** Skill picks depend on INT and tags; clear when S.P.E.C.I.A.L. changes. */
  #clearSkillsProgress(): void {
    const hadSkills =
      this.state.taggedSkillNames.length > 0 ||
      Object.keys(this.state.skillRanks).length > 0;
    this.state.skillRanks = {};
    this.state.taggedSkillNames = [];
    this.#syncSkillsState();
    if (hadSkills && this.state.step === "skills") {
      ui.notifications.info(
        t("WASTELANDER.Wizard.Skills.ResetFromSpecial"),
      );
    }
  }

  #validationContext(): ValidateWizardContext {
    const perkEligibility: Record<string, boolean> = {};
    for (const perk of this.#perksCache) {
      perkEligibility[perk.uuid] = perk.met;
    }
    return {
      skillNames: this.#skillsCache.map((s) => s.name),
      perkEligibility,
      actorType: this.actor.type,
    };
  }

  #perkEvaluationContext() {
    return {
      special: this.state.special,
      level: 1,
      ownedPerkSlugs: [],
      readMagazineUuids: [],
    };
  }

  #syncSelectedPerks(): void {
    const eligible = new Set(
      this.#perksCache.filter((p) => p.met).map((p) => p.uuid),
    );
    this.state.selectedPerkUuids = this.state.selectedPerkUuids.filter((uuid) =>
      eligible.has(uuid),
    );
  }

  #equipmentGroupId(): string | undefined {
    return this.#originById(this.state.originId)?.equipmentPackId;
  }

  #selectedEquipmentPack(): EquipmentPackDefinition | undefined {
    const groupId = this.#equipmentGroupId();
    if (!groupId || !this.state.selectedEquipmentPackId) return undefined;
    return getEquipmentPack(groupId, this.state.selectedEquipmentPackId);
  }

  async #ensureEquipmentItemIndex(): Promise<CompendiumItemIndexEntry[]> {
    if (!this.#equipmentItemIndex.length) {
      this.#equipmentItemIndex = await buildEquipmentItemIndex();
    }
    return this.#equipmentItemIndex;
  }

  #buildEquipmentChoiceRows(
    pack: EquipmentPackDefinition | undefined,
    itemIndex: CompendiumItemIndexEntry[],
  ) {
    if (!pack?.choices?.length) return [];
    return pack.choices.map((choice) => ({
      id: choice.id,
      prompt: choice.prompt,
      options: choice.options.map((opt) => {
        const enriched = enrichEquipmentLine(opt.label, itemIndex);
        return {
          id: opt.id,
          label: opt.label,
          selected: this.state.equipmentChoices[choice.id] === opt.id,
          ...enriched,
        };
      }),
    }));
  }

  #syncFocusedPerk(): void {
    if (!this.#perksCache.length) {
      this.state.focusedPerkUuid = null;
      return;
    }
    const valid = this.#perksCache.some((p) => p.uuid === this.state.focusedPerkUuid);
    if (!valid) this.state.focusedPerkUuid = this.#perksCache[0]!.uuid;
  }

  #syncSkillsState(): void {
    const names = this.#skillsCache.map((s) => s.name);
    const origin = this.#originById(this.state.originId);
    const tagConfig = getSkillsTagConfig(origin, this.state.survivorTraitIds);
    this.state.taggedSkillNames = ensureForcedTags(
      names,
      this.state.taggedSkillNames,
      tagConfig,
    );
    for (const forced of tagConfig.forcedTags) {
      if (!names.includes(forced.skillName)) continue;
      this.state.skillRanks = applyTagOn(
        this.state.skillRanks,
        forced.skillName,
        tagConfig,
      );
    }
  }

  #originSpecialOverrides() {
    return parseOriginSpecialOverrides(this.#originById(this.state.originId)?.specialOverrides);
  }

  #specialBudgetOptions() {
    const origin = this.#originById(this.state.originId);
    return {
      originId: this.state.originId,
      survivorTraitIds: this.state.survivorTraitIds,
      originPointBonus: Number(this.#originSpecialOverrides().pointBonus ?? 0) || 0,
      specialOverrides: this.#originSpecialOverrides(),
    };
  }

  #getSpecialPointsBudget(special = this.state.special) {
    return computeSpecialPointsBudget(special, this.#specialBudgetOptions());
  }

  #canSetSpecialValue(attr: SpecialKey, next: number): boolean {
    return canSetSpecialValue(
      this.state.special,
      attr,
      next,
      this.#specialBudgetOptions(),
      this.#originSpecialOverrides(),
    );
  }

  #setSpecialValue(attr: SpecialKey, next: number): void {
    const clamped = clampSpecialValue(attr, next, this.#originSpecialOverrides());
    if (!this.#canSetSpecialValue(attr, clamped)) {
      if (clamped > this.state.special[attr]) {
        ui.notifications.warn("Not enough S.P.E.C.I.A.L. points remaining.");
      }
      return;
    }
    const changed = clamped !== this.state.special[attr];
    this.state.special[attr] = clamped;
    this.state.specialFocus = attr;
    if (changed) this.#clearSkillsProgress();
    void this.render({ force: true });
  }

  protected override async _prepareContext(
    options: ApplicationRenderOptions,
  ): Promise<Record<string, unknown>> {
    const context = await super._prepareContext(options);
    const currentIdx = stepIndex(this.state.step);
    const selectedOrigin = this.#originById(this.state.originId);
    const isSurvivorSelected = selectedOrigin?.id === "survivor";
    const isSpecialStep = this.state.step === "special";
    const isSkillsStep = this.state.step === "skills";
    const isPerkStep = this.state.step === "perk";
    const isEquipmentStep = this.state.step === "equipment";
    const isReviewStep = this.state.step === "review";
    if ((isSkillsStep || isReviewStep || isSpecialStep) && !this.#skillsCache.length) {
      this.#skillsCache = await listSkillsFromCompendium();
      if (isSkillsStep || isReviewStep) this.#syncSkillsState();
    }
    if (isPerkStep || isReviewStep) {
      this.#perksCache = await listPerksFromCompendium(this.#perkEvaluationContext());
      this.#syncSelectedPerks();
      if (isPerkStep) this.#syncFocusedPerk();
    }

    const validationContext = this.#validationContext();
    const validationError = validateCurrentStep(this.state, validationContext);
    const finishError = isReviewStep
      ? validateAllWizardSteps(this.state, validationContext)
      : null;

    const steps = WIZARD_STEPS.map((id, index) => {
      const completed = isStepComplete(this.state, id);
      const active = this.state.step === id;
      const clickable = index <= currentIdx || completed;
      return {
        id,
        number: index + 1,
        label: t(`WASTELANDER.Wizard.Steps.${id}`),
        active,
        completed,
        clickable,
      };
    });

    const actorType = this.actor.type;
    const origins = ORIGINS.map((origin) => {
      const disableReason = getOriginDisableReason(origin.id, actorType);
      const enabled = disableReason === null;
      let disabledReason = "";
      let disabledLabel = "";
      if (disableReason === "robot-only") {
        disabledReason = t("WASTELANDER.Wizard.Origin.DisabledRobotOnly.Hint");
        disabledLabel = t("WASTELANDER.Wizard.Origin.DisabledRobotOnly.Short");
      } else if (disableReason === "human-only") {
        disabledReason = t("WASTELANDER.Wizard.Origin.DisabledHumanOnRobot.Hint");
        disabledLabel = t("WASTELANDER.Wizard.Origin.DisabledHumanOnRobot.Short");
      }
      return {
        ...origin,
        iconSrc: `${MODULE_PATH}/assets/origins/${origin.id}.png`,
        enabled,
        selected: origin.id === this.state.originId,
        disabledReason,
        disabledLabel,
      };
    });

    const traitHtml = await this.#enrichTraitHtml(selectedOrigin);

    const specialBudget = this.#getSpecialPointsBudget();
    const specialPointsText = `Points remaining: ${specialBudget.remaining} / ${specialBudget.total}`;

    const attrMeta: Array<{ key: FalloutAttributeKey; label: string; blurb: string }> = [
      { key: "str", label: "Strength", blurb: t("WASTELANDER.Wizard.Special.Blurb.str") },
      { key: "per", label: "Perception", blurb: t("WASTELANDER.Wizard.Special.Blurb.per") },
      { key: "end", label: "Endurance", blurb: t("WASTELANDER.Wizard.Special.Blurb.end") },
      { key: "cha", label: "Charisma", blurb: t("WASTELANDER.Wizard.Special.Blurb.cha") },
      { key: "int", label: "Intelligence", blurb: t("WASTELANDER.Wizard.Special.Blurb.int") },
      { key: "agi", label: "Agility", blurb: t("WASTELANDER.Wizard.Special.Blurb.agi") },
      { key: "luc", label: "Luck", blurb: t("WASTELANDER.Wizard.Special.Blurb.luc") },
    ];

    const specialOverrides = this.#originSpecialOverrides();
    const specialRows = attrMeta.map((m) => {
      const value = this.state.special[m.key];
      const attrMin = getSpecialAttributeMin(m.key, specialOverrides);
      const attrMax = getSpecialAttributeMax(m.key, specialOverrides);
      return {
        ...m,
        initial: m.label.slice(0, 1),
        rest: m.label.slice(1),
        value,
        attrMin,
        attrMax,
        active: this.state.specialFocus === m.key,
        canDecrease: value > attrMin,
        canIncrease: value < attrMax && this.#canSetSpecialValue(m.key, value + 1),
      };
    });

    const specialFocusKey = this.state.specialFocus;
    const specialFocusMeta = attrMeta.find((m) => m.key === specialFocusKey);
    const specialFocusLabel = specialFocusMeta?.label ?? specialFocusKey.toUpperCase();
    const specialFocusValue = this.state.special[specialFocusKey];

    const specialFocusSkills = isSpecialStep
      ? this.#skillsCache
          .filter((s) => s.defaultAttribute === specialFocusKey)
          .map((s) => ({ name: s.name }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    const perkRequirements = isSpecialStep
      ? await listPerksRequiringAttribute(specialFocusKey)
      : [];
    const perksUnlocked = perkRequirements
      .filter((p) => specialFocusValue >= p.required)
      .map((p) => ({
        ...p,
        met: true,
      }));
    const perksLocked = perkRequirements
      .filter((p) => specialFocusValue < p.required)
      .map((p) => ({
        ...p,
        met: false,
      }));

    const origin = selectedOrigin ?? undefined;
    const tagConfig = getSkillsTagConfig(origin, this.state.survivorTraitIds);
    const skillNames = this.#skillsCache.map((s) => s.name);
    const skillBudget = isSkillsStep
      ? getSkillPointsBudget(
          this.state.special.int,
          skillNames,
          this.state.skillRanks,
          this.state.taggedSkillNames,
          tagConfig,
        )
      : { total: 0, spent: 0, remaining: 0 };
    const skillPointsText = isSkillsStep
      ? `Skill points remaining: ${skillBudget.remaining} / ${skillBudget.total}`
      : "";
    const tagCountText = isSkillsStep
      ? `Tag skills: ${countVoluntaryTagged(this.state.taggedSkillNames, tagConfig)} / ${tagConfig.totalTagSlots}`
      : "";
    const tagRulesLines = isSkillsStep
      ? getTagRulesSummary(origin, tagConfig)
      : [];
    const forcedTagNames = new Set(tagConfig.forcedTags.map((f) => f.skillName));

    const maxSkillRank = getMaxSkillRankAtCreation(this.state.originId);
    const skillRows = isSkillsStep
      ? this.#skillsCache.map((skill) => {
          const tagged = this.state.taggedSkillNames.includes(skill.name);
          const forced = forcedTagNames.has(skill.name);
          const baseRank = getSkillBaseRank(
            skill.name,
            this.state.taggedSkillNames,
            tagConfig.forcedTags,
          );
          const rank = getEffectiveSkillRank(
            skill.name,
            this.state.skillRanks,
            this.state.taggedSkillNames,
            tagConfig.forcedTags,
          );
          const addCheck = canAddSkillTag(
            skill.name,
            this.state.taggedSkillNames,
            tagConfig,
          );
          return {
            name: skill.name,
            summary: getSkillSummary(skill.name),
            attr: skill.defaultAttribute.toUpperCase(),
            tagged,
            forced,
            rank,
            baseRank,
            canIncrease: rank < maxSkillRank && skillBudget.remaining > 0,
            canDecrease: rank > baseRank,
            canTagOn: !tagged && addCheck.allowed,
            canTagOff: tagged && canRemoveSkillTag(skill.name, tagConfig).allowed,
            tagTitle: forced
              ? "Required tag for your origin"
              : tagged
                ? "Remove tag"
                : addCheck.reason ?? "Mark as tag skill",
          };
        })
      : [];

    const requiredPerkCount = getRequiredPerkCount(origin, this.state.survivorExtraPerk);
    const perkRulesLines = isPerkStep
      ? getPerkStepSummary(origin, this.state.survivorExtraPerk, requiredPerkCount)
      : [];
    const perkCountText = isPerkStep
      ? `Perks selected: ${this.state.selectedPerkUuids.length} / ${requiredPerkCount}`
      : "";
    const maxPerksChosen = this.state.selectedPerkUuids.length >= requiredPerkCount;
    const focusedPerkUuid = isPerkStep ? this.state.focusedPerkUuid : null;
    const perkPickerRows = isPerkStep
      ? this.#perksCache.map((perk) => {
          const selected = this.state.selectedPerkUuids.includes(perk.uuid);
          const canToggle =
            selected || (perk.met && !maxPerksChosen);
          return {
            uuid: perk.uuid,
            name: perk.name,
            met: perk.met,
            selected,
            focused: perk.uuid === focusedPerkUuid,
            canToggle,
          };
        })
      : [];

    let focusedPerkDetail: Record<string, unknown> | null = null;
    if (isPerkStep && focusedPerkUuid) {
      const focused = this.#perksCache.find((p) => p.uuid === focusedPerkUuid);
      if (focused) {
        const descriptionHtml = await enrichHtml(focused.descriptionHtml);
        const companionStatBlockHtml = getCompanionStatBlockHtmlForPerk(focused.name);
        focusedPerkDetail = {
          name: focused.name,
          descriptionHtml,
          requirementsText: focused.requirementsText,
          met: focused.met,
          unmetReasons: focused.reasons,
          companionStatBlockHtml,
        };
      }
    }

    const equipmentGroupId = this.#equipmentGroupId();
    const equipmentGroup = equipmentGroupId
      ? getEquipmentPackGroup(equipmentGroupId)
      : undefined;
    const selectedPack = this.#selectedEquipmentPack();
    const equipmentPacks =
      isEquipmentStep && equipmentGroup
        ? equipmentGroup.packs.map((pack) => ({
            ...pack,
            selected: pack.id === this.state.selectedEquipmentPackId,
          }))
        : [];
    const needsItemIndex = isEquipmentStep || isReviewStep;
    const equipmentItemIndex = needsItemIndex ? await this.#ensureEquipmentItemIndex() : [];

    const rawEquipmentItems = selectedPack
      ? resolvePackItems(selectedPack, this.state.equipmentChoices, {
          robotArmAmmoShots:
            equipmentGroupId === "mister-handy"
              ? ROBOT_ARM_WEAPON_AMMO_SHOTS
              : undefined,
        })
      : [];
    const equipmentResolvedItems = enrichEquipmentLines(rawEquipmentItems, equipmentItemIndex);
    const tagSkillLootLines = getTagSkillLootLines(this.state.taggedSkillNames).map((row) => ({
      ...row,
      ...enrichEquipmentLine(row.loot, equipmentItemIndex),
    }));
    const trinketText =
      this.state.trinketRoll !== null ? rollTrinket(this.state.trinketRoll) : "";

    const derivedStats = formatDerivedStatisticsForDisplay(
      computeDerivedStatistics(this.state),
    );
    const originImmunities = getOriginImmunities(this.state.originId).map((key) => ({
      key,
      label: key === "radiation" ? "Radiation" : "Poison",
    }));
    const selectedPerkNames = this.state.selectedPerkUuids
      .map((uuid) => this.#perksCache.find((p) => p.uuid === uuid)?.name)
      .filter((n): n is string => Boolean(n));
    const specialSummary = Object.entries(this.state.special).map(([key, value]) => ({
      key: key.toUpperCase(),
      value,
    }));

    const selectedOriginView = selectedOrigin
      ? {
          ...selectedOrigin,
          detail: {
            flavor: wrapTagSkillGlossary(selectedOrigin.detail.flavor),
            flavorHighlight: selectedOrigin.detail.flavorHighlight
              ? wrapPipBoyGlossary(
                  wrapTagSkillGlossary(selectedOrigin.detail.flavorHighlight),
                )
              : "",
            benefit: wrapTagSkillGlossary(selectedOrigin.detail.benefit),
            penalty: wrapTagSkillGlossary(selectedOrigin.detail.penalty),
          },
        }
      : null;

    return {
      ...context,
      actor: this.actor,
      steps,
      stepHeading: t(
        `WASTELANDER.Wizard.StepHeading.${this.state.step}`,
        undefined,
        { glossary: !isSkillsStep },
      ),
      stepId: this.state.step,
      isOriginStep: this.state.step === "origin",
      isSpecialStep,
      isSkillsStep,
      isPerkStep,
      isEquipmentStep,
      isReviewStep,
      isPlaceholderStep: false,
      equipmentGroupLabel: equipmentGroup?.label ?? "",
      equipmentGroupDescription: wrapTagSkillGlossary(
        equipmentGroup?.description ?? "",
      ),
      equipmentPacks,
      selectedEquipmentPack: selectedPack ?? null,
      equipmentResolvedItems,
      equipmentChoiceRows: this.#buildEquipmentChoiceRows(selectedPack, equipmentItemIndex),
      equipmentHasTrinket: Boolean(selectedPack?.hasTrinket),
      trinketRoll: this.state.trinketRoll,
      trinketText,
      tagSkillLootLines,
      derivedStats,
      originImmunities,
      resolvedOriginName:
        selectedOrigin && selectedPack
          ? resolveActorSystemOrigin(selectedOrigin, selectedPack)
          : "",
      reviewOriginName:
        (selectedOrigin && selectedPack
          ? resolveActorSystemOrigin(selectedOrigin, selectedPack)
          : selectedOrigin?.systemOrigin) ||
        selectedOrigin?.label ||
        "—",
      reviewPerkNames: selectedPerkNames,
      reviewTagSkillNames: this.state.taggedSkillNames,
      reviewPackName: selectedPack?.label ?? "—",
      specialSummary,
      perkPickerRows,
      focusedPerkDetail,
      perkCountText,
      perkRulesLines,
      requiredPerkCount,
      survivorExtraPerk: this.state.survivorExtraPerk,
      skillRows,
      maxSkillRank,
      skillPointsText,
      tagCountText,
      tagRulesLines,
      origins,
      selectedOrigin: selectedOriginView,
      isSurvivorSelected,
      survivorTraits: SURVIVOR_TRAITS.map((trait) => ({
        ...trait,
        benefit: wrapTagSkillGlossary(trait.benefit),
        penalty: wrapTagSkillGlossary(trait.penalty),
        selected: this.state.survivorTraitIds.includes(trait.id),
        disabled:
          !this.state.survivorTraitIds.includes(trait.id) &&
          (this.state.survivorExtraPerk
            ? this.state.survivorTraitIds.length >= 1
            : this.state.survivorTraitIds.length >= 2),
      })),
      survivorTraitCount: this.state.survivorTraitIds.length,
      traitHtml,
      specialPointsRemaining: specialBudget.remaining,
      specialPointsTotal: specialBudget.total,
      specialPointsText,
      specialRows,
      specialFocusLabel,
      specialFocusValue,
      specialFocusSkills,
      perksUnlocked,
      perksLocked,
      canBack: currentIdx > 0,
      canNext: validationError === null && this.state.step !== "review",
      canFinish: isReviewStep,
      finishDisabled: finishError !== null,
      finishError: finishError ?? "",
      validationError:
        validationError && !isSkillsStep
          ? wrapTagSkillGlossary(validationError)
          : (validationError ?? ""),
      strings: {
        back: t("WASTELANDER.Wizard.Back"),
        next: t("WASTELANDER.Wizard.Next"),
        finish: t("WASTELANDER.Wizard.Finish"),
        selectOrigin: t("WASTELANDER.Wizard.SelectOrigin"),
        selectOriginHint: t("WASTELANDER.Wizard.SelectOriginHint"),
        originDetail: t("WASTELANDER.Wizard.OriginDetail"),
        trait: t("WASTELANDER.Wizard.Trait"),
        originRules: t("WASTELANDER.Wizard.OriginRules"),
        benefit: t("WASTELANDER.Wizard.Benefit"),
        penalty: t("WASTELANDER.Wizard.Penalty"),
        placeholder: t("WASTELANDER.Wizard.Placeholder"),
        specialInstructions: t("WASTELANDER.Wizard.Special.Instructions"),
        pointsRemaining: t("WASTELANDER.Wizard.Special.PointsRemaining", {
          remaining: specialBudget.remaining,
          total: specialBudget.total,
        }),
        specialSkillsFor: t("WASTELANDER.Wizard.Special.SkillsFor", {
          attribute: specialFocusLabel,
        }),
        specialPerksUnlocked: t("WASTELANDER.Wizard.Special.PerksUnlocked"),
        specialPerksLocked: t("WASTELANDER.Wizard.Special.PerksLocked", {
          attribute: specialFocusLabel,
        }),
        specialNoSkills: t("WASTELANDER.Wizard.Special.NoSkillsForAttribute"),
        specialNoPerksUnlocked: t("WASTELANDER.Wizard.Special.NoPerksUnlocked"),
        specialNoPerksLocked: t("WASTELANDER.Wizard.Special.NoPerksLocked"),
        reset: t("WASTELANDER.Wizard.Special.Reset"),
        skillsInstructions: t(
          "WASTELANDER.Wizard.Skills.Instructions",
          { max: maxSkillRank },
          { glossary: false },
        ),
        tagSkills: t("WASTELANDER.Wizard.Skills.TagColumn", undefined, {
          glossary: false,
        }),
        skillRank: t("WASTELANDER.Wizard.Skills.RankColumn"),
        perksInstructions: t("WASTELANDER.Wizard.Perks.Instructions"),
        perksSelectHint: t("WASTELANDER.Wizard.Perks.SelectHint"),
        perksRequirements: t("WASTELANDER.Wizard.Perks.Requirements"),
        perksNotMet: t("WASTELANDER.Wizard.Perks.NotMet"),
        survivorModeTwoTraits: t("WASTELANDER.Wizard.Origin.SurvivorTwoTraits"),
        survivorModeTraitPerk: t("WASTELANDER.Wizard.Origin.SurvivorTraitPerk"),
        equipmentInstructions: t("WASTELANDER.Wizard.Equipment.Instructions"),
        equipmentPackItems: t("WASTELANDER.Wizard.Equipment.PackItems"),
        equipmentTagLoot: t("WASTELANDER.Wizard.Equipment.TagLoot"),
        equipmentTrinket: t("WASTELANDER.Wizard.Equipment.Trinket"),
        equipmentRollTrinket: t("WASTELANDER.Wizard.Equipment.RollTrinket"),
        equipmentTrinketRollLabel: t("WASTELANDER.Wizard.Equipment.TrinketRollLabel"),
        equipmentCompendiumHint: t("WASTELANDER.Wizard.Equipment.CompendiumHint"),
        equipmentSelectPack: t("WASTELANDER.Wizard.Equipment.SelectPack"),
        reviewDerived: t("WASTELANDER.Wizard.Review.Derived"),
        reviewImmunities: t("WASTELANDER.Wizard.Review.Immunities"),
        reviewImmunitiesNone: t("WASTELANDER.Wizard.Review.ImmunitiesNone"),
        reviewOrigin: t("WASTELANDER.Wizard.Review.Origin"),
        reviewSpecial: t("WASTELANDER.Wizard.Review.Special"),
        reviewTags: t("WASTELANDER.Wizard.Review.Tags"),
        reviewPerks: t("WASTELANDER.Wizard.Review.Perks"),
        reviewEquipment: t("WASTELANDER.Wizard.Review.Equipment"),
        reviewTagLoot: t("WASTELANDER.Wizard.Review.TagLoot"),
        newWastelander: t("WASTELANDER.Wizard.NewWastelander", {
          name: this.actor.name,
        }),
      },
    };
  }

  protected override _onRender(context: Record<string, unknown>, options: ApplicationRenderOptions): void {
    super._onRender(context, options);
    const root = this.element?.[0] as HTMLElement | undefined;
    if (!root) return;

    if (this.state.step === "special") {
      root.querySelectorAll<HTMLInputElement>("input.wastelander-special-input").forEach((input) => {
        input.onchange = () => {
          const key = input.dataset.attr as FalloutAttributeKey | undefined;
          if (!key) return;
          const raw = Number(input.value);
          if (!Number.isFinite(raw)) return;
          this.#setSpecialValue(key, raw);
        };
      });
    }

    if (this.state.step === "skills") {
      this.#bindPreventFocusScroll(
        root,
        ".wastelander-skill-step, .wastelander-skill-tag",
      );
      root.querySelectorAll<HTMLInputElement>("input.wastelander-skill-input").forEach((input) => {
        input.onchange = () => {
          const skillName = input.dataset.skillName;
          if (!skillName) return;
          this.#setSkillRank(skillName, Number(input.value));
        };
      });
    }

    if (this.state.step === "perk") {
      this.#bindPreventFocusScroll(
        root,
        ".wastelander-perk-check, .wastelander-perk-row-label",
      );
    }

    if (this.state.step === "equipment") {
      root.querySelectorAll<HTMLInputElement>("input.wastelander-trinket-input").forEach((input) => {
        input.onchange = () => {
          const raw = Number(input.value);
          if (!Number.isFinite(raw)) return;
          this.state.trinketRoll = Math.max(1, Math.min(20, Math.trunc(raw)));
          void this.render({ force: true });
        };
      });
    }
  }

  #setSkillRank(skillName: string, raw: number): void {
    if (!Number.isFinite(raw)) return;
    const origin = this.#originById(this.state.originId);
    const tagConfig = getSkillsTagConfig(origin, this.state.survivorTraitIds);
    const baseRank = getSkillBaseRank(
      skillName,
      this.state.taggedSkillNames,
      tagConfig.forcedTags,
    );
    const maxRank = getMaxSkillRankAtCreation(this.state.originId);
    const next = Math.max(baseRank, Math.min(maxRank, Math.trunc(raw)));
    const current = getEffectiveSkillRank(
      skillName,
      this.state.skillRanks,
      this.state.taggedSkillNames,
      tagConfig.forcedTags,
    );
    if (next > current) {
      const budget = getSkillPointsBudget(
        this.state.special.int,
        this.#skillsCache.map((s) => s.name),
        this.state.skillRanks,
        this.state.taggedSkillNames,
        tagConfig,
      );
      const needed = next - current;
      if (budget.remaining < needed) {
        ui.notifications.warn("Not enough skill points remaining.");
        return;
      }
    }

    const ranks = { ...this.state.skillRanks };
    if (next <= baseRank) delete ranks[skillName];
    else ranks[skillName] = next;
    this.state.skillRanks = ranks;
    void this.render({ force: true });
  }

  #goToStep(step: WizardStepId): void {
    if (!WIZARD_STEPS.includes(step)) return;
    const targetIdx = stepIndex(step);
    const currentIdx = stepIndex(this.state.step);
    if (targetIdx > currentIdx) {
      const err = validateCurrentStep(this.state, this.#validationContext());
      if (err) {
        ui.notifications.warn(err);
        return;
      }
    }
    this.state.step = step;
    void this.render({ force: true });
  }

  static #onBack(
    this: CharacterWizardApp,
    _event: PointerEvent,
    _target: HTMLElement,
  ): void {
    const idx = stepIndex(this.state.step);
    if (idx <= 0) return;
    this.state.step = WIZARD_STEPS[idx - 1]!;
    void this.render({ force: true });
  }

  static #onNext(
    this: CharacterWizardApp,
    _event: PointerEvent,
    _target: HTMLElement,
  ): void {
    const err = validateCurrentStep(this.state, this.#validationContext());
    if (err) {
      ui.notifications.warn(err);
      return;
    }
    const idx = stepIndex(this.state.step);
    if (idx >= WIZARD_STEPS.length - 1) return;
    this.state.step = WIZARD_STEPS[idx + 1]!;
    void this.render({ force: true });
  }

  static #onGoStep(
    this: CharacterWizardApp,
    event: PointerEvent,
    target: HTMLElement,
  ): void {
    // Foundry's ApplicationV2 passes the clicked [data-action] element as `target`.
    // `event.currentTarget` is the application frame, not the button.
    const step = target.dataset.step as WizardStepId | undefined;
    if (!step) return;

    const targetIdx = stepIndex(step);
    const currentIdx = stepIndex(this.state.step);
    if (targetIdx > currentIdx) {
      const err = validateCurrentStep(this.state, this.#validationContext());
      if (err) {
        ui.notifications.warn(err);
        return;
      }
    }

    this.#goToStep(step);
  }

  static #onSelectOrigin(
    this: CharacterWizardApp,
    event: PointerEvent,
    target: HTMLElement,
  ): void {
    // See note above: use the action target, not event.currentTarget.
    const originId = target.dataset.originId;
    if (!originId) return;
    if (target.dataset.disabled === "true") return;

    if (this.state.originId && this.state.originId !== originId) {
      // Future: confirm dialog when clearing downstream choices
    }

    this.state.originId = originId;
    const origin = this.#originById(originId);
    this.state.special = getDefaultSpecialForOrigin(
      parseOriginSpecialOverrides(origin?.specialOverrides),
    );
    if (originId !== "survivor") {
      this.state.survivorTraitIds = [];
      this.state.survivorExtraPerk = false;
    }
    this.#resetWizardDownstreamFromOrigin();
    void this.render({ force: true });
  }

  static #onSetSurvivorMode(
    this: CharacterWizardApp,
    _event: PointerEvent,
    target: HTMLElement,
  ): void {
    if (this.state.originId !== "survivor") return;
    const mode = target.dataset.mode;
    const extraPerk = mode === "trait-and-perk";
    if (extraPerk === this.state.survivorExtraPerk) return;

    this.state.survivorExtraPerk = extraPerk;
    this.state.survivorTraitIds = [];
    this.state.selectedPerkUuids = [];
    this.state.focusedPerkUuid = null;
    void this.render({ force: true });
  }

  static #onToggleSurvivorTrait(
    this: CharacterWizardApp,
    _event: PointerEvent,
    target: HTMLElement,
  ): void {
    if (this.state.originId !== "survivor") return;
    const traitId = target.dataset.traitId;
    if (!traitId) return;

    const current = new Set(this.state.survivorTraitIds);
    const maxTraits = this.state.survivorExtraPerk ? 1 : 2;
    if (current.has(traitId)) current.delete(traitId);
    else {
      if (current.size >= maxTraits) return;
      current.add(traitId);
    }

    this.state.survivorTraitIds = Array.from(current);
    void this.render({ force: true });
  }

  static #onAdjustSpecial(
    this: CharacterWizardApp,
    _event: PointerEvent,
    target: HTMLElement,
  ): void {
    if (this.state.step !== "special") return;
    const attr = target.dataset.attr as FalloutAttributeKey | undefined;
    const delta = Number(target.dataset.delta ?? 0);
    if (!attr || !delta) return;
    const current = this.state.special[attr];
    const next = current + delta;
    this.#setSpecialValue(attr, next);
  }

  static #onFocusSpecial(
    this: CharacterWizardApp,
    _event: PointerEvent,
    target: HTMLElement,
  ): void {
    if (this.state.step !== "special") return;
    const attr = target.dataset.attr as FalloutAttributeKey | undefined;
    if (!attr) return;
    this.state.specialFocus = attr;
    void this.render({ force: true });
  }

  static #onResetSpecial(
    this: CharacterWizardApp,
    _event: PointerEvent,
    _target: HTMLElement,
  ): void {
    if (this.state.step !== "special") return;
    this.state.special = getDefaultSpecialForOrigin(this.#originSpecialOverrides());
    this.#clearSkillsProgress();
    void this.render({ force: true });
  }

  static #onToggleSkillTag(
    this: CharacterWizardApp,
    _event: PointerEvent,
    target: HTMLElement,
  ): void {
    if (this.state.step !== "skills") return;
    const skillName = target.dataset.skillName;
    if (!skillName) return;

    const origin = this.#originById(this.state.originId);
    const tagConfig = getSkillsTagConfig(origin, this.state.survivorTraitIds);
    const tagged = this.state.taggedSkillNames.includes(skillName);

    if (tagged) {
      const remove = canRemoveSkillTag(skillName, tagConfig);
      if (!remove.allowed) {
        ui.notifications.warn(remove.reason ?? "Cannot remove this tag.");
        return;
      }
      this.state.taggedSkillNames = this.state.taggedSkillNames.filter((n) => n !== skillName);
      this.state.skillRanks = applyTagOff(this.state.skillRanks, skillName);
    } else {
      const add = canAddSkillTag(skillName, this.state.taggedSkillNames, tagConfig);
      if (!add.allowed) {
        ui.notifications.warn(add.reason ?? "Cannot tag this skill.");
        return;
      }
      this.state.taggedSkillNames = [...this.state.taggedSkillNames, skillName];
      this.state.skillRanks = applyTagOn(this.state.skillRanks, skillName, tagConfig);
    }

    void this.render({ force: true });
  }

  static #onAdjustSkillRank(
    this: CharacterWizardApp,
    _event: PointerEvent,
    target: HTMLElement,
  ): void {
    if (this.state.step !== "skills") return;
    const skillName = target.dataset.skillName;
    const delta = Number(target.dataset.delta ?? 0);
    if (!skillName || !delta) return;

    const origin = this.#originById(this.state.originId);
    const tagConfig = getSkillsTagConfig(origin, this.state.survivorTraitIds);
    const current = getEffectiveSkillRank(
      skillName,
      this.state.skillRanks,
      this.state.taggedSkillNames,
      tagConfig.forcedTags,
    );
    this.#setSkillRank(skillName, current + delta);
  }

  static #onResetSkills(
    this: CharacterWizardApp,
    _event: PointerEvent,
    _target: HTMLElement,
  ): void {
    if (this.state.step !== "skills") return;
    this.state.skillRanks = {};
    this.state.taggedSkillNames = [];
    this.#syncSkillsState();
    void this.render({ force: true });
  }

  static #onFocusPerk(
    this: CharacterWizardApp,
    _event: PointerEvent,
    target: HTMLElement,
  ): void {
    if (this.state.step !== "perk") return;
    const uuid = target.dataset.perkUuid;
    if (!uuid || uuid === this.state.focusedPerkUuid) return;
    this.state.focusedPerkUuid = uuid;
    void this.render({ force: true });
  }

  static #onTogglePerkSelection(
    this: CharacterWizardApp,
    _event: PointerEvent,
    target: HTMLElement,
  ): void {
    if (this.state.step !== "perk") return;
    const uuid = target.dataset.perkUuid;
    if (!uuid) return;

    const perk = this.#perksCache.find((p) => p.uuid === uuid);
    if (!perk) return;

    const origin = this.#originById(this.state.originId);
    const required = getRequiredPerkCount(origin, this.state.survivorExtraPerk);
    const selected = this.state.selectedPerkUuids;

    if (selected.includes(uuid)) {
      this.state.selectedPerkUuids = selected.filter((id) => id !== uuid);
      void this.render({ force: true });
      return;
    }

    if (!perk.met) {
      ui.notifications.warn(perk.reasons[0] ?? "Requirements not met.");
      return;
    }

    if (selected.length >= required) {
      ui.notifications.warn(`You can only choose ${required} perk(s).`);
      return;
    }

    this.state.selectedPerkUuids = [...selected, uuid];
    this.state.focusedPerkUuid = uuid;
    void this.render({ force: true });
  }

  static #onSelectEquipmentPack(
    this: CharacterWizardApp,
    _event: PointerEvent,
    target: HTMLElement,
  ): void {
    if (this.state.step !== "equipment") return;
    const packId = target.dataset.packId;
    if (!packId) return;
    this.state.selectedEquipmentPackId = packId;
    this.state.equipmentChoices = {};
    this.state.trinketRoll = null;
    void this.render({ force: true });
  }

  static #onSetEquipmentChoice(
    this: CharacterWizardApp,
    _event: PointerEvent,
    target: HTMLElement,
  ): void {
    if (this.state.step !== "equipment") return;
    const choiceId = target.dataset.choiceId;
    const optionId = target.dataset.optionId;
    if (!choiceId || !optionId) return;
    this.state.equipmentChoices = {
      ...this.state.equipmentChoices,
      [choiceId]: optionId,
    };
    void this.render({ force: true });
  }

  static async #onRollTrinket(
    this: CharacterWizardApp,
    _event: PointerEvent,
    _target: HTMLElement,
  ): Promise<void> {
    if (this.state.step !== "equipment") return;
    const { roll, result } = await rollTrinketRandom(this.actor);
    this.state.trinketRoll = roll;
    ui.notifications.info(`Trinket (d20 = ${roll}): ${result}`);
    void this.render({ force: true });
  }

  static #onViewCompendiumItem(
    this: CharacterWizardApp,
    event: PointerEvent,
    target: HTMLElement,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const uuid = target.dataset.itemUuid;
    if (!uuid) return;
    void openCompendiumItemSheet(uuid);
  }

  static #onFinish(
    this: CharacterWizardApp,
    _event: PointerEvent,
    _target: HTMLElement,
  ): void {
    if (this.state.step !== "review") return;
    void this.#finishWizard();
  }

  async #finishWizard(): Promise<void> {
    if (!this.#skillsCache.length) {
      this.#skillsCache = await listSkillsFromCompendium();
    }

    const context = this.#validationContext();
    const err = validateAllWizardSteps(this.state, context);
    if (err) {
      ui.notifications.warn(err);
      return;
    }

    let applied = false;
    try {
      await applyWizardToActor(this.actor, this.state, {
        skillEntries: this.#skillsCache.map((s) => ({
          name: s.name,
          uuid: s.uuid,
        })),
        perkEligibility: context.perkEligibility,
      });
      applied = true;
      this.actor = resolveActor(this.actor);
      ui.notifications.info(
        t("WASTELANDER.Wizard.FinishSuccess"),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to apply character.";
      ui.notifications.error(message);
      return;
    } finally {
      if (applied) {
        await this.#closeWizard();
      }
    }

    this.actor.sheet?.render(false);
  }

  async #closeWizard(): Promise<void> {
    CharacterWizardApp.#openByActorId.delete(this.actor.id);

    try {
      await this.close({ animate: false });
    } catch (error) {
      console.warn(`${MODULE_ID} | wizard close()`, error);
    }

    document.getElementById(this.id)?.remove();

    const root = this.#rootElement();
    root?.closest(".application")?.remove();
    root?.closest(".window-app")?.remove();

    document
      .querySelectorAll(".application.wastelander-wizard")
      .forEach((node) => node.remove());

    const registered = foundry.applications.instances.get(this.appId);
    if (registered && registered !== this) {
      try {
        await registered.close({ animate: false });
      } catch {
        /* fall through */
      }
    }
    registered?.remove?.();
  }

  #rootElement(): HTMLElement | undefined {
    const raw = this.element as HTMLElement | HTMLElement[] | undefined;
    if (!raw) return undefined;
    if (raw instanceof HTMLElement) return raw;
    return raw[0];
  }
}
