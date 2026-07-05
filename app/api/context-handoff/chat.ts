export type ExtractedChat = {
  link: string;
  text: string;
};

export const MAX_LINKS = 2;
const MAX_CHARS_PER_CHAT = 35000;
export const MAX_PROMPT_CHARS = 75000;
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
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= "0";
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

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
