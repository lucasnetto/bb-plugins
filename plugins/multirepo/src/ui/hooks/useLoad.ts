import { useEffect, useState } from "react";

export function useLoad<T>(load: () => Promise<T>, revision = 0) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
  }>({ loading: true });
  useEffect(() => {
    let current = true;
    setState({ loading: true });
    load().then(
      (data) => {
        if (current) setState({ data, loading: false });
      },
      (error) => {
        if (current)
          setState({
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          });
      },
    );
    return () => {
      current = false;
    };
  }, [load, revision]);
  return state;
}
