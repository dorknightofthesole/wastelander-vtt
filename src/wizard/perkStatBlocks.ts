import statBlocksData from "../data/perk-companion-statblocks.json";

export interface CompanionStatBlockDefinition {
  title: string;
  subtitle: string;
  skills: {
    body: number;
    mind: number;
    melee: number;
    guns: number | null;
    other: number;
  };
  derived: {
    hp: number | string;
    initiative: string;
    defense: number | string;
    carryWeight: string;
    meleeBonus: string;
  };
  resistance: {
    physical: number;
    energy: number;
    radiation: number;
    poison: number;
  };
  attacks: string[];
  specialAbilities: string[];
}

const STAT_BLOCKS = statBlocksData as Record<string, CompanionStatBlockDefinition>;

function fmt(value: number | string | null): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

export function getCompanionStatBlock(
  perkName: string,
): CompanionStatBlockDefinition | undefined {
  return STAT_BLOCKS[perkName];
}

/** Rulebook-style companion profile HTML for the perk detail panel. */
export function buildCompanionStatBlockHtml(block: CompanionStatBlockDefinition): string {
  const s = block.skills;
  const d = block.derived;
  const r = block.resistance;

  const attacks = block.attacks.map((a) => `<li>${a}</li>`).join("");
  const abilities = block.specialAbilities.map((a) => `<li>${a}</li>`).join("");

  return `
<section class="wastelander-companion-statblock">
  <h4 class="wastelander-companion-statblock-title">${block.title}</h4>
  <p class="wastelander-companion-statblock-subtitle">${block.subtitle}</p>
  <table class="wastelander-companion-table">
    <thead>
      <tr>
        <th>Body</th><th>Mind</th><th>Melee</th><th>Guns</th><th>Other</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${s.body}</td><td>${s.mind}</td><td>${s.melee}</td>
        <td>${fmt(s.guns)}</td><td>${s.other}</td>
      </tr>
    </tbody>
  </table>
  <table class="wastelander-companion-table">
    <thead>
      <tr><th>HP</th><th>Initiative</th><th>Defense</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>${fmt(d.hp)}</td><td>${d.initiative}</td><td>${fmt(d.defense)}</td>
      </tr>
    </tbody>
  </table>
  <table class="wastelander-companion-table">
    <thead>
      <tr><th>Carry Weight</th><th>Melee Bonus</th></tr>
    </thead>
    <tbody>
      <tr><td>${d.carryWeight}</td><td>${d.meleeBonus}</td></tr>
    </tbody>
  </table>
  <table class="wastelander-companion-table">
    <thead>
      <tr>
        <th>Phys. DR</th><th>Energy DR</th><th>Rad. DR</th><th>Poison DR</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${r.physical}</td><td>${r.energy}</td>
        <td>${r.radiation}</td><td>${r.poison}</td>
      </tr>
    </tbody>
  </table>
  <h5 class="wastelander-companion-section">Attacks</h5>
  <ul class="wastelander-companion-list">${attacks}</ul>
  <h5 class="wastelander-companion-section">Special Abilities</h5>
  <ul class="wastelander-companion-list">${abilities}</ul>
</section>`.trim();
}

export function getCompanionStatBlockHtmlForPerk(perkName: string): string {
  const block = getCompanionStatBlock(perkName);
  return block ? buildCompanionStatBlockHtml(block) : "";
}
