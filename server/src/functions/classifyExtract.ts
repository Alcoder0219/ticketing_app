// Multilingual message classifier + ticket extractor for the AI Assistant.
//
// For every user message it decides: is this a support-ticket request, or a
// normal chat message? When it's a ticket, it extracts structured ENGLISH fields
// (title/description/category/priority/department) and keeps the original text +
// detected language + an English translation. Chat messages are answered by the
// existing chat-with-ai endpoint, so this only classifies (no reply here).
//
// Everything degrades gracefully: on any failure it returns intent:'chat' so the
// assistant keeps working (fallback to English internally, no technical errors).
import type { Request, Response } from 'express';
import { models } from '../models/index.js';
import {
  callAI,
  sanitizeInput,
  normalizeLang,
  isAiConfigured,
  safeParseJson,
  INJECTION_GUARD,
  LANG_NAMES,
  type LangCode,
} from './aiShared.js';

type Priority = 'critical' | 'high' | 'medium' | 'low';
const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];

interface ExtractResult {
  intent: 'ticket' | 'chat';
  language: LangCode;
  originalMessage: string;
  translatedMessage: string;
  title: string;
  description: string;
  category: string;
  priority: Priority;
  departmentId: string | null;
  departmentName: string | null;
  suggestedAssignee: string;
}

function chatFallback(message: string, lang: LangCode): ExtractResult {
  return {
    intent: 'chat',
    language: lang,
    originalMessage: message,
    translatedMessage: message,
    title: '',
    description: '',
    category: '',
    priority: 'medium',
    departmentId: null,
    departmentName: null,
    suggestedAssignee: '',
  };
}

export async function handleClassifyExtract(req: Request, res: Response) {
  const rawMessage = req.body?.message;
  const message = sanitizeInput(rawMessage, 2000);
  const selectedLang = normalizeLang(req.body?.selected_language);

  if (!message) return res.status(400).json({ error: 'message required' });

  // No AI configured → let the normal chat path handle it (degraded mode).
  if (!isAiConfigured()) {
    return res.json(chatFallback(message, selectedLang));
  }

  // Active departments ground the model's department choice (server-trusted).
  let departments: { id: string; name: string }[] = [];
  try {
    const rows = await models.departments
      .find({ is_active: true })
      .select('name')
      .lean();
    departments = rows.map((d: any) => ({ id: String(d._id), name: d.name }));
  } catch {
    departments = [];
  }
  const deptNames = departments.map((d) => d.name);

  const system =
    `You are the ticket-intake classifier for a multi-plant IT/HR ticketing system. ` +
    `The user writes in English, Swahili, or Arabic. Analyze ONLY the latest user message.\n\n` +
    `Decide if the user is reporting a problem or making a request that should become a support TICKET ` +
    `(e.g. "my laptop is not working", "I need internet access", "printer is broken"), versus a general ` +
    `chat/question (greetings, questions about the system, asking for counts/policies, small talk).\n\n` +
    `Return ONLY a JSON object with EXACTLY these keys:\n` +
    `{\n` +
    `  "language": "en" | "sw" | "ar",           // detected language of the user message\n` +
    `  "isTicket": boolean,                        // true only for a real problem/request to log\n` +
    `  "title": string,                            // ENGLISH, concise (max 90 chars), "" if not a ticket\n` +
    `  "description": string,                      // ENGLISH, 1-2 sentences, "" if not a ticket\n` +
    `  "category": string,                         // short ENGLISH label e.g. "Hardware", "Network", "" if none\n` +
    `  "priority": "critical" | "high" | "medium" | "low",\n` +
    `  "department": string,                       // MUST be exactly one of the provided names, or "" if unclear\n` +
    `  "suggestedAssignee": string,                // "" if none\n` +
    `  "translatedMessage": string                 // the user message translated to ENGLISH\n` +
    `}\n\n` +
    `Available departments: ${deptNames.length ? deptNames.join(', ') : '(none configured)'}.\n` +
    `Pick "department" only if the issue clearly maps to one; otherwise use "".\n` +
    `Default priority is "medium" unless urgency is expressed.\n` +
    `${INJECTION_GUARD}`;

  try {
    const raw = await callAI({
      system,
      messages: [{ role: 'user', content: message }],
      json: true,
      temperature: 0.1,
      maxTokens: 500,
    });
    const parsed = safeParseJson<any>(raw);
    if (!parsed) return res.json(chatFallback(message, selectedLang));

    const language = normalizeLang(parsed.language) || selectedLang;
    const isTicket = parsed.isTicket === true;

    if (!isTicket) {
      return res.json(chatFallback(message, language));
    }

    const priority: Priority = PRIORITIES.includes(parsed.priority) ? parsed.priority : 'medium';

    // Map the model's department name back to a real id (case-insensitive).
    let departmentId: string | null = null;
    let departmentName: string | null = null;
    const chosen = String(parsed.department ?? '').trim().toLowerCase();
    if (chosen) {
      const match = departments.find((d) => d.name.toLowerCase() === chosen);
      if (match) {
        departmentId = match.id;
        departmentName = match.name;
      }
    }

    const result: ExtractResult = {
      intent: 'ticket',
      language,
      originalMessage: message,
      translatedMessage: sanitizeInput(parsed.translatedMessage || message, 2000),
      title: sanitizeInput(parsed.title || '', 120) || message.slice(0, 90),
      description: sanitizeInput(parsed.description || parsed.title || '', 1000),
      category: sanitizeInput(parsed.category || '', 60),
      priority,
      departmentId,
      departmentName,
      suggestedAssignee: sanitizeInput(parsed.suggestedAssignee || '', 120),
    };
    return res.json(result);
  } catch {
    // Any AI/parse failure → treat as chat so the assistant never breaks.
    return res.json(chatFallback(message, selectedLang));
  }
}

export { LANG_NAMES };
