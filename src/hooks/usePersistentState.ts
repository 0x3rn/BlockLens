import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';

export const usePersistentState = <T,>(
  key: string,
  initialValue: T,
  validate: (value: unknown) => value is T,
  enabled = true,
): [T, Dispatch<SetStateAction<T>>] => {
  const initialValueRef = useRef(initialValue);
  const [value, setValue] = useState<T>(() => {
    if (!enabled) return initialValue;
    try {
      const saved = window.localStorage.getItem(key);
      if (!saved) return initialValue;
      const parsed: unknown = JSON.parse(saved);
      return validate(parsed) ? parsed : initialValue;
    } catch {
      return initialValue;
    }
  });
  const [hydrated, setHydrated] = useState(enabled);

  useEffect(() => {
    if (!enabled) {
      setValue(initialValueRef.current);
      setHydrated(false);
      return;
    }
    if (hydrated) return;
    try {
      const saved = window.localStorage.getItem(key);
      const parsed: unknown = saved ? JSON.parse(saved) : null;
      setValue(validate(parsed) ? parsed : initialValueRef.current);
    } catch {
      setValue(initialValueRef.current);
    }
    setHydrated(true);
  }, [enabled, hydrated, key, validate]);

  useEffect(() => {
    if (!enabled || !hydrated) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable in privacy modes. In-memory state still works.
    }
  }, [enabled, hydrated, key, value]);

  useEffect(() => {
    if (!enabled) return undefined;
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key !== key) return;
      if (event.newValue == null) {
        setValue(initialValueRef.current);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(event.newValue);
        if (validate(parsed)) setValue(parsed);
      } catch {
        // Ignore malformed external storage events.
      }
    };
    window.addEventListener('storage', syncAcrossTabs);
    return () => window.removeEventListener('storage', syncAcrossTabs);
  }, [enabled, key, validate]);

  return [value, setValue];
};
