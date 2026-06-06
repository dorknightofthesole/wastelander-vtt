import { t } from "./i18n.js";
import { openCombatDiceRollDialog } from "./CombatDiceRollDialog.js";
import { FALLOUT_CD_EFFECT_ICON } from "./combatDiceRoll.js";

const BUTTON_CLASS = "wastelander-combat-dice-chat-btn";

function isFalloutSystem(): boolean {
  return game.system.id === "fallout";
}

function findChatControlsContainer(
  elements: Record<string, HTMLElement>,
): HTMLElement | null {
  const direct =
    elements[".chat-controls"] ??
    elements["chat-controls"] ??
    elements[".control-buttons"] ??
    null;
  if (direct) return direct;

  for (const element of Object.values(elements)) {
    if (!(element instanceof HTMLElement)) continue;
    if (element.classList.contains("chat-controls")) return element;
    const nested = element.querySelector(".chat-controls, .control-buttons");
    if (nested instanceof HTMLElement) return nested;
  }

  return null;
}

function ensureCombatDiceChatButton(container: HTMLElement): void {
  if (container.querySelector(`.${BUTTON_CLASS}`)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = `ui-control icon ${BUTTON_CLASS}`;
  button.setAttribute("type", "button");
  button.setAttribute("aria-label", t("WASTELANDER.CombatDiceRoll.ChatButton"));
  button.dataset.tooltip = t("WASTELANDER.CombatDiceRoll.ChatButton");
  button.innerHTML =
    `<span class="wastelander-combat-dice-effect-icon" style="background-image: url('${FALLOUT_CD_EFFECT_ICON}');" aria-hidden="true">&nbsp;</span>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    openCombatDiceRollDialog();
  });

  const controlButtons = container.querySelector(".control-buttons");
  if (controlButtons instanceof HTMLElement) {
    controlButtons.append(button);
    return;
  }

  container.append(button);
}

function onRenderChatInput(
  _app: unknown,
  elements: Record<string, HTMLElement>,
): void {
  if (!isFalloutSystem()) return;
  const container = findChatControlsContainer(elements);
  if (!container) return;
  ensureCombatDiceChatButton(container);
}

export function registerCombatDiceChatButton(): void {
  Hooks.on("renderChatInput", onRenderChatInput);

  Hooks.on(
    "getHeaderControlsChatLog",
    (_app: unknown, controls: Array<Record<string, unknown>>) => {
      if (!isFalloutSystem()) return;
      controls.push({
        icon: "fa-solid fa-dice-d6",
        label: t("WASTELANDER.CombatDiceRoll.ChatButton"),
        ownership: "PLAYER",
        onClick: () => openCombatDiceRollDialog(),
      });
    },
  );
}
