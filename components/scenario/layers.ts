import { Wind, Zap } from 'lucide-react';
import type { Config, Entry, Kind, RadarFile, Report } from '@/lib/replay';
import type { MerlinSource } from '@/lib/merlin';

export type LayerInfo = { key: Kind; name: string; detail: string; icon: typeof Wind; mode: string; disabledReason?: string };

export const layers: LayerInfo[] = [
  { key: 'winds', name: 'Wind towers', detail: 'Surface, 54 ft, lowest available, or 200+ ft.', icon: Wind, mode: 'AUTO · 2000–2059', disabledReason: 'Temporarily unavailable' },
  { key: 'fieldmills', name: 'Field mills', detail: 'Signed one-minute electric field, V/m.', icon: Zap, mode: 'AUTO · 2000–2059' },
  { key: 'lightning', name: 'MERLIN lightning', detail: 'Individual CG detections and grouped CC density, with up to a one-hour trail.', icon: Zap, mode: 'AUTO · 2000–2059' },
];

export type Source = { kind: string; source: string };

export type Prepared = {
  config: Config;
  entries: Entry[];
  radar: RadarFile[];
  reports: Report[];
  missing: string[];
  sources: Source[];
  merlin?: MerlinSource[];
};
