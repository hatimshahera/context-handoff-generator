import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  buildPrompt,
  extractSharedChats,
  MAX_LINKS,
  MAX_PROMPT_CHARS,
  parseLinks,
} from "./chat";
import { checkGenerationLimit } from "./rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY is missing. Add it to .env.local and restart the local dev server.",
      },
      { status: 500 },
    );
  }

  // If the client sends already-extracted (and possibly edited) prompt text,
  // use it directly and skip re-extraction. This is what the step-by-step UI does.
  const promptOverride =
    typeof (body as { prompt?: unknown })?.prompt === "string"
      ? (body as { prompt: string }).prompt.trim()
      : "";

  let userContent: string;
  let warnings: string[] = [];

  if (promptOverride) {
    if (promptOverride.length > MAX_PROMPT_CHARS) {
      return NextResponse.json(
        {
          error: `The extracted text is too long for this public demo. Keep it under ${MAX_PROMPT_CHARS.toLocaleString()} characters.`,
        },
        { status: 400 },
      );
    }

    userContent = promptOverride;
  } else {
    const { links, invalidLinks } = parseLinks(body);

    if (links.length === 0) {
      return NextResponse.json(
        { error: "Send at least one ChatGPT shared link." },
        { status: 400 },
      );
    }

    if (links.length > MAX_LINKS) {
      return NextResponse.json(
        { error: `Send ${MAX_LINKS} links or fewer for this public demo.` },
        { status: 400 },
      );
    }

    if (invalidLinks.length > 0) {
      return NextResponse.json(
        {
          error: `Invalid ChatGPT shared link${invalidLinks.length === 1 ? "" : "s"}: ${invalidLinks.join(", ")}`,
        },
        { status: 400 },
      );
    }

    const extraction = await extractSharedChats(links);

    if (extraction.chats.length === 0) {
      return NextResponse.json(
        {
          error:
            "None of the shared links could be opened or parsed. Confirm the links are public and accessible.",
          warnings: extraction.warnings,
        },
        { status: 422 },
      );
    }

    warnings = extraction.warnings;
    userContent = buildPrompt(extraction.chats);
  }

  const limit = await checkGenerationLimit();
  if (limit.limited) {
    return NextResponse.json(
      {
        error:
          "This public demo allows 3 Markdown generations per IP per day. Please try again later.",
      },
      { status: 429 },
    );
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  let completion;
  try {
    completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You turn ChatGPT conversation exports into precise, intent-focused Markdown context summaries.",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      temperature: 0.2,
      max_tokens: 3000,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: `OpenAI request failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        warnings,
      },
      { status: 502 },
    );
  }

  const markdown = completion.choices[0]?.message.content?.trim();
  if (!markdown) {
    return NextResponse.json(
      { error: "The model returned an empty response.", warnings },
      { status: 502 },
    );
  }

  return NextResponse.json({ markdown, warnings });
}
