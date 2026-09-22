const ROWS: { label: string; ticks: number[]; expiresAfter: number; color: string }[] = [
  { label: 'Radar volume', ticks: [30, 130, 230, 330], expiresAfter: 100, color: '#88d8f5' },
  { label: 'Wind tower', ticks: [10, 150, 290], expiresAfter: 140, color: '#7fd6ae' },
  { label: 'Field mill', ticks: [60, 140, 220, 300], expiresAfter: 80, color: '#f2c15c' },
  { label: 'Lightning trail', ticks: [40, 90, 180, 270, 340], expiresAfter: 60, color: '#f29c9c' },
];
const PLAYHEAD = 250;
const WIDTH = 420;
const ROW_HEIGHT = 34;
const TOP = 14;

/** Schematic: each layer keeps its own last-valid observation as the playhead advances; nothing is shown past its expiry window. */
export function ReplayClockDiagram() {
  const height = TOP + ROWS.length * ROW_HEIGHT + 14;
  return (
    <div className="clock-diagram">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Diagram of radar, wind, field mill, and lightning observations aligned on one UTC playhead, each layer showing only its own currently valid reading.">
        {ROWS.map((row, i) => {
          const y = TOP + i * ROW_HEIGHT;
          const active = [...row.ticks].reverse().find((t) => t <= PLAYHEAD && PLAYHEAD - t <= row.expiresAfter);
          return (
            <g key={row.label}>
              <text x={0} y={y + 4} fontSize="11" fill="#9eb3c8">
                {row.label}
              </text>
              <line x1={128} y1={y} x2={WIDTH} y2={y} stroke="#2b3f53" strokeWidth={1} />
              {active !== undefined && (
                <rect x={128 + active} y={y - 7} width={Math.min(row.expiresAfter, PLAYHEAD - active)} height={14} fill={row.color} opacity={0.16} />
              )}
              {row.ticks.map((t) => (
                <circle key={t} cx={128 + t} cy={y} r={t === active ? 4 : 3} fill={t === active ? row.color : '#3a5870'} />
              ))}
            </g>
          );
        })}
        <line x1={128 + PLAYHEAD} y1={2} x2={128 + PLAYHEAD} y2={height - 6} stroke="#e8eef6" strokeWidth={1.5} strokeDasharray="3 3" />
        <text x={128 + PLAYHEAD} y={height - 8} fontSize="10" fill="#e8eef6" textAnchor="middle">
          playhead
        </text>
      </svg>
    </div>
  );
}
