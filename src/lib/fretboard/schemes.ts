// Degree colour schemes: one colour per degree family (root, 2nd, 3rd ... 7th).

export const SCHEMES: { name: string; colours: [number, number, number][] }[] = [
  { name: "Muted", colours: [[196, 92, 82], [196, 140, 86], [204, 178, 102], [128, 164, 120], [98, 142, 180], [142, 124, 176], [176, 112, 150]] },
  { name: "Nordic", colours: [[191, 97, 106], [208, 135, 112], [235, 203, 139], [163, 190, 140], [129, 161, 193], [180, 142, 173], [136, 192, 208]] },
  { name: "Root, 3rd & 5th only", colours: [[206, 112, 92], [112, 116, 126], [214, 186, 120], [112, 116, 126], [128, 160, 196], [112, 116, 126], [150, 140, 160]] },
  { name: "Vivid", colours: [[235, 64, 64], [245, 140, 40], [244, 200, 30], [70, 196, 105], [40, 160, 235], [145, 105, 240], [232, 88, 176]] },
];

/** The fill for a degree label, and a readable text colour on it. */
export function degreeColour(scheme: number, family: number, altered: boolean): { fill: string; text: string } {
  const [r, g, b] = SCHEMES[Math.min(scheme, SCHEMES.length - 1)].colours[family - 1];
  const k = altered ? 0.74 : 1;
  const [rr, gg, bb] = [Math.round(r * k), Math.round(g * k), Math.round(b * k)];
  const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb;
  return { fill: `rgb(${rr}, ${gg}, ${bb})`, text: lum > 150 ? "#14141a" : "#ffffff" };
}
