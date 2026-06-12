/** User with at least Assistant Gamemaster (co-GM) role in the active world. */
export type OverseerUser = {
  isGM?: boolean;
  role?: number;
};

function userRoles(): Record<string, number> | undefined {
  return (globalThis as { CONST?: { USER_ROLES?: Record<string, number> } }).CONST
    ?.USER_ROLES;
}

/**
 * True for Foundry Gamemaster and Assistant Gamemaster (co-GM) users.
 * Prefer role when available so co-GMs are not treated as primary GM only.
 */
export function isOverseer(user?: OverseerUser | null): boolean {
  if (!user) return false;
  const roles = userRoles();
  if (roles && typeof user.role === "number") {
    const assistant = roles.ASSISTANT;
    if (typeof assistant === "number") {
      return user.role >= assistant;
    }
  }
  return Boolean(user.isGM);
}

export function currentUserIsOverseer(): boolean {
  return isOverseer(game.user as OverseerUser);
}
