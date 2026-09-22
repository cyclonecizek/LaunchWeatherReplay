export const mb = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : (n / 1e6).toFixed(1) + ' MB');

export const fmt = (s: string | null) => (s ? new Date(s).toISOString().slice(11, 19) + ' UTC' : 'No data');

export const addMinutes = (value: string, minutes: number) =>
  new Date(Date.parse(value + 'Z') + minutes * 60000).toISOString().slice(0, 16);
