export async function timed<T>(
  report: (text: string) => void,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  let status = "failed";
  try {
    const result = await work();
    status = "completed";
    return result;
  } finally {
    report(`Timing: ${label}: ${Math.round(performance.now() - start)}ms (${status})`);
  }
}
