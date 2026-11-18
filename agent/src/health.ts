/**
 * Health watch: catches protocol steps that stop moving (like a callback that never landed) and
 * tells the operator, instead of leaving users waiting in silence.
 *
 * Alerts go to TELEGRAM_ADMIN_CHAT_ID (a private chat or group with the bot) and the log.
 * Each problem alerts once, then at most every ALERT_REPEAT_MIN minutes while it lasts,
 * and a short "resolved" note follows when it clears.
 */
import { sendAdminAlert } from "./social.js";

const STUCK_MIN = Number(process.env.HEALTH_STUCK_MIN ?? "15");
const ALERT_REPEAT_MIN = Number(process.env.HEALTH_ALERT_REPEAT_MIN ?? "60");

/** key -> when the condition was first seen (ms) */
const since = new Map<string, number>();
/** key -> when we last alerted (ms) */
const alerted = new Map<string, number>();

/** How long (minutes) a condition has been true; resets (and reports recovery) when false. */
export async function track(key: string, active: boolean, describe: () => string): Promise<number> {
  const now = Date.now();
  if (!active) {
    since.delete(key);
    if (alerted.has(key)) {
      alerted.delete(key);
      await alert(`✅ Resolved: ${describe()}`);
    }
    return 0;
  }
  if (!since.has(key)) since.set(key, now);
  const mins = (now - since.get(key)!) / 60_000;
  if (mins >= STUCK_MIN && now - (alerted.get(key) ?? 0) >= ALERT_REPEAT_MIN * 60_000) {
    alerted.set(key, now);
    await alert(`⚠️ Stuck ${Math.round(mins)} min: ${describe()}`);
  }
  return mins;
}

export async function alert(text: string) {
  console.warn(`[health] ${text}`);
  await sendAdminAlert(text).catch(() => {});
}

export const STUCK_MINUTES = STUCK_MIN;
