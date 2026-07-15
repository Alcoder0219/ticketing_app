// Single-prompt ticket extraction. Pulls department, priority, and a clean title
// out of a free-text message like "raise a ticket for IT, laptop not booting, high priority".

export type ExtractedPriority = "critical" | "high" | "medium" | "low";

export interface ExtractedTicket {
  title: string;
  description: string;
  departmentId: string | null;
  departmentName: string | null;
  priority: ExtractedPriority;
  priorityFound: boolean;
  confidence: "high" | "medium" | "low";
}

const INTENT_PATTERNS: RegExp[] = [
  /\braise (a |an |the |new )?ticket\b/i,
  /\braised (a |an |the )?ticket\b/i,
  /\bcreate (a |an |the |new )?ticket\b/i,
  /\bsubmit (a |an |the |new )?ticket\b/i,
  /\blog (a |an |the |new )?ticket\b/i,
  /\bopen (a |an |the |new )?ticket\b/i,
  /\bfile (a |an |the |new )?ticket\b/i,
  /\bnew ticket\b/i,
  /\breport (an?|the) issue\b/i,
  /\bi want to (raise|create|submit|log|open|report)\b/i,
  /\bi need to (raise|create|submit|log|open|report)\b/i,
  /\bticket for\b/i,
  /\braise (it|hr|maintenance|qms|purchase) ticket\b/i,
];

export function detectTicketIntent(msg: string): boolean {
  return INTENT_PATTERNS.some((re) => re.test(msg));
}

const PRIORITY_RULES: Array<{ re: RegExp; value: ExtractedPriority }> = [
  { re: /\b(critical|urgent|asap|emergency|very high|p0|p1)\b/i, value: "critical" },
  { re: /\b(high|important|high priority)\b/i, value: "high" },
  { re: /\b(medium|normal|moderate|mid)\b/i, value: "medium" },
  { re: /\b(low|minor|small|trivial)\b/i, value: "low" },
];

function extractPriority(msg: string): { value: ExtractedPriority; found: boolean } {
  for (const r of PRIORITY_RULES) if (r.re.test(msg)) return { value: r.value, found: true };
  return { value: "medium", found: false };
}

function escapeReg(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findDepartment(
  msg: string,
  departments: { id: string; name: string }[],
): { id: string; name: string; matched: string } | null {
  const lower = msg.toLowerCase();
  const sorted = [...departments].sort((a, b) => b.name.length - a.name.length);
  // Exact / contained name first
  for (const d of sorted) {
    const name = d.name.toLowerCase();
    if (lower.includes(name)) return { id: d.id, name: d.name, matched: d.name };
    // Try without the word "department"
    const stripped = name.replace(/\s*department\s*$/i, "").trim();
    if (stripped && stripped.length >= 2 && lower.includes(stripped)) {
      return { id: d.id, name: d.name, matched: stripped };
    }
    // Acronym (first letters of each word)
    const acronym = d.name.split(/\s+/).map((w) => w[0]).join("").toLowerCase();
    if (acronym.length >= 2) {
      const acroRe = new RegExp(`\\b${escapeReg(acronym)}\\b`, "i");
      if (acroRe.test(msg)) return { id: d.id, name: d.name, matched: acronym };
    }
  }
  return null;
}

const INTENT_STRIP = [
  /\braise (a |an |the |new )?ticket\b/gi,
  /\braised (a |an |the )?ticket\b/gi,
  /\bcreate (a |an |the |new )?ticket\b/gi,
  /\bsubmit (a |an |the |new )?ticket\b/gi,
  /\blog (a |an |the |new )?ticket\b/gi,
  /\bopen (a |an |the |new )?ticket\b/gi,
  /\bfile (a |an |the |new )?ticket\b/gi,
  /\bnew ticket\b/gi,
  /\bi (want|need) to (raise|create|submit|log|open|report)( a| an| the)?( new)?( ticket)?\b/gi,
  /\bplease\b/gi,
  /\bkindly\b/gi,
  /\bfor (the )?/gi,
  /\bticket\b/gi,
  /\bdepartment\b/gi,
  /\bpriority\b/gi,
];

function cleanTitle(raw: string, priorityWord: string | null, deptMatched: string | null): string {
  let t = raw;
  for (const re of INTENT_STRIP) t = t.replace(re, " ");
  if (deptMatched) {
    t = t.replace(new RegExp(escapeReg(deptMatched), "ig"), " ");
  }
  if (priorityWord) {
    t = t.replace(new RegExp(`\\b${escapeReg(priorityWord)}\\b`, "ig"), " ");
  }
  // Drop common connectors / leading punctuation
  t = t.replace(/[,;:\-–—]+/g, " ").replace(/\s+/g, " ").trim();
  t = t.replace(/^(and|of|to|in|on|the|a|an)\s+/i, "").trim();
  return t;
}

function priorityWordIn(msg: string): string | null {
  for (const r of PRIORITY_RULES) {
    const m = msg.match(r.re);
    if (m) return m[0];
  }
  return null;
}

export function extractTicketDetails(
  message: string,
  departments: { id: string; name: string }[],
): ExtractedTicket {
  const dept = findDepartment(message, departments);
  const prio = extractPriority(message);
  const pWord = priorityWordIn(message);

  let title = cleanTitle(message, pWord, dept?.matched ?? null);
  if (title.split(/\s+/).filter(Boolean).length < 3) {
    // Fall back to original message minus the bare intent verb
    title = message.replace(/^\s*(please\s+)?/i, "").trim();
  }
  // Capitalize first letter
  if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
  if (title.length > 120) title = title.slice(0, 120).trim();

  const score = (dept ? 1 : 0) + (prio.found ? 1 : 0);
  const confidence: ExtractedTicket["confidence"] = score === 2 ? "high" : score === 1 ? "medium" : "low";

  return {
    title: title || message.trim(),
    description: title || message.trim(),
    departmentId: dept?.id ?? null,
    departmentName: dept?.name ?? null,
    priority: prio.value,
    priorityFound: prio.found,
    confidence,
  };
}
