// GR placefile Object coordinates are pixel offsets. These opaque, fixed-size
// vector circles need no image files, custom fonts, or machine-specific paths.
const rings = new Map<number, string[]>();
function ring(radius: number) {
  let points = rings.get(radius);
  if (!points) {
    points = Array.from({ length: 13 }, (_, i) => {
      const a = (i % 12) * Math.PI / 6;
      return `${(radius * Math.cos(a)).toFixed(2)}, ${(radius * Math.sin(a)).toFixed(2)}`;
    });
    rings.set(radius, points);
  }
  return points;
}
export function circleSymbol(color: string, radius: number, hover: string): string[] {
  const points = ring(radius), rgb = color.trim().split(/[ ,]+/).join(', ');
  const safeHover = hover.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '').replace(/\n/g, '\\n');
  return [`Color: ${rgb.replaceAll(', ', ' ')}`, 'Polygon:',
    ...points.map(p => `${p}, ${rgb}, 255`), 'End:',
    'Color: 15 20 25', `Line: 1, 0, "${safeHover}"`, ...points, 'End:'];
}
