import { z } from 'zod';

const NominatimRow = z.object({ lat: z.coerce.number(), lon: z.coerce.number(), display_name: z.string() });
export type Geocoded = { lat: number; lon: number; display_name: string; cached: boolean };

const cache = new Map<string, Omit<Geocoded, 'cached'> | null>();
// Known Cook County places so the demo prompts work even when Nominatim is unreachable/rate-limited.
const KNOWN: Record<string, Omit<Geocoded, 'cached'>> = {
  chicago: { lat: 41.8781, lon: -87.6298, display_name: 'Chicago, Cook County, Illinois (built-in)' },
  evanston: { lat: 42.0451, lon: -87.6877, display_name: 'Evanston, Cook County, Illinois (built-in)' },
  'oak park': { lat: 41.885, lon: -87.7845, display_name: 'Oak Park, Cook County, Illinois (built-in)' },
  skokie: { lat: 42.0324, lon: -87.7416, display_name: 'Skokie, Cook County, Illinois (built-in)' },
  cicero: { lat: 41.8456, lon: -87.7539, display_name: 'Cicero, Cook County, Illinois (built-in)' },
};

export async function geocodePlace(
  place: string,
  nominatimUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Geocoded | null> {
  const key = place
    .trim()
    .toLowerCase()
    .replace(/,?\s*(cook county|il|illinois|usa)\b/g, '')
    .trim();
  const hit = cache.get(key);
  if (hit !== undefined) return hit ? { ...hit, cached: true } : null;
  let result: Omit<Geocoded, 'cached'> | null = null;
  try {
    const url = `${nominatimUrl}?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(`${key}, Cook County, Illinois`)}`;
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'cook-il-explorer/0.1 (property intelligence demo)' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const rows = z.array(NominatimRow).parse(await res.json());
      if (rows[0]) result = rows[0];
    }
  } catch {
    result = null;
  }
  result ??= KNOWN[key] ?? null;
  cache.set(key, result);
  return result ? { ...result, cached: false } : null;
}
