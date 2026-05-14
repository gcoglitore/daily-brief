// Ask-the-brief Cloud Function. POST /api/ask with {question, brief} and get
// back a Claude-generated answer grounded only in the supplied brief text.
//
// Prerequisites (one-time, run by repo owner):
//   firebase functions:secrets:set ANTHROPIC_API_KEY
//
// CI deploys this alongside hosting via `firebase deploy --only hosting,functions`.
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");
const Anthropic = require("@anthropic-ai/sdk");

setGlobalOptions({ region: "us-central1", maxInstances: 5 });

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

// Per-IP rate limit. In-memory so it resets on cold start — acceptable for a
// low-traffic site. Tighter limits can be enforced by Firestore-backed counter.
const buckets = new Map();
const LIMIT_PER_HOUR = 30;
const HOUR_MS = 60 * 60 * 1000;
function checkRate(ip) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || (now - b.start) > HOUR_MS) {
    b = { count: 0, start: now };
    buckets.set(ip, b);
  }
  b.count++;
  return b.count <= LIMIT_PER_HOUR;
}

const SYSTEM_PROMPT =
  "You are a senior intelligence analyst answering follow-up questions about today's Daily Intelligence Brief. Use ONLY the information in the brief text the user supplies. If the brief doesn't cover the question, say so explicitly — never speculate or invent facts. Keep answers to 2-4 sentences. Cite section names like '(see Section II: Indo-Pacific)' when relevant. Output plain text only — no markdown, no HTML, no headers.";

exports.ask = onRequest(
  {
    secrets: [ANTHROPIC_API_KEY],
    cors: ["https://themorningbrief-ai-fork.web.app", "https://daily-security-brief.web.app"],
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }

    const ip = (req.headers["x-forwarded-for"] || req.ip || "unknown")
      .toString()
      .split(",")[0]
      .trim();
    if (!checkRate(ip)) {
      res.status(429).json({ error: "Rate limit exceeded — 30 questions per hour per IP." });
      return;
    }

    const body = req.body || {};
    const question = String(body.question || "").trim().slice(0, 500);
    const brief = String(body.brief || "").trim().slice(0, 30000);
    if (!question) { res.status(400).json({ error: "Missing question" }); return; }
    if (!brief)    { res.status(400).json({ error: "Missing brief text" }); return; }

    try {
      const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
      const result = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: "TODAY'S BRIEF (verbatim):\n\n" + brief + "\n\n---\n\nQUESTION: " + question,
          },
        ],
      });
      const text =
        (result.content && result.content[0] && result.content[0].text) || "(no response)";
      res.status(200).json({ answer: text.slice(0, 2000) });
    } catch (e) {
      console.error("[ask]", e && e.message);
      res.status(500).json({ error: "Internal error" });
    }
  }
);
