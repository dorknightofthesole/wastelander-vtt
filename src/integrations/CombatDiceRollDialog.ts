import { MODULE_PATH } from "../constants.js";
import { t } from "./i18n.js";
import {
  FALLOUT_CD_EFFECT_ICON,
  getCombatDiceSpeakerActor,
  MAX_COMBAT_DICE,
  MIN_COMBAT_DICE,
  normalizeCombatDiceCount,
  rollAndPostCombatDice,
} from "./combatDiceRoll.js";

function resolveDialogRoot(
  root: HTMLElement | HTMLElement[] | undefined,
): HTMLElement | null {
  const el = Array.isArray(root) ? root[0] : root;
  return el ?? null;
}

function resolveDialogForm(
  root: HTMLElement | HTMLElement[] | undefined,
): HTMLFormElement | null {
  const el = resolveDialogRoot(root);
  if (!el) return null;
  if (el instanceof HTMLFormElement) return el;
  const nested = el.querySelector("form");
  return nested instanceof HTMLFormElement ? nested : null;
}

function findCountInput(root: HTMLElement | HTMLElement[] | undefined): HTMLInputElement | null {
  const form = resolveDialogForm(root);
  const host = resolveDialogRoot(root);
  const input =
    form?.querySelector<HTMLInputElement>('input[name="count"]') ??
    host?.querySelector<HTMLInputElement>('input[name="count"]');
  return input ?? null;
}

function readDialogFormState(root: HTMLElement | HTMLElement[] | undefined): {
  count: number | null;
  rollLabel: string;
} {
  const form = resolveDialogForm(root);
  const host = resolveDialogRoot(root);
  const countInput =
    form?.querySelector<HTMLInputElement>('input[name="count"]') ??
    host?.querySelector<HTMLInputElement>('input[name="count"]');
  const labelInput =
    form?.querySelector<HTMLInputElement>('input[name="rollLabel"]') ??
    host?.querySelector<HTMLInputElement>('input[name="rollLabel"]');

  return {
    count: normalizeCombatDiceCount(Number(countInput?.value)),
    rollLabel: labelInput?.value ?? "",
  };
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export default class CombatDiceRollDialog extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  #rolling = false;
  #selectedCount = 1;
  #rollLabel = "";

  static override DEFAULT_OPTIONS = {
    id: "wastelander-combat-dice-roll",
    tag: "form",
    classes: ["wastelander-wizard", "wastelander-combat-dice-roll-app"],
    window: {
      title: "WASTELANDER.CombatDiceRoll.Title",
      icon: `icons/svg/dice-grey.svg`,
    },
    position: { width: 360, height: "auto" },
    actions: {
      roll: CombatDiceRollDialog.#onRoll,
      cancel: CombatDiceRollDialog.#onCancel,
      decrementCount: CombatDiceRollDialog.#onDecrementCount,
      incrementCount: CombatDiceRollDialog.#onIncrementCount,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/chat/combat-dice-dialog.hbs`,
    },
  };

  protected override async _prepareContext(): Promise<Record<string, unknown>> {
    const actor = getCombatDiceSpeakerActor();
    return {
      actorName: actor?.name ?? "",
      atMaxCount: this.#selectedCount >= MAX_COMBAT_DICE,
      atMinCount: this.#selectedCount <= MIN_COMBAT_DICE,
      cdEffectIcon: FALLOUT_CD_EFFECT_ICON,
      maxCount: MAX_COMBAT_DICE,
      rolling: this.#rolling,
      rollLabel: this.#rollLabel,
      selectedCount: this.#selectedCount,
    };
  }

  protected override async _onRender(
    context: Record<string, unknown>,
    options: ApplicationRenderOptions,
  ): Promise<void> {
    await super._onRender(context, options);

    const form = resolveDialogForm(this.element) ?? resolveDialogRoot(this.element);
    const countInput = findCountInput(this.element);
    if (countInput) {
      countInput.focus();
      countInput.select();
    }

    if (form && form.dataset.wastelanderEnterBound !== "1") {
      form.dataset.wastelanderEnterBound = "1";
      form.addEventListener("keydown", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement) || target.name !== "count") return;
        if (event.key !== "Enter") return;
        event.preventDefault();
        void CombatDiceRollDialog.#onRoll.call(this);
      });
    }
  }

  #syncCountFromDom(): void {
    const state = readDialogFormState(this.element);
    if (state.count !== null) {
      this.#selectedCount = state.count;
    }
    this.#rollLabel = state.rollLabel;
  }

  static #onDecrementCount(this: CombatDiceRollDialog): void {
    if (this.#rolling) return;
    this.#syncCountFromDom();
    this.#selectedCount = Math.max(MIN_COMBAT_DICE, this.#selectedCount - 1);
    void this.render();
  }

  static #onIncrementCount(this: CombatDiceRollDialog): void {
    if (this.#rolling) return;
    this.#syncCountFromDom();
    this.#selectedCount = Math.min(MAX_COMBAT_DICE, this.#selectedCount + 1);
    void this.render();
  }

  static async #onRoll(this: CombatDiceRollDialog): Promise<void> {
    if (this.#rolling) return;

    const state = readDialogFormState(this.element);
    this.#rollLabel = state.rollLabel;
    if (state.count === null) {
      ui.notifications.warn(t("WASTELANDER.CombatDiceRoll.InvalidCount"));
      findCountInput(this.element)?.focus();
      return;
    }
    this.#selectedCount = state.count;

    this.#rolling = true;
    await this.render();

    try {
      const ok = await rollAndPostCombatDice({
        actor: getCombatDiceSpeakerActor(),
        count: this.#selectedCount,
        rollLabel: this.#rollLabel,
      });
      if (ok) {
        await this.close();
      }
    } finally {
      this.#rolling = false;
      if (this.rendered) {
        await this.render();
      }
    }
  }

  static #onCancel(this: CombatDiceRollDialog): void {
    void this.close();
  }
}

export function openCombatDiceRollDialog(): void {
  if (game.system.id !== "fallout") {
    ui.notifications.warn(t("WASTELANDER.CombatDiceRoll.RequiresFallout"));
    return;
  }

  const existing = Object.values(ui.windows).find(
    (app) => app instanceof CombatDiceRollDialog,
  );
  if (existing) {
    existing.bringToFront?.();
    void existing.render();
    return;
  }

  const app = new CombatDiceRollDialog();
  void app.render({ force: true });
}
