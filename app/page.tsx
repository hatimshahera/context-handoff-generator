"use client";

import { useMemo, useState } from "react";

type ApiResponse =
  | {
      markdown: string;
      warnings?: string[];
    }
  | {
      error: string;
      warnings?: string[];
    };

type PreviewResponse =
  | {
      prompt: string;
      warnings?: string[];
    }
  | {
      error: string;
      warnings?: string[];
    };

function parseLinks(rawLinks: string) {
  return rawLinks
    .split("\n")
    .map((link) => link.trim())
    .filter(Boolean);
}

const MAX_PUBLIC_LINKS = 2;

export default function Home() {
  const [rawLinks, setRawLinks] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [promptPreview, setPromptPreview] = useState("");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [copyState, setCopyState] = useState("");
  const [linksLocked, setLinksLocked] = useState(false);

  const linkCount = useMemo(() => parseLinks(rawLinks).length, [rawLinks]);
  const busy = isLoading || isPreviewLoading;
  const tooManyLinks = linkCount > MAX_PUBLIC_LINKS;

  async function previewPrompt() {
    setError("");
    setWarnings([]);
    setCopyState("");
    setPromptPreview("");
    setMarkdown("");

    const links = parseLinks(rawLinks);
    if (links.length === 0) {
      setError("Paste at least one ChatGPT shared link.");
      return;
    }

    if (links.length > MAX_PUBLIC_LINKS) {
      setError(`This public demo supports up to ${MAX_PUBLIC_LINKS} links at a time.`);
      return;
    }

    setIsPreviewLoading(true);
    try {
      const response = await fetch("/api/context-preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ links }),
      });
      const data = (await response.json()) as PreviewResponse;

      if (!response.ok || "error" in data) {
        setError("error" in data ? data.error : "Something went wrong.");
        setWarnings(data.warnings ?? []);
        return;
      }

      setPromptPreview(data.prompt);
      setWarnings(data.warnings ?? []);
      setLinksLocked(true);
    } catch {
      setError("The request failed. Check that the local app is still running.");
    } finally {
      setIsPreviewLoading(false);
    }
  }

  async function generateMarkdown() {
    setError("");
    setWarnings([]);
    setCopyState("");
    setMarkdown("");

    if (!promptPreview.trim()) {
      setError("Preview your links first, then generate.");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/context-handoff", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ links: parseLinks(rawLinks), prompt: promptPreview }),
      });
      const data = (await response.json()) as ApiResponse;

      if (!response.ok || "error" in data) {
        setError("error" in data ? data.error : "Something went wrong.");
        setWarnings(data.warnings ?? []);
        return;
      }

      setMarkdown(data.markdown);
      setWarnings(data.warnings ?? []);
    } catch {
      setError("The request failed. Check that the local app is still running.");
    } finally {
      setIsLoading(false);
    }
  }

  async function copyMarkdown() {
    if (!markdown) return;

    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState("Copied");
      window.setTimeout(() => setCopyState(""), 1800);
    } catch {
      setCopyState("Copy failed");
    }
  }

  function downloadMarkdown() {
    if (!markdown) return;

    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "context-handoff.md";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="page-shell">
      <header className="intro">
        <p className="eyebrow">Tool 01</p>
        <h1>Context Handoff Generator</h1>
        <p className="lede">
          Paste your ChatGPT shared links, review the extracted text, then generate a
          clean markdown summary of the chat.
        </p>
        <p className="demo-limit">
          Public demo: up to 2 shared links and 3 generations per IP per day.
        </p>
      </header>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <div className="warnings" role="status">
          <strong>Heads up</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ol className="steps">
        {/* Step 1 — Paste links */}
        <li className={`step card${linksLocked ? " is-collapsed" : ""}`}>
          <div className="step-head">
            <span className="step-num">1</span>
            <div className="step-title">
              <h2>Paste your ChatGPT links</h2>
              <p className="step-hint">One shared link per line, 2 links max.</p>
            </div>
            {linksLocked ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setLinksLocked(false)}
              >
                Edit
              </button>
            ) : null}
          </div>

          {linksLocked ? (
            <p className="step-summary">
              <span className="link-count-dot is-ready" />
              {linkCount} link{linkCount === 1 ? "" : "s"} pasted
            </p>
          ) : (
            <div className="step-body">
              <textarea
                id="links"
                value={rawLinks}
                onChange={(event) => setRawLinks(event.target.value)}
                placeholder={
                  "https://chatgpt.com/share/...\nhttps://chat.openai.com/share/..."
                }
                rows={4}
              />
              <div className="form-footer">
                <span
                  className={`link-count${linkCount > 0 ? " is-ready" : ""}${
                    tooManyLinks ? " is-over" : ""
                  }`}
                >
                  <span className="link-count-dot" />
                  {linkCount}/{MAX_PUBLIC_LINKS} link{linkCount === 1 ? "" : "s"} ready
                </span>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={previewPrompt}
                  disabled={busy || tooManyLinks}
                >
                  {isPreviewLoading ? "Previewing…" : "Preview extracted text"}
                </button>
              </div>
            </div>
          )}
        </li>

        {/* Step 2 — Review & edit */}
        <li className={`step card${promptPreview ? "" : " is-locked"}`}>
          <div className="step-head">
            <span className="step-num">2</span>
            <div className="step-title">
              <h2>Review &amp; edit the extracted text</h2>
              <p className="step-hint">
                Trim or tweak anything before it goes to the model.
              </p>
            </div>
          </div>
          <div className="step-body">
            <textarea
              className="preview-edit"
              value={promptPreview}
              onChange={(event) => setPromptPreview(event.target.value)}
              placeholder="Preview your links in step 1 and the extracted text will appear here."
              rows={12}
              disabled={!promptPreview}
            />
            <div className="form-footer end">
              <button
                type="button"
                className="btn-primary"
                onClick={generateMarkdown}
                disabled={busy || !promptPreview.trim()}
              >
                {isLoading ? "Generating…" : "Generate summary"}
              </button>
            </div>
          </div>
        </li>

        {/* Step 3 — Copy result */}
        <li className={`step card${markdown ? "" : " is-locked"}`}>
          <div className="step-head">
            <span className="step-num">3</span>
            <div className="step-title">
              <h2>Copy your markdown summary</h2>
              <p className="step-hint">
                Drop it into Codex, Cursor, Claude, or ChatGPT.
              </p>
            </div>
            <div className="actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={copyMarkdown}
                disabled={!markdown}
              >
                {copyState || "Copy"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={downloadMarkdown}
                disabled={!markdown}
              >
                Download .md
              </button>
            </div>
          </div>
          <pre className={markdown ? "" : "is-empty"}>
            {markdown || "Your generated summary will appear here."}
          </pre>
        </li>
      </ol>

      <p className="privacy-note">
        <span className="privacy-icon" aria-hidden="true">
          🔒
        </span>
        Public demo traffic is limited. Do not process chats containing passwords,
        API keys, private data, or sensitive information.
      </p>
    </main>
  );
}
