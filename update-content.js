#!/usr/bin/env node
const Anthropic = require("@anthropic-ai/sdk");
const sanitizeHtml = require("sanitize-html");
const fs = require("fs");
const path = require("path");

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("FATAL: ANTHROPIC_API_KEY is not set. Refusing to run.");
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Allow only the structural tags + classes the template expects. Strip scripts,
// event handlers, style, iframes — anything Claude shouldn't be emitting but
// could slip through via indirect prompt injection in a web_search result.
const SANITIZE_OPTIONS = {
  allowedTags: [
    "div", "span", "p", "strong", "em", "b", "i", "br", "h4", "h5",
    "sup", "a", "ul", "li", "details", "summary",
  ],
  allowedAttributes: {
    "*": ["class"],
    "a": ["class", "href", "title", "target", "rel"],
    "sup": ["class"],
    "details": ["class", "open"],
    "summary": ["class"],
  },
  // Citations are https-only. Any javascript:, data:, http:, mailto:, etc.
  // gets the href stripped, leaving the link text as plain (clickless) span.
  allowedSchemes: ["https"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  enforceHtmlBoundary: false,
  transformTags: {
    // Force every surviving <a> into a safe new-tab link with no opener and
    // no referrer leak — Claude's prompt is supposed to set these but we
    // belt-and-suspenders here against indirect prompt injection.
    "a": (tagName, attribs) => {
      const out = { class: "cite-a" };
      if (attribs.href) out.href = attribs.href;
      if (attribs.title) out.title = attribs.title;
      out.target = "_blank";
      out.rel = "noopener noreferrer nofollow";
      return { tagName: "a", attribs: out };
    },
  },
};
function scrubSection(html) {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

// HTML-escape plain text that will be substituted into the HTML stream.
// Used for the photo caption and the FLASH ticker headlines so that even a
// malformed RSS title with a raw "<" can't break the markup.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// All date fields are computed in UTC so dateFull, docNumber, and timestamp
// can never disagree (the previous mix of America/New_York for dateFull and
// UTC for the doc-number/timestamp produced a day-mismatch every evening ET).
// The brief is published at 1000Z so UTC also matches the publication slug.
function dateInfo() {
  const now = new Date();
  const dateFull = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "UTC",
  }).toUpperCase();
  const yy = now.getUTCFullYear().toString().slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const docNumber = `DSB-${yy}${mm}${dd}-001`;
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mn = String(now.getUTCMinutes()).padStart(2, "0");
  const month = now.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase();
  const day = now.getUTCDate();
  const year = now.getUTCFullYear();
  const timestamp = `${hh}${mn}Z ${month} ${day}, ${year}`;
  return { dateFull, docNumber, timestamp };
}

const { dateFull } = dateInfo();

function ukraineWarDay() {
  const start = new Date("2022-02-24T00:00:00Z");
  const today = new Date();
  const days = Math.floor((today - start) / 86400000) + 1;
  return days.toLocaleString();
}
const UKRAINE_DAY = ukraineWarDay();


const STRUCTURE_REMINDER = `Use this exact HTML structure (no <style>, no <script>, no markdown code fences):
<div class="region">
  <div class="rn">REGION OR TOPIC NAME <span class="badge bc">CRITICAL</span></div>
  <div class="f"><span class="fn">1.</span><span>(S) Finding text with <strong>key terms</strong> bolded.<sup class="cite"><a href="https://primary-source-url-1" title="publisher.com">1</a><a href="https://primary-source-url-2" title="publisher.com">2</a></sup></span></div>
  <div class="f"><span class="fn">2.</span><span>(S) ...<sup class="cite"><a href="https://...">1</a></sup></span></div>
  <div class="kj">
    <div class="kjl">// KEY JUDGMENT — HIGH CONFIDENCE</div>
    Judgment text.
    <details class="dissent"><summary>// DISSENTING VIEW</summary><p>The strongest opposing analysis: 1-2 sentences laying out the most credible counter-argument to the judgment above — what the contrarian case is, who holds it, why it could be right.</p></details>
  </div>
</div>
Use multiple region blocks per section. Badge color classes: bc (red/critical), bh (orange/high), be (yellow/elevated), bm (blue/moderate). Begin findings with "(S)".

CITATIONS — REQUIRED: After every finding, append a <sup class="cite">...</sup> containing 1–3 <a href="..."> links to the actual primary-source URLs you read via the web_search tool. Use ONLY https URLs that web_search returned in this turn — never fabricate or guess a URL. The link text is just the footnote number ("1", "2", "3"); put the publisher hostname in the title="" attribute. If web_search returned nothing usable for a finding, omit the <sup> entirely rather than invent a citation.

DISSENTING VIEW — REQUIRED: Every <div class="kj"> must include a <details class="dissent">...</details> block presenting the strongest credible counter-argument to your key judgment. This is standard IC analytic tradecraft — even high-confidence judgments deserve a documented opposing view. Keep it to 1-2 sentences. Don't fabricate a contrarian view if no real one exists; if the judgment is uncontested, write "<p>No substantive contrarian analysis identified at this confidence level.</p>" instead.

Output ONLY the HTML region divs — no preamble, no markdown fences, no explanation.`;

const REACTION_STRUCTURE = `Use this exact HTML structure (no <style>, no <script>, no markdown fences). Output two blocks back-to-back:

FIRST: a <div class="reaction-k">// GLOBAL REACTION — MARKETS & HEADLINES</div> followed by a <div class="reaction-grid"> containing exactly 4 reaction-card divs:
<div class="reaction-card"><h4>Oil & inflation</h4><p>2-3 sentences on today's oil prices (Brent/WTI), inflation pressure, energy market.<sup class="cite"><a href="https://..." title="publisher.com">1</a></sup></p><span class="mini">SOURCE CUE // [PUBLISHER + DATE]</span></div>
<div class="reaction-card"><h4>Gold & dollar</h4><p>2-3 sentences on safe-haven flows, gold movement, USD strength.<sup class="cite"><a href="https://..." title="publisher.com">1</a></sup></p><span class="mini">SOURCE CUE // [PUBLISHER + DATE]</span></div>
<div class="reaction-card"><h4>Shipping signal</h4><p>2-3 sentences on key chokepoints, vessel disruptions, transit risk.<sup class="cite"><a href="https://..." title="publisher.com">1</a></sup></p><span class="mini">SOURCE CUE // [PUBLISHER + DATE]</span></div>
<div class="reaction-card reaction-wide"><h4>Executive readout</h4><p>2-3 sentence cross-cutting analytic note tying the cards together.</p><span class="mini">ANALYTIC NOTE // [ONE-LINE TAKEAWAY]</span></div>

SECOND: a <div class="headline-grid"> containing exactly 5 headline-tile divs in this order — United States, China, Russia, Iran, Europe:
<div class="headline-tile"><h5>United States</h5><p>1-2 sentences on the US perspective today.<sup class="cite"><a href="https://..." title="publisher.com">1</a></sup></p><span>[PUBLISHER]</span></div>
... (repeat for China, Russia, Iran, Europe)

CITATIONS — REQUIRED: every <p> ends with a <sup class="cite"> containing 1–2 https <a> links to actual URLs returned by web_search this turn. Never fabricate URLs. If web_search produced no usable source for one tile, omit the <sup>. The link text is the footnote number; the publisher hostname goes in title="".

Output ONLY this raw HTML — no preamble, no code fences, no explanations.`;

const SECTIONS = {
  exec: {
    label: "Executive Summary",
    prompt: `Today is ${dateFull}. Search the web for today's most critical global security developments and write a 4-5 sentence Executive Summary covering: any active US-Iran/Middle East situation; current Russia-Ukraine war status — TODAY IS DAY ${UKRAINE_DAY} of the war (Feb 24, 2022 invasion start). USE EXACTLY "Day ${UKRAINE_DAY}" — do not guess from search results.; any major Indo-Pacific or PLA activity; any other tier-1 items. Use <strong> tags around critical terms (specific countries, vessels, percentages, day counts, named officials). Wrap the entire summary in a single <p> tag. Begin with "(S)". Output ONLY the <p>...</p> HTML — no markdown fences, no preamble.`,
  },
  reaction: {
    label: "Global Reaction (markets & headlines)",
    prompt: `Today is ${dateFull}. Search the web for today's market reaction to global security tensions: oil/Brent prices, gold movement, USD strength, key shipping chokepoints (especially Strait of Hormuz), and the headline narrative from the United States, China, Russia, Iran, and Europe. ${REACTION_STRUCTURE}`,
  },
  s1: {
    label: "Middle East & CENTCOM",
    prompt: `Today is ${dateFull}. Search the web for current Middle East / CENTCOM developments. Cover: US-Iran situation, Strait of Hormuz, Israel-Lebanon, Syria, US carrier strike groups in CENTCOM AOR, Houthi/Yemen activity. ${STRUCTURE_REMINDER}`,
  },
  s2: {
    label: "Indo-Pacific & INDOPACOM",
    prompt: `Today is ${dateFull}. Search the web for current Indo-Pacific developments. Cover: China/Taiwan PLA activity, South China Sea, North Korea weapons tests and posture, Japan/Korea/Philippines defense activity. ${STRUCTURE_REMINDER}`,
  },
  s3: {
    label: "European Theater & NATO",
    prompt: `Today is ${dateFull}. Search the web for current European/NATO developments. Cover: Russia-Ukraine war (TODAY IS DAY ${UKRAINE_DAY} — use this exact figure, do NOT trust day counts from search results which are often outdated), NATO Arctic activity, Russian threats to Baltic states, European defense initiatives. ${STRUCTURE_REMINDER}`,
  },
  s4: {
    label: "U.S. Force Posture",
    prompt: `Today is ${dateFull}. Search the web for current U.S. force posture and naval disposition. Cover: U.S. carrier strike group locations, deployments, DEFCON status if available, readiness assessments. ${STRUCTURE_REMINDER}`,
  },
  s5: {
    label: "Cyber & Information Warfare",
    prompt: `Today is ${dateFull}. Search the web for current cyber threats and information warfare developments. Cover: Iran cyber activity, Chinese PLA cyber operations, Russian cyber operations, recent attributed attacks. ${STRUCTURE_REMINDER}`,
  },
  s6: {
    label: "WMD & Nuclear Watch",
    prompt: `Today is ${dateFull}. Search the web for current WMD and nuclear developments. Cover: North Korea nuclear/missile tests, Iran nuclear program status, Russia nuclear posture, China nuclear expansion. ${STRUCTURE_REMINDER}`,
  },
  s7: {
    label: "Terrorism",
    prompt: `Today is ${dateFull}. Search the web for current terrorism and transnational threat developments. Cover: ISIS in Syria, AQAP in Yemen, ISIS-K in South/Central Asia, Sahel jihadist activity in Africa. ${STRUCTURE_REMINDER}`,
  },
  s8: {
    label: "Arctic & High North",
    prompt: `Today is ${dateFull}. Search the web for current Arctic and High North developments. Cover: NATO Arctic Sentry operation status, Russian Arctic buildup and warnings, Svalbard contingency, strategic resource competition. ${STRUCTURE_REMINDER}`,
  },
};

const SYSTEM = `You are a senior intelligence analyst writing an open-source intelligence brief grounded in current reporting. Use the web_search tool to find real, current developments before writing each section. Cite specific dates, named officials, vessel names, and locations only when verified by search results. Write in measured, authoritative IC briefing language. Output ONLY the requested HTML — no markdown code fences (no \`\`\`), no preamble, no postamble, no explanation.`;

const PER_SECTION_TIMEOUT_MS = 90000;

// Auto-close any unclosed HTML tags so a truncated/malformed section response
// can't cascade into the rest of the document layout.
const VOID_TAGS = new Set(["br","img","hr","input","meta","link","area","base","col","source","track","wbr"]);
function balanceHtmlTags(html) {
  // First strip any trailing unclosed tag fragment (e.g. "<span class=\"fn" with
  // no closing >). If the last "<" has no matching ">" after it, drop everything
  // from that "<" onward.
  const lastLt = html.lastIndexOf("<");
  const lastGt = html.lastIndexOf(">");
  if (lastLt > lastGt) html = html.slice(0, lastLt).replace(/\s+$/, "");

  const stack = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const full = m[0];
    const name = m[1].toLowerCase();
    if (VOID_TAGS.has(name) || full.endsWith("/>")) continue;
    if (full.startsWith("</")) {
      const idx = stack.lastIndexOf(name);
      if (idx >= 0) stack.length = idx;
    } else {
      stack.push(name);
    }
  }
  if (stack.length === 0) return html;
  let suffix = "";
  for (let i = stack.length - 1; i >= 0; i--) suffix += "</" + stack[i] + ">";
  return html + suffix;
}

async function generateSection(key, label, prompt) {
  const start = Date.now();
  console.log(`[${key}] Generating ${label}...`);
  try {
    const response = await client.messages.create(
      {
        // Pinned to Sonnet 4.6 (not a moving "latest" alias). Bump intentionally
        // when validating a newer model's HTML output against this template.
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      },
      { timeout: PER_SECTION_TIMEOUT_MS, maxRetries: 0 }
    );

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const stripped = text
      .replace(/^```(?:html)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();
    const cleaned = balanceHtmlTags(stripped);

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${key}] ✓ ${cleaned.length} chars in ${elapsed}s`);
    return cleaned || `<div style="color:#cc0000;padding:12px;font-family:monospace;font-size:11px">${label.toUpperCase()} — NO CONTENT RETURNED</div>`;
  } catch (err) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const msg = err.message || String(err);
    console.error(`[${key}] ✗ ${msg} (after ${elapsed}s)`);
    return `<div style="color:#cc0000;padding:12px;font-family:monospace;font-size:11px">${label.toUpperCase()} — ${msg}</div>`;
  }
}

// ── Daily photo of the day (naval/shipping news) ────────────
// Tiny inline SVG placeholder shown when every maritime RSS feed is down,
// so the figure renders cleanly rather than a browser broken-image glyph.
const FALLBACK_PHOTO_DATA_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">` +
    `<rect width="1000" height="600" fill="#d8d2c6"/>` +
    `<g fill="#5d5b51" font-family="'Share Tech Mono',monospace">` +
    `<text x="500" y="290" font-size="32" text-anchor="middle" letter-spacing="3">PHOTO FEED UNAVAILABLE</text>` +
    `<text x="500" y="330" font-size="16" text-anchor="middle" letter-spacing="2">USNI / NAVAL NEWS / GCAPTAIN / MARITIME EXECUTIVE</text>` +
    `</g></svg>`
  );

const PHOTO_FEEDS = [
  "https://news.usni.org/feed",
  "https://www.navalnews.com/feed/",
  "https://gcaptain.com/feed/",
  "https://www.maritime-executive.com/feed",
];

// Headline feeds for the FLASH ticker. Pre-baked into the HTML at build time
// so users see headlines on first paint even when api.allorigins.win (the
// client-side CORS proxy) is unreachable. Client-side refresh in template.html
// still runs on top of these as progressive enhancement.
const TICKER_FEEDS = [
  "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
  "https://feeds.washingtonpost.com/rss/world",
  "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?max=10&ContentType=1&Site=945",
];

function fetchUrl(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? require("https") : require("http");
    const req = lib.get(url, { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0 (compatible; DailyBriefBot/1.0)" }, ...opts }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchUrl(new URL(res.headers.location, url).toString(), opts));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error(`timeout fetching ${url}`)); });
  });
}

function extractItems(rssXml) {
  const items = rssXml.match(/<item\b[\s\S]*?<\/item>/g) || [];
  const out = [];
  for (const item of items) {
    const raw = (item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
    // Same decode-then-strip ordering as extractTitles — see that function for
    // the XSS rationale.
    const decoded = raw
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'");
    const title = decoded.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const imgUrl =
      (item.match(/<media:content[^>]+url="([^"]+\.(?:jpg|jpeg|png|webp))"/i) || [])[1] ||
      (item.match(/<media:thumbnail[^>]+url="([^"]+)"/i) || [])[1] ||
      (item.match(/<enclosure[^>]+url="([^"]+\.(?:jpg|jpeg|png|webp))"/i) || [])[1] ||
      (item.match(/<img[^>]+src="([^"]+\.(?:jpg|jpeg|png|webp))/i) || [])[1] ||
      null;
    if (imgUrl) out.push({ title, imgUrl });
  }
  return out;
}

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getUTCFullYear(), 0, 0);
  const diff = now - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function extractTitles(rssXml, max) {
  const items = rssXml.match(/<item\b[\s\S]*?<\/item>|<entry\b[\s\S]*?<\/entry>/g) || [];
  const out = [];
  for (const item of items) {
    if (out.length >= max) break;
    const raw = (item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
    // Decode HTML entities FIRST, then strip tags. Reversed order would let an
    // attacker hide tags as &lt;script&gt; in a feed title — the strip pass
    // wouldn't see them, then the decode would resurrect them as live HTML.
    const decoded = raw
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'");
    const title = decoded
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (title.length >= 12 && title.length <= 180) out.push(title);
  }
  return out;
}

// Pull the top trending prediction markets from Polymarket so the ticker
// carries forward-looking market priced odds alongside the RSS headlines.
// Uses the public gamma-api (no auth). Each market becomes one ticker entry
// formatted "Polymarket: <question> — <outcome> <pct>%".
async function fetchPolymarketHeadlines(max = 3) {
  try {
    const url =
      "https://gamma-api.polymarket.com/markets?_limit=20&active=true&closed=false&order=volume24hr&ascending=false";
    const buf = await fetchUrl(url);
    const raw = JSON.parse(buf.toString("utf-8"));
    // Endpoint usually returns a bare array, but if it ever wraps in {data:[]}
    // or {results:[]} accept that too rather than silently dropping all items.
    const markets = Array.isArray(raw)
      ? raw
      : (Array.isArray(raw && raw.data) ? raw.data
      : (Array.isArray(raw && raw.results) ? raw.results : []));
    if (!markets.length) return [];

    // outcomes / outcomePrices arrive as either real arrays OR JSON-encoded
    // strings (the API is inconsistent). Handle both.
    const parseArr = (v) => {
      if (Array.isArray(v)) return v;
      if (typeof v === "string") { try { return JSON.parse(v); } catch { return []; } }
      return [];
    };
    const out = [];
    for (const m of markets) {
      if (out.length >= max) break;
      if (!m || typeof m !== "object") continue;
      const q = String(m.question || "").trim();
      if (!q || q.length < 5) continue;
      const outcomes = parseArr(m.outcomes).filter((s) => typeof s === "string" && s.length > 0);
      const prices = parseArr(m.outcomePrices);
      if (outcomes.length < 2 || prices.length < 2) continue;
      const pct = Math.round(Number(prices[0]) * 100);
      if (!Number.isFinite(pct) || pct < 1 || pct > 99) continue;
      const outcome = String(outcomes[0]).slice(0, 24);
      const trimmedQ = q.length > 90 ? q.slice(0, 87).trimEnd() + "…" : q;
      out.push(`Polymarket: ${trimmedQ} — ${outcome} ${pct}%`);
    }
    console.log(`[polymarket] ✓ ${out.length} markets`);
    return out;
  } catch (e) {
    console.log(`[polymarket] ✗ ${e.message}`);
    return [];
  }
}

async function fetchTickerHeadlines() {
  // Kick off Polymarket and every RSS feed in parallel. Total wall time is now
  // bounded by the slowest single source (~15s) rather than the sum.
  const rssPromises = TICKER_FEEDS.map(async (feedUrl) => {
    try {
      const buf = await fetchUrl(feedUrl);
      const titles = extractTitles(buf.toString("utf-8"), 3);
      console.log(`[ticker] ✓ ${titles.length} from ${new URL(feedUrl).hostname}`);
      return titles;
    } catch (e) {
      console.log(`[ticker] ✗ ${new URL(feedUrl).hostname}: ${e.message}`);
      return [];
    }
  });
  const [polyItems, ...rssBuckets] = await Promise.all([
    fetchPolymarketHeadlines(3),
    ...rssPromises,
  ]);

  // Merge: Polymarket signal first, then RSS in feed order. Cap at 8 total
  // so the marquee stays scannable.
  const headlines = [];
  const push = (t) => { if (headlines.length < 8 && !headlines.includes(t)) headlines.push(t); };
  for (const t of polyItems) push(t);
  for (const bucket of rssBuckets) for (const t of bucket) push(t);
  console.log(`[ticker] total prebaked: ${headlines.length}`);
  return headlines.join(" · ");
}

// Fetch yesterday's deployed brief so we can ask Claude what changed.
// Returns null on any failure (first deploy, network blip, etc.) so the
// build never blocks on this — the diff block just renders a graceful
// "no prior brief on file" stub.
async function fetchYesterdayBrief() {
  try {
    const buf = await fetchUrl("https://themorningbrief-ai-fork.web.app/");
    return buf.toString("utf-8");
  } catch (e) {
    console.log(`[diff] ✗ couldn't fetch yesterday: ${e.message}`);
    return null;
  }
}

// Strip an HTML doc down to readable text for Claude's diff prompt. Drops
// <script>/<style>, inlined data: URLs (base64 portrait blobs that would
// otherwise dominate the prompt), all tags, and collapses whitespace.
// Capped at 12 KB so the prompt cost stays predictable.
function stripHtmlChrome(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/data:image\/[^"]+/g, "[image]")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

// Generate the "// CHANGES SINCE LAST BRIEF" diff block. Runs in parallel
// with the other sections; uses web_search to find today's developments
// and compares against the supplied yesterday-text.
async function generateDiff(yesterdayText, dateFull) {
  if (!yesterdayText) {
    return `<ul class="diff-list"><li><strong class="diff-tag diff-tag-hold">HOLD</strong><span>No prior brief on file. Day-over-day diff resumes after the next 1000Z run.</span></li></ul>`;
  }
  const prompt = `Today is ${dateFull}. Compare yesterday's intelligence brief (below) against today's developments. Use the web_search tool to find what changed in the past 24 hours.

Output a single <ul class="diff-list"> with 3-5 <li> items capturing the MOST consequential changes. Each <li> must start with one of these <strong> tags exactly:

<strong class="diff-tag diff-tag-new">NEW</strong>     — an actor/event/program that did not exist in yesterday's brief
<strong class="diff-tag diff-tag-up">UP</strong>      — an existing situation that escalated (more force, more lethality, more tension)
<strong class="diff-tag diff-tag-down">DOWN</strong>  — an existing situation that de-escalated (ceasefire, withdrawal, agreement)
<strong class="diff-tag diff-tag-hold">HOLD</strong>  — a situation that did not change but warrants continued watch

Wrap the change text after the tag in a <span>. Append a <sup class="cite"> with 1-2 https <a href="..." title="hostname"> citation chips per <li>, using URLs returned by web_search. Output ONLY the <ul>...</ul> — no preamble, no code fences.

YESTERDAY'S BRIEF (verbatim text):
${yesterdayText}`;

  return await generateSection("diff", "Day-over-day diff", prompt);
}

async function fetchDailyPhoto() {
  // Rotate which feed is the primary source each day so the photo varies even
  // when one feed hasn't published a fresh article yet today. The other feeds
  // serve as fallbacks in their natural order.
  const offset = (dayOfYear() + 1) % PHOTO_FEEDS.length;
  const ordered = [...PHOTO_FEEDS.slice(offset), ...PHOTO_FEEDS.slice(0, offset)];
  console.log(`[photo] Today's feed order: ${ordered.map(u => new URL(u).hostname).join(" → ")}`);

  const dayIdx = dayOfYear();
  for (const feedUrl of ordered) {
    try {
      console.log(`[photo] Trying ${feedUrl}...`);
      const xmlBuf = await fetchUrl(feedUrl);
      const items = extractItems(xmlBuf.toString("utf-8"));
      if (items.length === 0) { console.log(`[photo]   no image in feed`); continue; }
      // Pick the (dayIdx % N)th item so the choice rotates daily even when the
      // feed's first article doesn't change.
      const pick = (dayIdx + 3) % items.length;
      const item = items[pick];
      console.log(`[photo]   ${items.length} items in feed, picking #${pick + 1}`);
      console.log(`[photo]   found: ${item.imgUrl}`);
      const imgBuf = await fetchUrl(item.imgUrl);
      const ext = (item.imgUrl.match(/\.(jpg|jpeg|png|webp)/i) || ["", "jpeg"])[1].toLowerCase().replace("jpg", "jpeg");
      const mime = `image/${ext}`;
      const dataUrl = `data:${mime};base64,${imgBuf.toString("base64")}`;
      const sourceHost = new URL(feedUrl).hostname.replace(/^www\./, "");
      const caption = `${item.title} — via ${sourceHost.toUpperCase()}`;
      console.log(`[photo] ✓ ${(imgBuf.length/1024).toFixed(0)} KB from ${sourceHost}`);
      return { dataUrl, caption };
    } catch (e) {
      console.log(`[photo]   ${e.message}`);
    }
  }
  console.log("[photo] ✗ all feeds failed; using fallback caption");
  return {
    dataUrl: FALLBACK_PHOTO_DATA_URL,
    caption: "Photo feed unavailable — see source feeds (USNI / Naval News / Maritime Executive) directly.",
  };
}

async function runInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function main() {
  const root = __dirname;
  const template = fs.readFileSync(path.join(root, "template.html"), "utf8");
  const { dateFull, docNumber, timestamp } = dateInfo();

  console.log(`Generating brief for ${dateFull} (${docNumber})`);

  // Fetch daily photo, ticker headlines, and yesterday's brief in parallel
  // with section generation (all four streams are independent).
  const photoPromise = fetchDailyPhoto();
  const tickerPromise = fetchTickerHeadlines();
  const yesterdayPromise = fetchYesterdayBrief().then(stripHtmlChrome);

  const keys = Object.keys(SECTIONS);
  const sectionsPromise = runInBatches(keys, 3, async (k) => ({
    key: k,
    content: await generateSection(k, SECTIONS[k].label, SECTIONS[k].prompt),
  }));

  // Kick off the day-over-day diff as soon as we have yesterday's text;
  // it runs concurrently with the rest of the section batches.
  const diffPromise = yesterdayPromise.then((yt) => generateDiff(yt, dateFull));

  const results = await sectionsPromise;

  // Sanity check: refuse to deploy if any section returned an error stub.
  // Better to keep yesterday's brief live than overwrite with red error boxes.
  const failed = results.filter((r) => /color:#cc0000.*?(?:UNAVAILABLE|NO CONTENT RETURNED|—\s+\d{3}\s|Could not resolve|timeout)/.test(r.content));
  if (failed.length > 0) {
    console.error(`\n[FATAL] ${failed.length}/${results.length} sections failed:`);
    for (const f of failed) {
      const msg = (f.content.match(/—\s+([^<]+?)<\/div>/) || ["", "(unknown)"])[1].slice(0, 120);
      console.error(`  - ${f.key}: ${msg}`);
    }
    console.error("Refusing to write public/index.html — yesterday's deploy stays live.");
    process.exit(1);
  }

  const [photo, tickerBaked, diffHtml] = await Promise.all([photoPromise, tickerPromise, diffPromise]);
  const isoDate = new Date().toISOString();
  let html = template
    .replaceAll("__DOC_NUMBER__", docNumber)
    .replaceAll("__DATE_FULL__", dateFull)
    .replaceAll("__TIMESTAMP__", timestamp)
    .replaceAll("__ISO_DATE__", isoDate)
    .replaceAll("__PHOTO_DATA_URL__", photo.dataUrl)
    .replaceAll("__PHOTO_CAPTION__", escapeHtml(photo.caption))
    .replaceAll("__BREAKING_NEWS__", escapeHtml(tickerBaked));

  // Substitute the diff block. The diff section uses the same content-marker
  // pattern as the AI sections so the smoke-test step catches a leaked marker.
  const safeDiff = scrubSection(diffHtml);
  html = html.replace(
    /<!--CONTENT_START:diff-->[\s\S]*?<!--CONTENT_END:diff-->/,
    `<!--CONTENT_START:diff-->\n${safeDiff}\n<!--CONTENT_END:diff-->`
  );

  for (const { key, content } of results) {
    const re = new RegExp(
      `<!--CONTENT_START:${key}-->[\\s\\S]*?<!--CONTENT_END:${key}-->`
    );
    const safe = scrubSection(content);
    html = html.replace(re, `<!--CONTENT_START:${key}-->\n${safe}\n<!--CONTENT_END:${key}-->`);
  }

  // Strip the CONTENT_START/END build markers from the deployable HTML — they
  // were useful as substitution anchors but leak build internals if shipped.
  html = html.replace(/<!--CONTENT_(?:START|END):[a-z0-9]+-->\n?/g, "");

  // Atomic write: write to a sibling tmp file and rename. A crash mid-write
  // can't leave a half-written index.html that firebase deploy might ship.
  const outPath = path.join(root, "public", "index.html");
  const tmpPath = outPath + ".tmp";
  fs.writeFileSync(tmpPath, html, "utf8");
  fs.renameSync(tmpPath, outPath);
  console.log(`Wrote ${outPath} (${html.length} chars)`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
