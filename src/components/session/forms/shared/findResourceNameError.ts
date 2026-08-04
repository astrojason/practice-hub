interface NamedResource {
  name: string;
  url: string;
}

export function findResourceNameError(resources: NamedResource[]): string | null {
  const named = resources.filter((r) => r.url).map((r) => r.name.trim());
  if (named.some((n) => !n)) return "Every resource needs a name.";
  const seen = new Set<string>();
  for (const n of named) {
    if (seen.has(n.toLowerCase())) return `Resource name "${n}" is used more than once.`;
    seen.add(n.toLowerCase());
  }
  return null;
}
