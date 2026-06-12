import { MODULE_ID } from "../constants.js";
import { buildNpcGenFieldsHtml, type NpcGenFieldRow } from "./npcGenActorData.js";

type NpcGenActorFlag = {
  fields?: NpcGenFieldRow[];
};

function actorFromSheetApp(app: {
  actor?: Actor;
  document?: Actor;
}): Actor | undefined {
  return app.document ?? app.actor;
}

function resolveHtmlRoot(
  app: { element?: HTMLElement | HTMLElement[] },
  html: JQuery | HTMLElement,
): JQuery {
  if (html instanceof jQuery) return html;
  const el = app.element;
  const base =
    el instanceof HTMLElement
      ? el
      : Array.isArray(el) && el[0] instanceof HTMLElement
        ? el[0]
        : null;
  return base ? $(base) : $(html);
}

/** Inject rolled NPC generator fields into the Fallout actor Data tab. */
export function registerNpcGenActorSheetData(
  app: { actor?: Actor; document?: Actor; element?: HTMLElement | HTMLElement[] },
  html: JQuery | HTMLElement,
): void {
  const actor = actorFromSheetApp(app);
  if (!actor || actor.type !== "npc") return;

  const flag = actor.getFlag(MODULE_ID, "npcGen") as NpcGenActorFlag | undefined;
  const fields = flag?.fields;
  if (!fields?.length) return;

  const $html = resolveHtmlRoot(app, html);
  const $dataTab = $html.find('.tab.data[data-tab="data"], .tab.data');
  if (!$dataTab.length) return;
  if ($dataTab.find(".wastelander-npc-gen-actor-data").length) return;

  $dataTab.prepend(buildNpcGenFieldsHtml(fields));
}
