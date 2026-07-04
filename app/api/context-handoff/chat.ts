export type ExtractedChat = {
  link: string;
  text: string;
};

export const MAX_LINKS = 6;
const MAX_CHARS_PER_CHAT = 35000;
const CHATGPT_SHELL_MARKERS = [
  "New chat",
  "Search chats",
  "Log in",
  "Sign up for free",
  "ChatGPT is AI.",
];

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

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanWhitespace(value: string) {
  return decodeHtmlEntities(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeChatGptShell(text: string) {
  const markerCount = CHATGPT_SHELL_MARKERS.filter((marker) =>
    text.includes(marker),
  ).length;
  const hasConversationMarkers =
    text.includes("data-message-author-role") ||
    text.includes("You said:") ||
    text.includes("ChatGPT said:");

  return markerCount >= 3 && !hasConversationMarkers;
}

async function extractWithPlaywright(link: string) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    });

    await page.goto(link, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const roleTexts = await page
      .locator("[data-message-author-role]")
      .evaluateAll((nodes) =>
        nodes
          .map((node) => {
            const role = node.getAttribute("data-message-author-role") ?? "message";
            const text = (node.textContent ?? "").trim();
            return text ? `${role}:\n${text}` : "";
          })
          .filter(Boolean),
      )
      .catch(() => []);

    const renderedText =
      roleTexts.length > 0
        ? roleTexts.join("\n\n")
        : await page.locator("body").innerText({ timeout: 5000 });

    return cleanWhitespace(renderedText).slice(0, MAX_CHARS_PER_CHAT);
  } finally {
    await browser.close();
  }
}

export async function extractSharedChat(link: string): Promise<ExtractedChat> {
  const renderedText = await extractWithPlaywright(link);
  if (renderedText.length >= 120 && !looksLikeChatGptShell(renderedText)) {
    return { link, text: renderedText };
  }

  if (renderedText.length < 120) {
    throw new Error(
      "No readable conversation text was found. The link may be private, deleted, restricted, or the page structure may have changed.",
    );
  }

  throw new Error(
    "Only ChatGPT page chrome was found. The shared conversation may not be exposed to logged-out browser extraction.",
  );
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

  return `Generate one structured Markdown handoff document from these ChatGPT shared conversations.

The goal is not a short summary. The goal is a deep, useful context transfer that lets the user continue in another AI tool without re-explaining their thinking, preferences, decisions, constraints, false starts, and current direction. The generated Markdown should be self-contained enough that the user can paste only this Markdown into the next chatbot and the next chatbot still understands the whole picture.

Rules:
- Do not invent details.
- If something is unclear, write "Unknown" or "Not specified".
- Preserve user intent, decisions, constraints, rejected ideas, current direction, emotional tone, working style, and implicit priorities when they are visible in the conversation.
- Capture nuance and intricacies. Do not flatten the conversation into generic bullets.
- Include concrete details, names, files, technologies, constraints, acceptance criteria, and implementation choices when they appear.
- Explain what the user was trying to achieve, what they cared about, and how their thinking evolved.
- If the conversation includes back-and-forth refinement, show that progression instead of only the final answer.
- Make the final "Copy-Paste Prompt" complete enough that the next AI tool can continue work without the user prompting again.
- Assume the next assistant will not see the original chat links. The Markdown itself must carry the context.
- Make the output useful for continuing work in Codex, Cursor, Claude, ChatGPT, or another AI tool.
- Keep the Markdown clean and readable.
- Prefer thoroughness over brevity. For a substantial conversation, produce a substantial handoff.
- Avoid filler. Every detail should help preserve context or support continuation.

Required Markdown structure:

# Context Handoff

## Source Chats

- [Chat 1](...)

## What This Was About

Write a clear overview of the project, problem, or discussion. Include why it mattered to the user. This section should let a new assistant orient itself without opening the source chat.

## How The Conversation Started

Explain the original situation, question, or motivation.

## What The User Was Thinking

Capture the user's goals, preferences, concerns, assumptions, constraints, taste, working style, and any implicit intent that would matter to the next AI assistant.

## Conversation Timeline

Summarize the conversation in order. Include the meaningful turns, changes in direction, discoveries, and refinements. This should read like useful working notes, not a tiny summary.

## Key Decisions Made

List decisions and explain the reason or tradeoff when available.

## Important Context Not To Lose

Include details another AI assistant would need to avoid making the user repeat themselves.

## Things That Changed Or Were Rejected

Include ideas, approaches, wording, designs, architectures, or plans that were considered and then changed, removed, or rejected.

## Current State

Explain where things stand now, including any work completed, files changed, pending work, known issues, and assumptions.

## What Happened At The End

Describe the final state of the conversation: the last user request, the last assistant action or answer, unresolved friction, and what the user likely expects next.

## Open Questions

List unknowns, risks, and decisions that still need user confirmation.

## Recommended Next Steps

Give concrete next actions in priority order.

## Copy-Paste Prompt For The Next AI Tool

Write a polished, self-contained prompt in the user's voice or on the user's behalf. It should include enough context, constraints, source-chat conclusions, current state, and expected outcome that the next AI assistant can start immediately. The user should not need to add another explanatory paragraph after this.

## Compressed Conversation Notes

Provide a concise but still useful recap of the original conversation flow. This is the only compressed section; do not make the whole document compressed.

## Raw Detail Worth Preserving

Add any specific snippets, requirements, names, file paths, commands, edge cases, or implementation details that did not fit cleanly above but may matter later.

Conversations:

${sourceList}`;
}
