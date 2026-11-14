import identities from "../../backend/app/agents/identities.json";
import type { DeskRole } from "./DeskScene";

export const teamIdentities = {
  leader: { name: "Shen Yan", role: "Leader" },
  product: { name: "Gu Zhiwei", role: "Product" },
  backend: { name: "Lu Ye", role: "Backend" },
  designer: { name: "Tang Wanqing", role: "Designer" },
  frontend: { name: "Lin Qinghe", role: "Frontend" },
  testing: { name: "Xu Mingjing", role: "QA" },
} satisfies Record<DeskRole, { name: string; role: string }>;

export function memberName(id: string, includeRole = true): string {
  if (id === "user") return "You";
  if (!Object.prototype.hasOwnProperty.call(teamIdentities, id)) return id;
  const member = teamIdentities[id as DeskRole];
  return includeRole ? `${member.name} (${member.role})` : member.name;
}

// Recognize the original Chinese mention formats in persisted messages.
export function mentionPrefix(id: string, content: string): string | undefined {
  const role = Object.prototype.hasOwnProperty.call(identities, id) ? id as DeskRole : undefined;
  const original = role ? identities[role] : undefined;
  return [memberName(id), original && `${original.name}（${original.role}）`, original?.role, original?.name,
    role && teamIdentities[role].role, role && teamIdentities[role].name]
    .filter((name): name is string => !!name)
    .map(name => `@${name}`)
    .sort((a, b) => b.length - a.length)
    .find(prefix => content.startsWith(prefix));
}
