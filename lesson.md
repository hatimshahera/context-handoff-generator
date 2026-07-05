# Lesson

## What I Built

I built a local-first Context Handoff Generator that accepts ChatGPT shared links and generates a structured Markdown handoff for continuing work in another AI tool.

The first version worked, but the output was too shallow for large conversations. The goal evolved from "make a clean summary" into "make a self-contained Markdown file that the user can paste into the next chatbot without explaining anything again."

## Where This Started

The original idea was simple: paste one or more ChatGPT shared links and get a Markdown file that explains the context clearly enough to continue in Codex, Cursor, Claude, ChatGPT, or another AI tool.

At the start, I thought the main problem was formatting. A ChatGPT shared link is readable by a person, but it is not a clean working brief. So the first plan was:

1. Fetch the shared chat.
2. Extract the visible conversation text.
3. Send it to an LLM.
4. Ask for a structured Markdown handoff.
5. Let the user copy or download the result.

That was a good starting point, but it underestimated the real problem. The real problem was not just "turn a chat into Markdown." The real problem was "preserve enough of the conversation that the user does not have to explain themselves again."

## Where This Ended Up

The tool ended up becoming a faithful conversation context summarizer, not just a handoff-template generator.

The current direction is:

1. Treat the shared chats as source material that must be represented accurately.
2. Summarize the actual discussion, not just answer a fixed checklist.
3. Preserve the conversation arc: what the user wanted, how the discussion changed, what was decided, what broke, what was fixed, and where things ended.
4. Let the user preview the exact text that will be sent to the LLM before generation.
5. Extract the conversation from the share page's server-embedded state (the JSON ChatGPT serializes into the HTML), not from rendered DOM text and not from a headless browser.
6. Reject empty or shell-only results instead of treating them as real conversation content.
7. Make the output useful as a standalone context file for another AI assistant.

This changed the product from a basic "summary generator" into a local-first context transfer tool.

## What I Learned

The useful part of a handoff tool is not only summarization. It needs to preserve decisions, constraints, rejected ideas, current state, next actions, and the user's thinking.

I also learned that the extraction layer matters as much as the LLM prompt. If the backend sends the wrong source text to the model, the generated Markdown cannot be good no matter how strong the prompt is.

The biggest single lesson was about where the data actually lives. "We tried a plain HTTP request and it only returned page chrome" turned out to be misleading. A plain HTTP request does return the full conversation — but it is embedded in the HTML as serialized application state (ChatGPT ships it inside `window.__reactRouterContext`), not as visible rendered text. The early attempt read the *visible* DOM text from the static HTML and correctly found only shell. It never parsed the *serialized state* sitting in a `<script>` tag on the very same response. Those are two completely different things, and confusing them sent the project down a browser-automation detour.

The pattern that actually works for this version is:

1. Fetch the shared link with a normal HTTP request (no browser).
2. Pull ChatGPT's serialized conversation state out of the HTML.
3. Dereference that state into the ordered list of user and assistant messages.
4. Show the extracted prompt text to the user before generation.
5. Generate the handoff from the same text the user previewed.

## What Was Harder Than Expected

Shared ChatGPT pages are harder to parse than they look, but not for the reason I first assumed. The trap was believing the content was unavailable to a plain request; in reality it was available but hidden inside serialized page state rather than visible text. The real fragility is that this embedded-state format is an internal ChatGPT detail that can change without notice, so the parser has to fail loudly rather than silently produce a bad summary.

The biggest product issue was output quality. A short summary is not enough if the user wants to move from ChatGPT into Codex, Cursor, Claude, or another tool. The handoff needs to capture the user's full mental model: what they wanted, what they disliked, what changed, what was rejected, what was decided, and what should happen next.

The biggest technical issue was length. Large chats run into practical API and context limits:

- The raw extracted chat can be too long to send cleanly.
- The model may compress aggressively when too much is packed into one prompt.
- Output token limits can cut off detail.
- If the scraper only extracts part of the shared page, the final Markdown cannot include what was missed.

## Problems We Hit And Fixed

The first version was technically working, but the generated handoff was too short. That showed the product requirement more clearly: this tool is not meant to create a quick summary. It is meant to create a complete context transfer, where the user can paste one Markdown file into the next AI tool and avoid explaining the whole conversation again.

The first fix was prompt-level. I expanded the output structure to include user thinking, conversation timeline, key decisions, rejected ideas, current state, what happened at the end, and raw details worth preserving. I also changed the prompt to explicitly say that the generated Markdown must stand on its own because the next assistant may not open the original shared links.

Another product correction was realizing that the output should not feel like it is answering a fixed list of questions. The user wants the Markdown to correctly represent what was said in the chats. I changed the prompt from a rigid handoff questionnaire to a faithful conversation context summary: high-level summary, full chronological summary, user intent, important details, decisions/fixes, current state, ending, gaps, and continuation prompt.

The next product correction was adding a prompt preview step. The user should be able to see what the scraper actually extracted before trusting the generated Markdown. This is important because shared-link extraction can be imperfect, and because the model can only summarize what the backend actually sends.

The preview step exposed another important failure mode: the first server-side extraction approach did not receive the conversation at all. It only received ChatGPT page shell text like "New chat", "Search chats", "Log in", and the Terms/Privacy notice. The tool now rejects that kind of shell text instead of pretending it is valid source material.

At that point I drew the wrong conclusion. Seeing only shell text from the "plain HTTP" attempt, I assumed the conversation must be rendered entirely client-side and therefore only reachable through a real browser. So the next correction was to switch the extraction engine to Playwright: open the shared link in a headless Chromium, wait for the page to render, and read the message text out of the DOM. On the first failing example this did work — the preview stopped showing login-page noise and started showing the real conversation — which made it feel like the right answer.

Playwright then created a second, deployment-shaped problem. A headless browser needs a browser binary, which is fine locally (`npx playwright install chromium`) but painful on serverless. I had to add `@sparticuz/chromium`, special-case the launch options for Vercel, and wire up `outputFileTracingIncludes` so the binary shipped with the function. That is the "Fix Playwright browser install for Vercel" work. It was a lot of moving parts to make a browser boot inside a 1-second-cold-start serverless function.

Then the approach failed again anyway. On another shared link the tool went right back to "Only ChatGPT page chrome was found." That was the important clue: if a *real browser* also only gets the shell, the problem was never "the page is client-rendered." ChatGPT bot-challenges the headless browser and serves it the logged-out shell, while at the same time serving the full conversation to a plain request — just not as visible text.

The breakthrough was re-reading the raw HTML from a plain `curl`, not the rendered DOM. The entire conversation is right there in the response, serialized into a `<script>` tag as `window.__reactRouterContext` (a "turbo-stream" flat table where every value is stored once and referenced by index). The earlier "plain HTTP" attempt had this exact data in hand and threw it away, because it only looked at visible text. Parsing that serialized state — fetch the HTML, pull the stream table, dereference it, read `linear_conversation` — reconstructs every user and assistant turn with no browser at all. The link that had been failing extracted cleanly on the first try.

So Playwright and `@sparticuz/chromium` came back out completely. The final extractor is a plain `fetch` plus a small dereferencer. It is faster, cheaper, has zero binary dependencies, deploys anywhere, and — the part that matters most — it actually works on the links the browser could not handle.

The most important product moment was taking one step back. Earlier I had added a more complicated multi-chunk parsing approach that made the tool feel worse and did not solve the real failure; rolling it back made the real problem — bad extraction — visible again. The same instinct applied to Playwright: it was a plausible fix that treated the symptom (no visible text) instead of the cause (I was reading the wrong part of the response). "We already tried plain HTTP" was true but incomplete — we tried reading the visible text over HTTP, never the embedded state. Distinguishing those two is what unblocked the whole tool.

The main lesson from all of this: for an AI tool, "it calls the model" is not enough. The tool has to protect the user's context, and getting the source material right can mean looking harder at data you already have instead of reaching for a heavier tool. It also has to make the invisible backend work understandable, especially when the work takes time, fails, or depends on messy external pages.

The product lesson is that users do not want a technically valid summary. They want continuity. If the generated Markdown still forces them to re-prompt, re-explain, or correct the next assistant, then the tool has failed its purpose.

## What I Would Improve

I improved the backend to make extraction more honest. It now fetches the share page over plain HTTP, parses ChatGPT's embedded conversation state, sends only real user/assistant turns to the summarizer, and reports a clear warning when a link cannot be parsed instead of silently summarizing shell text.

I would still improve the tool with:

- Better extraction tests against saved fixtures from real shared chats, so a future ChatGPT format change is caught immediately.
- A fallback parser if ChatGPT changes its serialized-state format again (the embedded-state shape is not a stable public contract).
- Optional manual transcript paste when a shared link cannot be opened.
- Cost/time estimates before processing very large chats.
- A setting for output depth: concise, detailed, or exhaustive.

## Skills Used

- Next.js API routes
- React form state
- Frontend error handling
- Reverse-engineering and parsing embedded page state (React Router turbo-stream)
- Reading raw responses instead of trusting rendered output when debugging extraction
- LLM prompt design
- Markdown generation

## Possible Future Version

A future version could support manual transcript paste, browser-extension capture, richer source attribution, and export formats for specific tools like Cursor rules or Codex task briefs.

The most important future version would make the handoff more inspectable: show extracted source length, extraction method, warnings, and whether anything was truncated. That would help users trust the generated Markdown and understand when a shared chat was too large or too hard to parse perfectly.
