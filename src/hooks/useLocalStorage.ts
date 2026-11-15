import { useCallback, useState } from 'react';
import { STORAGE_PREFIX } from '../config';

/** Safe access to browser storage (falls back silently in private windows etc.). */
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage may be disabled – the preference then only lasts for this session */
  }
}

/** useState + localStorage persistence. Only for light preferences (language, theme, view mode). */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readStorage(key, initial));
  const set = useCallback(
    (v: T) => {
      setValue(v);
      writeStorage(key, v);
    },
    [key],
  );
  return [value, set];
}
