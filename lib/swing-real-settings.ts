export type SwingRealSettings={boost:0|20|50;maxPositions:5|10|15};
export const DEFAULT_SWING_REAL_SETTINGS:SwingRealSettings={boost:0,maxPositions:5};
export function normalizeSwingRealSettings(value:unknown):SwingRealSettings{
 const raw=value&&typeof value==='object'?value as Record<string,unknown>:{};
 return {boost:([0,20,50].includes(raw.boost as number)?raw.boost:0) as SwingRealSettings['boost'],maxPositions:([5,10,15].includes(raw.maxPositions as number)?raw.maxPositions:5) as SwingRealSettings['maxPositions']};
}
