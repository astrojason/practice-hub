// A tiny SVG element builder shared by the tab and standard-notation drawing.

export const NS = "http://www.w3.org/2000/svg";

export type Attrs = Record<string, string | number>;

// Colours given as CSS variables go into style, so light and dark themes both apply.
export function el(name: string, attrs: Attrs = {}, text?: string): SVGElement {
  const e = document.createElementNS(NS, name);
  let style = "";
  for (const [k, v] of Object.entries(attrs)) {
    if ((k === "fill" || k === "stroke") && typeof v === "string" && v.startsWith("var(")) style += `${k}:${v};`;
    else e.setAttribute(k, String(v));
  }
  if (style) e.setAttribute("style", style);
  if (text != null) e.textContent = text;
  return e;
}
