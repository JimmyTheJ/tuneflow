import type { EqBand } from "@/types";

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export const FLAT_EQ_BANDS: EqBand[] = EQ_FREQUENCIES.map((freq) => ({ freq, gainDb: 0 }));

export function createFlatBands(): EqBand[] {
  return FLAT_EQ_BANDS.map((band) => ({ ...band }));
}

export function cloneBands(bands: EqBand[]): EqBand[] {
  return bands.map((band) => ({ ...band }));
}

export function bandsEqual(a: EqBand[], b: EqBand[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((band, index) => band.freq === b[index]?.freq && band.gainDb === b[index]?.gainDb);
}

export function curveFromProfile(profile: { bands: EqBand[]; preamp_db: number }) {
  return {
    bands: cloneBands(profile.bands),
    preampDb: profile.preamp_db,
  };
}

export function formatBandLabel(freq: number): string {
  if (freq >= 1000) {
    const value = freq / 1000;
    return Number.isInteger(value) ? `${value}k` : `${value.toFixed(1)}k`;
  }
  return String(freq);
}

export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}
