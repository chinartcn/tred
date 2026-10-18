import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface AnchorState {
  approxLine: number;
  astSignature: string;
  fingerprint: string;
  updatedAt: string;
}

export interface TredState {
  version: number;
  tracked: Record<string, Record<string, AnchorState>>;
}

export function getStatePath(): string {
  return join(process.cwd(), '.tred', 'state.json');
}

export function loadState(): TredState {
  const p = getStatePath();
  if (!existsSync(p)) {
    return { version: 1, tracked: {} };
  }
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return { version: 1, tracked: {} };
  }
}

export function saveState(state: TredState): void {
  const p = getStatePath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

export function updateAnchorState(file: string, anchorName: string, approxLine: number, astSignature: string, fingerprint: string): void {
  const state = loadState();
  if (!state.tracked[file]) state.tracked[file] = {};
  state.tracked[file][anchorName] = {
    approxLine,
    astSignature,
    fingerprint,
    updatedAt: new Date().toISOString()
  };
  saveState(state);
}

export function getAnchorState(file: string, anchorName: string): AnchorState | null {
  const state = loadState();
  return state.tracked[file]?.[anchorName] || null;
}