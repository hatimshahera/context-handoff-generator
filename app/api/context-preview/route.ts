import { NextResponse } from "next/server";
import { buildPrompt, extractSharedChats, MAX_LINKS, parseLinks } from "../context-handoff/chat";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { links, invalidLinks } = parseLinks(body);

  if (links.length === 0) {
    return NextResponse.json(
      { error: "Send at least one ChatGPT shared link." },
      { status: 400 },
    );
  }

  if (links.length > MAX_LINKS) {
    return NextResponse.json(
      { error: `Send ${MAX_LINKS} links or fewer for this v1 tool.` },
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

  const { chats, warnings } = await extractSharedChats(links);

  if (chats.length === 0) {
    return NextResponse.json(
      {
        error:
          "None of the shared links could be opened or parsed. Confirm the links are public and accessible.",
        warnings,
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    prompt: buildPrompt(chats),
    warnings,
  });
}
