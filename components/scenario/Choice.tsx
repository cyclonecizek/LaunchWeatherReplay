import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function Choice({
  value,
  change,
  items,
  label,
}: {
  value: string;
  change: (s: string) => void;
  items: [string, string][];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={change}>
      <SelectTrigger aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(([k, v]) => (
          <SelectItem key={k} value={k}>
            {v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
