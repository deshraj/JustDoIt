'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';

/**
 * Single source of chart color truth, per the dataviz skill: the skill's
 * validated 8-hue categorical palette + a blue sequential ramp, run through
 * `validate_palette.js` against THIS app's actual surfaces (light #ffffff /
 * dark #09090b — see apps/web/src/app/globals.css):
 *
 *   light: ALL CHECKS PASS (lightness band, chroma floor, CVD ΔE 24.2).
 *     3 slots (aqua/yellow/magenta) sit under 3:1 contrast — the skill's
 *     "relief rule" applies, so every chart ships a visible legend/axis
 *     label and an sr-only data table; color is never the only channel.
 *   dark:  ALL CHECKS PASS (lightness band, contrast >= 3:1). CVD sits in
 *     the 8-12 "floor band" (worst adjacent ΔE 10.3) — same relief applies.
 *
 * Slot 1 (blue) doubles as a visual echo of the app's own indigo accent, so
 * the dashboard reads as part of one system rather than a bolted-on kit.
 * Every chart in charts/ imports this file — never a one-off color.
 */

export interface ThemedColor {
  light: string;
  dark: string;
}

export const CATEGORICAL: ThemedColor[] = [
  { light: '#2a78d6', dark: '#3987e5' }, // 1 blue   — primary series / single-hue magnitude
  { light: '#1baf7a', dark: '#199e70' }, // 2 aqua   — secondary series (e.g. "actual" vs "estimate")
  { light: '#eda100', dark: '#c98500' }, // 3 yellow
  { light: '#008300', dark: '#008300' }, // 4 green
  { light: '#4a3aa7', dark: '#9085e9' }, // 5 violet
  { light: '#e34948', dark: '#e66767' }, // 6 red
  { light: '#e87ba4', dark: '#d55181' }, // 7 magenta
  { light: '#eb6834', dark: '#d95926' }, // 8 orange
];

/** Blue sequential ramp (magnitude), lightest -> darkest. */
export const SEQUENTIAL_BLUE: ThemedColor[] = [
  { light: '#cde2fb', dark: '#104281' },
  { light: '#9ec5f4', dark: '#184f95' },
  { light: '#5598e7', dark: '#1c5cab' },
  { light: '#2a78d6', dark: '#3987e5' },
];

export const INK = {
  primary: { light: '#0b0b0b', dark: '#ffffff' } satisfies ThemedColor,
  secondary: { light: '#52514e', dark: '#c3c2b7' } satisfies ThemedColor,
  muted: { light: '#898781', dark: '#898781' } satisfies ThemedColor,
  gridline: { light: '#e1e0d9', dark: '#2c2c2a' } satisfies ThemedColor,
  baseline: { light: '#c3c2b7', dark: '#383835' } satisfies ThemedColor,
};

export const STATUS = {
  good: { light: '#0ca30c', dark: '#0ca30c' } satisfies ThemedColor,
  warning: { light: '#fab219', dark: '#fab219' } satisfies ThemedColor,
  serious: { light: '#ec835a', dark: '#ec835a' } satisfies ThemedColor,
  critical: { light: '#d03b3b', dark: '#d03b3b' } satisfies ThemedColor,
};

export type ChartMode = 'light' | 'dark';

export function pick(color: ThemedColor, mode: ChartMode): string {
  return mode === 'dark' ? color.dark : color.light;
}

/** Resolve the current chart palette from the active theme (next-themes). */
export function useChartTheme() {
  const { resolvedTheme } = useTheme();
  const mode: ChartMode = resolvedTheme === 'dark' ? 'dark' : 'light';
  return {
    mode,
    categorical: CATEGORICAL.map((c) => pick(c, mode)),
    sequential: SEQUENTIAL_BLUE.map((c) => pick(c, mode)),
    ink: {
      primary: pick(INK.primary, mode),
      secondary: pick(INK.secondary, mode),
      muted: pick(INK.muted, mode),
      gridline: pick(INK.gridline, mode),
      baseline: pick(INK.baseline, mode),
    },
    status: {
      good: pick(STATUS.good, mode),
      warning: pick(STATUS.warning, mode),
      serious: pick(STATUS.serious, mode),
      critical: pick(STATUS.critical, mode),
    },
  };
}

/** Respect prefers-reduced-motion: charts disable their entry animation. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mql.matches);
    const handler = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return reduced;
}
