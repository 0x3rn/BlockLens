import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';

export const usePersistentState = <T,>(
  key: string,
  initialValue: T,
  validate: (value: unknown) => value is T,
): [T, Dispatch<SetStateAction<T>>] => {
  const initialValueRef = useRef(initialValue);
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = window.localStorage.getItem(key);
      if (!saved) return initialValue;
      const parsed: unknown = JSON.parse(saved);
      return validate(parsed) ? parsed : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable in privacy modes. In-memory state still works.
    }
  }, [key, value]);

  useEffect(() => {
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
  }, [key, validate]);

  return [value, setValue];
};
