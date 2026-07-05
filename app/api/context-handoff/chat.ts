export type ExtractedChat = {
  link: string;
  text: string;
};

export const MAX_LINKS = 2;
const MAX_CHARS_PER_CHAT = 35000;
export const MAX_PROMPT_CHARS = 75000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Roles that carry conversation content worth handing off. ChatGPT tool/system
// turns are mostly hidden plumbing (redacted plugin output, hidden context), so
// we keep the human-facing turns.
const KEEP_ROLES = new Set(["user", "assistant"]);

export function parseLinks(value: unknown) {
  const links = Array.isArray((value as { links?: unknown }).links)
    ? (value as { links: unknown[] }).links
        .map((link) => (typeof link === "string" ? link.trim() : ""))
        .filter(Boolean)
    : [];

  const invalidLinks = links.filter((link) => !isChatGptShareLink(link));

  return { links, invalidLinks };
}

function isChatGptShareLink(link: string) {
  try {
    const url = new URL(link);
    const allowedHosts = ["chatgpt.com", "chat.openai.com"];
    return allowedHosts.includes(url.hostname) && url.pathname.startsWith("/share/");
  } catch {
    return false;
  }
}

function cleanWhitespace(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Extraction
//
// ChatGPT share pages server-render the full conversation into the HTML inside
// React Router's `window.__reactRouterContext.streamController` payload. That
// payload is a "turbo-stream" flat table: one JSON array where every value is
// stored once and referenced by its index. We fetch the HTML (no browser), pull
// that table out, dereference it into a normal object graph, then read the
// `linear_conversation` node list. A plain fetch is what a headless browser is
// NOT: it is not bot-challenged into the logged-out app shell.
// ---------------------------------------------------------------------------

async function fetchShareHtml(link: string) {
  const response = await fetch(link, {
    headers: {
      "user-agent": BROWSER_UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `The share page returned HTTP ${response.status}. The link may be private, deleted, or restricted.`,
    );
  }

  return response.text();
}

function extractStreamTable(html: string): unknown[] {
  const re =
    /window\.__reactRouterContext\.streamController\.enqueue\("((?:[^"\\]|\\.)*)"\)/g;
  const chunks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    // Each capture is the inside of a JS string literal; decode the escapes.
    chunks.push(JSON.parse(`"${match[1]}"`));
  }

  if (chunks.length === 0) {
    throw new Error(
      "The conversation data was not found in the share page. ChatGPT may have changed its page format, or the link is not a public shared conversation.",
    );
  }

  // The stream is newline-delimited JSON values; the first line is the flat
  // table of every referenced value. (JSON escapes real newlines, so splitting
  // on "\n" never cuts through a string.)
  const firstLine = chunks.join("").split("\n")[0];
  const table = JSON.parse(firstLine);
  if (!Array.isArray(table)) {
    throw new Error("Unexpected share-page data format.");
  }
  return table;
}

// Resolve a turbo-stream flat table into a normal object graph. A row can be a
// literal (string/bool/null), a number (reference to another row), an array of
// references, or an object whose keys `_<n>` reference the key string at row n.
function makeDeref(rows: unknown[]) {
  const cache = new Map<number, unknown>();

  function deref(ref: unknown, seen: Set<number>): unknown {
    if (typeof ref !== "number") return ref;
    if (ref < 0) return null; // turbo-stream sentinel (undefined / hole)
    if (seen.has(ref)) return null; // cycle guard
    if (cache.has(ref)) return cache.get(ref);

    const row = rows[ref];
    const next = new Set(seen).add(ref);
    let out: unknown;

    if (row === null || typeof row === "string" || typeof row === "boolean") {
      out = row;
    } else if (typeof row === "number") {
      out = deref(row, next);
    } else if (Array.isArray(row)) {
      out = row.map((item) => deref(item, next));
    } else if (row && typeof row === "object") {
      const obj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        const resolvedKey = key.startsWith("_")
          ? String(deref(Number(key.slice(1)), next))
          : key;
        obj[resolvedKey] = deref(value, next);
      }
      out = obj;
    } else {
      out = row;
    }

    cache.set(ref, out);
    return out;
  }

  return (ref: unknown) => deref(ref, new Set<number>());
}

function findKeyDeep(value: unknown, key: string, depth = 0): unknown {
  if (!value || typeof value !== "object" || depth > 14) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKeyDeep(item, key, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (key in record) return record[key];
  for (const child of Object.values(record)) {
    const found = findKeyDeep(child, key, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function partsToText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function conversationToText(linear: unknown): string {
  if (!Array.isArray(linear)) return "";

  const turns: string[] = [];
  for (const node of linear) {
    const message = (node as { message?: unknown })?.message as
      | Record<string, unknown>
      | undefined;
    if (!message) continue;

    const role = (message.author as { role?: string } | undefined)?.role;
    if (!role || !KEEP_ROLES.has(role)) continue;

    const metadata = message.metadata as
      | { is_visually_hidden_from_conversation?: boolean }
      | undefined;
    if (metadata?.is_visually_hidden_from_conversation) continue;

    const text = partsToText((message.content as { parts?: unknown } | undefined)?.parts);
    if (!text) continue;

    turns.push(`${role}:\n${text}`);
  }

  return turns.join("\n\n");
}

export async function extractSharedChat(link: string): Promise<ExtractedChat> {
  const html = await fetchShareHtml(link);
  const table = extractStreamTable(html);
  const root = makeDeref(table)(0);
  const linear = findKeyDeep(root, "linear_conversation");
  const text = cleanWhitespace(conversationToText(linear)).slice(0, MAX_CHARS_PER_CHAT);

  if (text.length < 40) {
    throw new Error(
      "No readable conversation text was found. The link may be private, deleted, empty, or restricted.",
    );
  }

  return { link, text };
}

export async function extractSharedChats(links: string[]) {
  const warnings: string[] = [];
  const chats: ExtractedChat[] = [];

  for (const link of links) {
    try {
      const chat = await extractSharedChat(link);
      chats.push(chat);
    } catch (error) {
      warnings.push(
        `${link} failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  return { chats, warnings };
}

export function buildPrompt(chats: ExtractedChat[]) {
  const sourceList = chats
    .map((chat, index) => `Chat ${index + 1}: ${chat.link}\n${chat.text}`)
    .join("\n\n---\n\n");

  return `Generate one clean Markdown context summary from these ChatGPT shared conversations.

The output must help the next AI assistant understand what the user actually wants, what has already been decided, and what should happen next. Avoid padded narration. Do not produce a generic transcript summary. Prioritize user intent, concrete facts, current state, constraints, and next actions.

Rules:
- Do not invent details.
- If something is unclear, write "Unknown" or "Not specified".
- Start from what the user is trying to accomplish, not from what the assistant said.
- Preserve decisions, constraints, rejected ideas, current direction, working style, and implicit priorities when they are visible in the conversation.
- Include concrete names, files, technologies, constraints, acceptance criteria, commands, and implementation choices when they appear.
- If the assistant gave bad, incomplete, or rejected advice, label it as rejected or uncertain instead of carrying it forward as truth.
- Make the final "Copy-Paste Prompt" complete enough that the next AI tool can continue without the user writing another explanation.
- Assume the next assistant will not see the original chat links. The Markdown itself must carry the context.
- Keep the Markdown direct, specific, and readable.
- Avoid filler, motivational language, restating obvious facts, and long generic sections.
- Prefer bullets over paragraphs when bullets make the information easier to scan.

Required Markdown structure:

# Context Summary

## Source Chats

- [Chat 1](...)

## User Goal

State the user's real objective in plain language. Include why they care if it is visible.

## Current Ask

Explain what the user is asking for now, based on the end of the conversation.

## Important Context

List the facts, preferences, constraints, files, technologies, URLs, commands, and assumptions that matter.

## Key Decisions Made

List decisions that should be treated as settled unless the user changes direction. Include reasons or tradeoffs when known.

## Rejected Or Changed Ideas

List approaches, wording, designs, architectures, or plans that were considered and then changed, removed, or rejected.

## Current State

Explain where things stand now, including work completed, files changed, pending work, known issues, and assumptions.

## Open Questions

List only unknowns, risks, and decisions that still need confirmation. If none are visible, write "None specified."

## Recommended Next Steps

Give concrete next actions in priority order. Make them actionable, not generic.

## Copy-Paste Prompt For The Next AI Tool

Write a self-contained prompt in the user's voice or on the user's behalf. It should include the goal, constraints, relevant context, current state, and expected outcome.

## Raw Details Worth Preserving

Add only specific snippets, requirements, names, file paths, commands, edge cases, or implementation details that did not fit cleanly above but may matter later.

Conversations:

${sourceList}`;
}
