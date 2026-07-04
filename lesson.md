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
5. Use Playwright browser extraction because ChatGPT shared pages are rendered client-side.
6. Reject logged-out ChatGPT shell text instead of treating it as real conversation content.
7. Make the output useful as a standalone context file for another AI assistant.

This changed the product from a basic "summary generator" into a local-first context transfer tool.

## What I Learned

The useful part of a handoff tool is not only summarization. It needs to preserve decisions, constraints, rejected ideas, current state, next actions, and the user's thinking.

I also learned that the extraction layer matters as much as the LLM prompt. If the backend sends the wrong source text to the model, the generated Markdown cannot be good no matter how strong the prompt is.

The better pattern for this version is:

1. Open the shared conversation in a headless browser.
2. Detect whether the extracted text is actually conversation content or just ChatGPT page chrome.
3. Extract rendered user/assistant messages from the page DOM.
4. Show the extracted prompt text to the user before generation.
5. Generate the handoff from the same text the user previewed.

## What Was Harder Than Expected

Shared ChatGPT pages can be difficult to parse reliably because their structure may change and some content may be rendered client-side.

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

The next correction was using Playwright as the extraction engine. A plain HTTP request is fast, cheap, and easy to run, but it only sees the static HTML returned by the server. Playwright opens the shared link in a real headless browser, waits for the client-rendered page, and extracts message text from the rendered DOM. On the failed UK visa shared-chat example, this changed the result from useless page chrome to the actual conversation between the user and assistant.

The tradeoff is that Playwright is heavier and more fragile. It requires a browser binary (`npx playwright install chromium`), can be slower, may be harder to deploy on some serverless hosts, and can still break if ChatGPT changes its DOM or blocks automation. But for this tool, it is a reasonable experiment because the whole challenge is about using AI and automation to make useful tools, while documenting the limitations honestly.

The most important product moment was taking one step back. I had added a more complicated multi-chunk parsing approach, but it made the tool feel worse and still did not solve the real failure. Rolling back that path made the problem visible again: the issue was not summarization depth first, it was bad extraction. Once the tool showed the exact text being sent to ChatGPT, the failure became obvious. After that, Playwright was the right next experiment because it attacked the actual bottleneck. This made the tool feel much better: the preview stopped showing login-page noise and started showing the real conversation.

The main lesson from all of this: for an AI tool, "it calls the model" is not enough. The tool has to protect the user's context. It has to make the invisible backend work understandable, especially when the work takes time, fails, or depends on messy external pages.

The product lesson is that users do not want a technically valid summary. They want continuity. If the generated Markdown still forces them to re-prompt, re-explain, or correct the next assistant, then the tool has failed its purpose.

## What I Would Improve

I improved the backend to make extraction more honest. It now uses Playwright browser extraction, detects obvious ChatGPT shell text, and only sends real rendered conversation text to the summarizer.

I would still improve the tool with:

- Better extraction tests against saved fixtures from real shared chats.
- Optional manual transcript paste when a shared link cannot be opened.
- A visible "browser extraction mode" indicator so the user understands why preview can take longer.
- Cost/time estimates before processing very large chats.
- A setting for output depth: concise, detailed, or exhaustive.

## Skills Used

- Next.js API routes
- React form state
- Frontend error handling
- Playwright browser automation
- LLM prompt design
- Markdown generation

## Possible Future Version

A future version could support manual transcript paste, browser-extension capture, richer source attribution, and export formats for specific tools like Cursor rules or Codex task briefs.

The most important future version would make the handoff more inspectable: show extracted source length, extraction method, warnings, and whether anything was truncated. That would help users trust the generated Markdown and understand when a shared chat was too large or too hard to parse perfectly.
