# Tool 01: Context Handoff Generator

Status: in-progress

## Day

01

## Short Description

Context Handoff Generator turns one or more ChatGPT shared links into a detailed, self-contained Markdown brief that can be pasted into Codex, Cursor, Claude, ChatGPT, or another AI coding tool.

## Problem It Solves

Ideas often start in ChatGPT and then move into coding tools. A shared ChatGPT link is useful for viewing a conversation, but it is not a working brief. This tool extracts accessible shared-chat text and asks an LLM to produce a structured handoff document that carries the whole picture, so the user should not need to explain the context again.

## Features

- Paste one or more ChatGPT shared links, one per line.
- Validate `https://chatgpt.com/share/...` and `https://chat.openai.com/share/...` links.
- Generate one combined `context-handoff.md` document.
- Preview the exact extracted prompt text before sending it to OpenAI.
- Use Playwright browser extraction to read the rendered shared conversation.
- Preserve user intent, conversation timeline, decisions, rejected ideas, current state, and what happened at the end.
- Produce a self-contained copy-paste prompt for the next AI tool.
- Preview, copy, and download the Markdown.
- Show clear errors for invalid, private, deleted, restricted, or unparseable links.
- Runs locally with the user's own OpenAI API key.
- No login, database, saved chats, saved links, or stored API keys.

## Tech Stack

- Next.js App Router
- React
- OpenAI API
- Playwright browser extraction for rendered ChatGPT shared pages

## How To Run Locally

```bash
npm install
npx playwright install chromium
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Add this to `.env.local`:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

Do not commit real API keys.

## How To Use It

1. Open the local app.
2. Paste one or more public ChatGPT shared links, one per line.
3. Click `Preview Text Sent To ChatGPT` to inspect what the tool extracted.
4. Click `Generate Context Markdown`.
5. Review the generated Markdown.
6. Copy it or download it as `context-handoff.md`.

## Privacy Note

This is an open-source local-first tool. Users run it with their own OpenAI API key. The v1 hosted website/demo should not ask visitors to paste API keys into the website and should not make the maintainer pay for other people's LLM usage.

Do not process chats containing passwords, API keys, private data, or sensitive information unless you understand the privacy implications.

## Limitations

- Shared ChatGPT links must be accessible.
- Shared links may only include the conversation up to the point where the link was created.
- Some links may fail if they are private, deleted, workspace-restricted, or if the page structure changes.
- Playwright improves extraction for client-rendered ChatGPT pages, but it is heavier than a plain HTTP request and can still fail if ChatGPT blocks automation, changes the DOM, or does not expose the shared chat to a logged-out browser.
- This v1 intentionally avoids accounts, storage, payments, background jobs, and browser extensions.

## Links

- Live demo: placeholder
- GitHub/public repo: placeholder
- Reel/social: placeholder
