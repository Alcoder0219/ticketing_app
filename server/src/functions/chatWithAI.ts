import type { Request, Response } from 'express';
import { models } from '../models/index.js';
import { env } from '../config/env.js';
import { getUserRole, roleNameVariants } from '../auth/authz.js';
import { sanitizeInput, normalizeLang, INJECTION_GUARD, LANG_NAMES } from './aiShared.js';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const DATA_KEYWORDS = [
  'how many', 'count', 'total', 'number of', 'ticket', 'tickets', 'pending',
  'in progress', 'resolved', 'closed', 'open', 'reopened', 'department', 'plant',
  'unit', 'assigned', 'unassigned', 'overdue', 'sla', 'breach', 'breached',
  'today', 'this week', 'this month', 'list', 'show', 'summary', 'breakdown',
  'rating', 'average',
];

function isPrivileged(role: string | null): boolean {
  return role === 'super_admin' || role === 'admin';
}

function startOfToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Compute the live ticket counts that ground the assistant's answers. */
async function buildDataContext(role: string | null, userId: string, message: string) {
  const { tickets, role_plant_access, units } = models;
  const base: Record<string, any> = {};

  if (role && !isPrivileged(role)) {
    const access = await role_plant_access
      .find({ role_name: { $in: roleNameVariants(role) }, is_enabled: true })
      .lean();
    const names = access.map((a) => a.unit_name);
    const unitDocs = await units.find({ name: { $in: names } }).lean();
    base.unit_id = { $in: unitDocs.map((u) => u._id) };
  }
  if (/\bmy\b|\bmine\b|raised by me/i.test(message)) base.raised_by = userId;
  if (/today/i.test(message)) base.created_at = { $gte: startOfToday() };

  const [total, open, inProgress, resolved, closed, reopened] = await Promise.all([
    tickets.countDocuments(base),
    tickets.countDocuments({ ...base, status: 'open' }),
    tickets.countDocuments({ ...base, status: 'in_progress' }),
    tickets.countDocuments({ ...base, status: 'resolved' }),
    tickets.countDocuments({ ...base, status: 'closed' }),
    tickets.countDocuments({ ...base, status: 'reopened' }),
  ]);

  return [
    `Total tickets: ${total}`,
    `Open (Pending): ${open}`,
    `In Progress: ${inProgress}`,
    `Resolved: ${resolved}`,
    `Closed: ${closed}`,
    `Reopened: ${reopened}`,
  ].join('\n');
}

export async function handleChatWithAI(req: Request, res: Response) {
  try {
    const messages: ChatMessage[] = Array.isArray(req.body?.messages) ? req.body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'messages required' });

    const userCtx = req.body?.user_context ?? {};
    const ticketCtx = req.body?.ticket_context;
    const selectedLang = normalizeLang(req.body?.selected_language);
    // Sanitize every message body (Unicode NFC + strip control chars) before it
    // reaches the model — multilingual-safe and blocks hidden-payload injection.
    for (const m of messages) m.content = sanitizeInput(m.content, 2000);
    const latest = messages[messages.length - 1]?.content ?? '';

    const role = (await getUserRole(req.auth!.userId)) ?? userCtx.role ?? null;

    let dataContext = '';
    if (DATA_KEYWORDS.some((k) => latest.toLowerCase().includes(k))) {
      dataContext = await buildDataContext(role, req.auth!.userId, latest);
    }

    // Prefer Lovable AI gateway, then OpenAI. If neither is configured, degrade
    // gracefully so the assistant still answers from the live counts.
    if (!env.openaiApiKey && !env.lovableApiKey) {
      const fallback = dataContext
        ? `Here is the latest ticket data:\n\n${dataContext}\n\n(AI text generation is not configured on this server — set OPENAI_API_KEY to enable conversational replies.)`
        : 'The AI assistant is not configured on this server yet. Please set OPENAI_API_KEY in the backend environment.';
      return res.json({ reply: fallback });
    }

    const userLine = `Helping: ${userCtx.name ?? 'a user'} | Role: ${role ?? 'unknown'} | Plant: ${userCtx.unit ?? 'unknown'} | Department: ${userCtx.department ?? 'unknown'} | Privileged: ${isPrivileged(role) ? 'YES' : 'NO'}`;
    const ticketLine = ticketCtx?.ticket_number
      ? `\nCurrently viewing Ticket #${ticketCtx.ticket_number} — ${ticketCtx.title ?? ''} (status: ${ticketCtx.status ?? 'unknown'}).`
      : '';
    const liveBlock = dataContext ? `\n\nLIVE DATABASE DATA:\n${dataContext}\n\nUse ONLY these numbers; never invent counts.` : '';

    // Multilingual directive: detect the user's language and reply in it. The
    // selected language is only a fallback when the message is ambiguous.
    const languageBlock =
      `\n\nLANGUAGE: The user may write in English, Swahili or Arabic. Detect the language of the user's ` +
      `latest message and ALWAYS reply in that SAME language, using correct script and natural phrasing. ` +
      `If the language is ambiguous, reply in ${LANG_NAMES[selectedLang]}. Keep numbers, ticket IDs and ` +
      `technical field names as-is. For Arabic, write right-to-left with correct punctuation.`;

    const systemPrompt = `You are Ticketing Assistant for the Ticketing Support Portal (a multi-plant ticketing system).\n${userLine}${ticketLine}\nBe concise, structured and professional. Use markdown tables when listing tickets. Status values: open (Pending), in_progress, resolved, closed, reopened.${liveBlock}${languageBlock}\n\n${INJECTION_GUARD}`;

    const chatMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    ];

    const endpoint = env.openaiApiKey
      ? 'https://api.openai.com/v1/chat/completions'
      : 'https://ai.gateway.lovable.dev/v1/chat/completions';
    const apiKey = env.openaiApiKey || env.lovableApiKey;
    // gpt-4o handles Swahili/Arabic far better than gpt-3.5-turbo (key lacks 4o-mini access).
    const modelName = env.openaiApiKey ? 'gpt-4o' : 'google/gemini-2.5-flash';

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, messages: chatMessages, temperature: 0.3, max_tokens: 2500 }),
    });
    if (!resp.ok) {
      if (resp.status === 429) return res.status(429).json({ error: 'AI assistant is busy or quota exceeded. Please try again shortly.' });
      return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
    const data: any = await resp.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return res.status(500).json({ error: 'Something went wrong. Please try again.' });
    return res.json({ reply: text });
  } catch {
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
