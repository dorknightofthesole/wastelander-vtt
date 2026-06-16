import { MODULE_PATH } from "../constants.js";
import { refreshActorSheet, resolveActor } from "../integrations/falloutActor.js";
import { enrichHtml } from "../integrations/foundryText.js";
import { t } from "../integrations/i18n.js";
import { applyLevelUpPerk } from "./applyLevelUpPerk.js";
import { getCompanionStatBlockHtmlForPerk } from "./perkStatBlocks.js";
import {
  formatOwnedRankLabel,
  listPerksForLevelUp,
  type LevelUpPerkEntry,
} from "./levelUpPerks.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;


export default class LevelUpApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static #openByActorId = new Map<string, LevelUpApp>();

  declare actor: Actor;
  selectedPerkUuid: string | null = null;
  focusedPerkUuid: string | null = null;
  #perksCache: LevelUpPerkEntry[] = [];
  #applying = false;

  constructor(actor: Actor, options: ApplicationConfiguration = {}) {
    super(options);
    this.actor = actor;
    LevelUpApp.#openByActorId.set(actor.id, this);
  }

  static override DEFAULT_OPTIONS = {
    id: "wastelander-level-up",
    uniqueId: true,
    classes: ["wastelander-wizard", "wastelander-level-up-app"],
    window: {
      title: "WASTELANDER.LevelUp.Title",
      icon: "fa-solid fa-arrow-up",
      resizable: true,
    },
    position: {
      width: 900,
      height: 640,
    },
    actions: {
      focusPerk: LevelUpApp.onFocusPerk,
      togglePerkSelection: LevelUpApp.onTogglePerkSelection,
      cancel: LevelUpApp.onCancel,
      confirm: LevelUpApp.onConfirm,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/wizard/level-up.hbs`,
      scrollable: [".wastelander-perk-list", ".wastelander-perk-detail"],
    },
  };

  get title(): string {
    return t("WASTELANDER.LevelUp.WindowTitle", { name: this.actor.name });
  }

  static async renderForActor(actor: Actor): Promise<LevelUpApp | null> {
    const parent = resolveActor(actor);
    const existing = LevelUpApp.#openByActorId.get(parent.id);
    if (existing?.rendered) {
      existing.bringToFront();
      return existing;
    }

    const app = new LevelUpApp(parent);
    await app.render({ force: true });
    return app;
  }

  protected override async _onClose(options: ApplicationClosingOptions): Promise<void> {
    LevelUpApp.#openByActorId.delete(this.actor.id);
    return super._onClose(options);
  }

  #syncFocusedPerk(): void {
    if (
      this.focusedPerkUuid &&
      this.#perksCache.some((p) => p.uuid === this.focusedPerkUuid)
    ) {
      return;
    }
    const firstOwned = this.#perksCache.find((p) => p.ownedRank > 0);
    const firstPurchase = this.#perksCache.find((p) => p.canPurchase);
    this.focusedPerkUuid =
      firstOwned?.uuid ?? firstPurchase?.uuid ?? this.#perksCache[0]?.uuid ?? null;
  }

  protected override async _prepareContext(
    options: ApplicationRenderOptions,
  ): Promise<Record<string, unknown>> {
    const context = await super._prepareContext(options);
    this.#perksCache = await listPerksForLevelUp(this.actor);
    this.#syncFocusedPerk();

    if (
      this.selectedPerkUuid &&
      !this.#perksCache.some(
        (p) => p.uuid === this.selectedPerkUuid && p.canPurchase,
      )
    ) {
      this.selectedPerkUuid = null;
    }

    const system = this.actor.system as { level?: { value?: number } };
    const level = Number(system.level?.value ?? 1);
    const perkCountText = t("WASTELANDER.LevelUp.PerkCount", {
      selected: this.selectedPerkUuid ? 1 : 0,
    });

    const perkPickerRows = this.#perksCache.map((perk) => {
      const isOwned = perk.ownedRank > 0;
      const isOwnedLocked = isOwned && !(perk.multiRank && perk.canPurchase);
      const isPurchase = perk.uuid === this.selectedPerkUuid;
      const showChosen = isOwnedLocked || isPurchase;
      const canToggle = perk.canPurchase;
      return {
        uuid: perk.uuid,
        name: perk.name,
        met: perk.met,
        focused: perk.uuid === this.focusedPerkUuid,
        isOwned: isOwnedLocked,
        isPurchase,
        showChosen,
        canToggle,
        rankLabel: formatOwnedRankLabel(perk.ownedRank, perk.maxRank),
      };
    });

    let focusedPerkDetail: Record<string, unknown> | null = null;
    if (this.focusedPerkUuid) {
      const focused = this.#perksCache.find((p) => p.uuid === this.focusedPerkUuid);
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
          rankLabel: formatOwnedRankLabel(focused.ownedRank, focused.maxRank),
        };
      }
    }

    return {
      ...context,
      perkPickerRows,
      focusedPerkDetail,
      perkCountText,
      levelText: t("WASTELANDER.LevelUp.LevelLine", { level }),
      canConfirm: Boolean(this.selectedPerkUuid) && !this.#applying,
      strings: {
        title: t("WASTELANDER.LevelUp.Title"),
        instructions: t("WASTELANDER.LevelUp.Instructions"),
        placeholder: t("WASTELANDER.LevelUp.Empty"),
        selectHint: t("WASTELANDER.Wizard.Perks.SelectHint"),
        requirements: t("WASTELANDER.Wizard.Perks.Requirements"),
        notMet: t("WASTELANDER.Wizard.Perks.NotMet"),
        cancel: t("WASTELANDER.LevelUp.Cancel"),
        confirm: t("WASTELANDER.LevelUp.Confirm"),
      },
    };
  }

  static onFocusPerk(
    this: LevelUpApp,
    _event: PointerEvent,
    target: HTMLElement,
  ): void {
    const uuid = target.dataset.perkUuid;
    if (!uuid || uuid === this.focusedPerkUuid) return;
    this.focusedPerkUuid = uuid;
    void this.render({ force: true });
  }

  static onTogglePerkSelection(
    this: LevelUpApp,
    _event: PointerEvent,
    target: HTMLElement,
  ): void {
    const uuid = target.dataset.perkUuid;
    if (!uuid) return;

    const perk = this.#perksCache.find((p) => p.uuid === uuid);
    if (!perk?.canPurchase) {
      if (perk && !perk.met) {
        ui.notifications.warn(perk.reasons[0] ?? t("WASTELANDER.LevelUp.RequirementsNotMet"));
      }
      return;
    }

    if (this.selectedPerkUuid === uuid) {
      this.selectedPerkUuid = null;
    } else {
      this.selectedPerkUuid = uuid;
      this.focusedPerkUuid = uuid;
    }
    void this.render({ force: true });
  }

  static onCancel(this: LevelUpApp): void {
    void this.close();
  }

  static async onConfirm(this: LevelUpApp): Promise<void> {
    if (this.#applying || !this.selectedPerkUuid) return;

    const perk = this.#perksCache.find((p) => p.uuid === this.selectedPerkUuid);
    if (!perk?.canPurchase) {
      ui.notifications.warn(t("WASTELANDER.LevelUp.RequirementsNotMet"));
      return;
    }

    this.#applying = true;
    void this.render({ force: true });

    try {
      await applyLevelUpPerk(this.actor, this.selectedPerkUuid);
      this.actor = resolveActor(this.actor);
      refreshActorSheet(this.actor);
      ui.notifications.info(
        t("WASTELANDER.LevelUp.Success", { name: perk.name }),
      );
      await this.close();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t("WASTELANDER.LevelUp.Error");
      ui.notifications.error(message);
    } finally {
      this.#applying = false;
    }
  }
}
