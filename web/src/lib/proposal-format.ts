/**
 * Proposal descriptions in the format Trezu (NEAR-DevHub) and other Sputnik UIs read:
 *   "* Title: Pay the meme artist <br>* Notes: For the launch video <br>* Proposal Action: bounty"
 * JSON descriptions are also accepted when decoding. Keeps Floorpad DAOs readable everywhere.
 */
const readable = (key: string) =>
  key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase());

export function encodeDescription(fields: Record<string, string | undefined | null>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    // "<br>" and "* " are separators in this format, so strip them from values
    .map(([k, v]) => `* ${readable(k)}: ${String(v).replace(/<br>/gi, " ").replace(/\n/g, " ").trim()}`)
    .join(" <br>");
}

export function decodeDescription(description: string): { title: string; notes: string; action?: string } {
  try {
    const j = JSON.parse(description);
    if (j && typeof j === "object") return { title: j.title ?? "", notes: j.notes ?? j.summary ?? j.description ?? "", action: j.proposal_action };
  } catch {
    /* markdown */
  }
  const out: Record<string, string> = {};
  for (const line of description.split("<br>")) {
    const l = line.trim();
    if (!l.startsWith("* ")) continue;
    const i = l.indexOf(":");
    if (i > 2) out[l.slice(2, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  if (!out.title && !out.notes) return { title: "", notes: description };
  return { title: out.title ?? "", notes: out.notes ?? out.summary ?? "", action: out["proposal action"] };
}
