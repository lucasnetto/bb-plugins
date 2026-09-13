import { Option, Schema } from "effect";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

function readStorage<T>(key: string, fallback: T, schema: Schema.ConstraintDecoder<T>): T {
  try {
    const raw = window.localStorage.getItem(key);

    return raw === null
      ? fallback
      : Option.getOrElse(Schema.decodeUnknownOption(schema)(JSON.parse(raw)), () => fallback);
  } catch {
    return fallback;
  }
}

export function useLocalStorageState<T>(
  key: string,
  fallback: T,
  schema: Schema.ConstraintDecoder<T>,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readStorage(key, fallback, schema));
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage may be unavailable (private mode); the in-memory value still works.
    }
  }, [key, value]);

  return [value, setValue];
}
