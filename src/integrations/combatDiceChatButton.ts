import { t } from "./i18n.js";
import { openCombatDiceRollDialog } from "./CombatDiceRollDialog.js";
import { FALLOUT_CD_EFFECT_ICON } from "./combatDiceRoll.js";

const BUTTON_CLASS = "wastelander-combat-dice-chat-btn";

function isFalloutSystem(): boolean {
  return game.system.id === "fallout";
}

function findChatControlsContainers(root: ParentNode = document): HTMLElement[] {
  const selectors = [
    ".chat-controls .control-buttons",
    ".chat-controls",
    "#chat-controls .control-buttons",
    "#chat-controls",
  ];
  const found = new Set<HTMLElement>();
  for (const selector of selectors) {
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      found.add(el);
    }
  }
  return [...found];
}

function ensureCombatDiceChatButton(container: HTMLElement): void {
  if (container.querySelector(`.${BUTTON_CLASS}`)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = `ui-control icon ${BUTTON_CLASS}`;
  button.setAttribute("aria-label", t("WASTELANDER.CombatDiceRoll.ChatButton"));
  button.dataset.tooltip = t("WASTELANDER.CombatDiceRoll.ChatButton");
  button.innerHTML =
    `<span class="wastelander-combat-dice-effect-icon" style="background-image: url('${FALLOUT_CD_EFFECT_ICON}');" aria-hidden="true">&nbsp;</span>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    openCombatDiceRollDialog();
  });

  if (container.classList.contains("control-buttons")) {
    container.append(button);
    return;
  }

  const controlButtons = container.querySelector(".control-buttons");
  if (controlButtons instanceof HTMLElement) {
    controlButtons.append(button);
    return;
  }

  container.append(button);
}

function injectCombatDiceChatButtons(root: ParentNode = document): void {
  if (!isFalloutSystem()) return;
  for (const container of findChatControlsContainers(root)) {
    ensureCombatDiceChatButton(container);
  }
}

function onRenderChatInput(
  _app: unknown,
  elements: Record<string, HTMLElement>,
): void {
  if (!isFalloutSystem()) return;
  for (const element of Object.values(elements)) {
    if (!(element instanceof HTMLElement)) continue;
    injectCombatDiceChatButtons(element);
  }
  injectCombatDiceChatButtons();
}

function onRenderChatLog(_app: unknown, element: HTMLElement): void {
  if (!isFalloutSystem() || !(element instanceof HTMLElement)) return;
  injectCombatDiceChatButtons(element);
}

export function registerCombatDiceChatButton(): void {
  Hooks.on("renderChatInput", onRenderChatInput);
  Hooks.on("renderChatLog", onRenderChatLog);
  Hooks.on("changeSidebarTab", () => {
    window.setTimeout(() => injectCombatDiceChatButtons(), 50);
  });

  Hooks.once("ready", () => {
    window.setTimeout(() => injectCombatDiceChatButtons(), 250);
  });

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
