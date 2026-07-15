// Deterministic per-name avatar color, not random per render -- the same
// contact/agent should always render as the same color everywhere they
// appear (ticket list, ticket detail, etc).
const PALETTE = [
  "#2f6fed",
  "#7c5cff",
  "#d8393f",
  "#b6790a",
  "#16965f",
  "#0891b2",
  "#c2255c",
  "#5b21b6",
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function avatarColor(name: string | null | undefined): string {
  if (!name) return "#8b93a1";
  return PALETTE[hashString(name) % PALETTE.length];
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0][0]}${parts[parts.length - 1][0]}`;
}
