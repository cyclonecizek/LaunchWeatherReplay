import { Input } from '@/components/ui/input';

export function DateTime24({
  id,
  label,
  value,
  change,
}: {
  id: string;
  label: string;
  value: string;
  change: (s: string) => void;
}) {
  const [date = '', clock = '00:00'] = value.split('T');
  const [hour = '00', minute = '00'] = clock.split(':');
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
  return (
    <div className="date-time-field" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`}>{label} · UTC (24-hour)</span>
      <div className="date-time-row">
        <Input
          aria-label={`${label} date`}
          type="date"
          value={date}
          onChange={(e) => change(`${e.target.value}T${hour}:${minute}`)}
        />
        <div className="clock24">
          <select
            aria-label={`${label} hour, 00 through 23`}
            value={hour}
            onChange={(e) => change(`${date}T${e.target.value}:${minute}`)}
          >
            {hours.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <span aria-hidden="true">:</span>
          <select
            aria-label={`${label} minute`}
            value={minute}
            onChange={(e) => change(`${date}T${hour}:${e.target.value}`)}
          >
            {minutes.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <span className="utc-mark">Z</span>
        </div>
      </div>
    </div>
  );
}
