import type { Resource } from "../../../../api/types";

export type ResourceType = NonNullable<Resource["type"]>;

export function inferResourceType(url: string | null, storedType?: string): ResourceType {
  if (storedType) return storedType as ResourceType;
  if (!url) return "url";
  if (url.startsWith("/") || /^[A-Za-z]:\\/.test(url)) return "local_file";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return "youtube";
  return "url";
}
