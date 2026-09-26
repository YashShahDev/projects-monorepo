/** m:ss.mmm, truncated like a timing screen so a lap never reads faster than it was. */
export function formatLapTime(seconds: number): string {
  const ms = Math.floor(seconds * 1000 + 1e-6);
  const minutes = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;

  return `${String(minutes)}:${String(secs).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
