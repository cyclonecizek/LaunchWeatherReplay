// Use GR's Text renderer, as used by the CG crosses. Wingdings ASCII 108
// is a filled circle. ASCII avoids UTF-8/ANSI bullet decoding differences.
export function circleFonts(radius: number): string[] {
  return [`Font: 2, ${radius * 2 + 4}, 0, "Wingdings"`,
    `Font: 3, ${radius * 2 + 6}, 0, "Wingdings"`];
}
export function circleSymbol(color: string, _radius: number, hover: string): string[] {
  const rgb = color.trim().split(/[ ,]+/).join(' ');
  const safeHover = hover.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '').replace(/\n/g, '\\n');
  return ['Color: 15 20 25', 'Text: 0, 0, 3, "l"',
    `Color: ${rgb}`, `Text: 0, 0, 2, "l", "${safeHover}"`];
}
