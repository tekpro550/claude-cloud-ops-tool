import type { TicketPlatform } from "../types/ticket";

export const PLATFORMS: TicketPlatform[] = [
  "aws",
  "azure",
  "alibaba_cloud",
  "microsoft_365",
  "tittu_marketing_platform",
  "other",
];

const PLATFORM_LABELS: Record<TicketPlatform, string> = {
  aws: "AWS",
  azure: "Azure",
  alibaba_cloud: "Alibaba Cloud",
  microsoft_365: "Microsoft 365",
  tittu_marketing_platform: "Tittu Marketing Platform",
  other: "Other",
};

export function platformLabel(platform: TicketPlatform): string {
  return PLATFORM_LABELS[platform];
}
