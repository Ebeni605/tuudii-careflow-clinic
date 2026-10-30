// Session and password rules shared by the browser and the admin server functions.

/** Shared clinic computers: sign staff out after this many minutes without activity. */
export const IDLE_MINUTES = 30;
/** Show a warning this many minutes before the automatic sign-out. */
export const IDLE_WARNING_MINUTES = 2;

export const PASSWORD_HINT = "At least 10 characters, with letters and numbers";

/** Problem with a new staff password, or null. */
export function passwordProblem(pw: string, email?: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters";
  if (pw.length > 72) return "Password is too long (max 72 characters)";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must contain letters and numbers";
  const local = email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && pw.toLowerCase().includes(local)) return "Password must not contain your email name";
  return null;
}

/** Milliseconds left before idle sign-out (≤ 0 means sign out now). */
export function idleRemainingMs(lastActivity: number, now: number, minutes = IDLE_MINUTES) {
  return lastActivity + minutes * 60_000 - now;
}
