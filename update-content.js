#!/usr/bin/env node
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function dateInfo() {
  const now = new Date();
  const dateFull = now.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "America/New_York",
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
  <div class="f"><span class="fn">1.</span><span>(S) Finding text with <strong>key terms</strong> bolded.</span></div>
  <div class="f"><span class="fn">2.</span><span>(S) ...</span></div>
  <div class="kj"><div class="kjl">// KEY JUDGMENT — HIGH CONFIDENCE</div>Judgment text.</div>
</div>
Use multiple region blocks per section. Badge color classes: bc (red/critical), bh (orange/high), be (yellow/elevated), bm (blue/moderate). Begin findings with "(S)". Output ONLY the HTML region divs — no preamble, no markdown fences, no explanation.`;

const REACTION_STRUCTURE = `Use this exact HTML structure (no <style>, no <script>, no markdown fences). Output two blocks back-to-back:

FIRST: a <div class="reaction-k">// GLOBAL REACTION — MARKETS & HEADLINES</div> followed by a <div class="reaction-grid"> containing exactly 4 reaction-card divs:
<div class="reaction-card"><h4>Oil & inflation</h4><p>2-3 sentences on today's oil prices (Brent/WTI), inflation pressure, energy market.</p><span class="mini">SOURCE CUE // [PUBLISHER + DATE]</span></div>
<div class="reaction-card"><h4>Gold & dollar</h4><p>2-3 sentences on safe-haven flows, gold movement, USD strength.</p><span class="mini">SOURCE CUE // [PUBLISHER + DATE]</span></div>
<div class="reaction-card"><h4>Shipping signal</h4><p>2-3 sentences on key chokepoints, vessel disruptions, transit risk.</p><span class="mini">SOURCE CUE // [PUBLISHER + DATE]</span></div>
<div class="reaction-card reaction-wide"><h4>Executive readout</h4><p>2-3 sentence cross-cutting analytic note tying the cards together.</p><span class="mini">ANALYTIC NOTE // [ONE-LINE TAKEAWAY]</span></div>

SECOND: a <div class="headline-grid"> containing exactly 5 headline-tile divs in this order — United States, China, Russia, Iran, Europe:
<div class="headline-tile"><h5>United States</h5><p>1-2 sentences on the US perspective today.</p><span>[PUBLISHER]</span></div>
... (repeat for China, Russia, Iran, Europe)

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
const FALLBACK_PHOTO_DATA_URL = ""; // empty src → browser shows broken img placeholder; figure caption still renders.

const PHOTO_FEEDS = [
  "https://news.usni.org/feed",
  "https://www.navalnews.com/feed/",
  "https://gcaptain.com/feed/",
  "https://www.maritime-executive.com/feed",
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
    const title = (item.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || "";
    const imgUrl =
      (item.match(/<media:content[^>]+url="([^"]+\.(?:jpg|jpeg|png|webp))"/i) || [])[1] ||
      (item.match(/<media:thumbnail[^>]+url="([^"]+)"/i) || [])[1] ||
      (item.match(/<enclosure[^>]+url="([^"]+\.(?:jpg|jpeg|png|webp))"/i) || [])[1] ||
      (item.match(/<img[^>]+src="([^"]+\.(?:jpg|jpeg|png|webp))/i) || [])[1] ||
      null;
    if (imgUrl) out.push({ title: title.replace(/<[^>]+>/g, "").trim(), imgUrl });
  }
  return out;
}

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getUTCFullYear(), 0, 0);
  const diff = now - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
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

  // Fetch daily photo in parallel with section generation (independent work)
  const photoPromise = fetchDailyPhoto();

  const keys = Object.keys(SECTIONS);
  const results = await runInBatches(keys, 3, async (k) => ({
    key: k,
    content: await generateSection(k, SECTIONS[k].label, SECTIONS[k].prompt),
  }));

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

  const photo = await photoPromise;
  let html = template
    .replaceAll("__DOC_NUMBER__", docNumber)
    .replaceAll("__DATE_FULL__", dateFull)
    .replaceAll("__TIMESTAMP__", timestamp)
    .replaceAll("__PHOTO_DATA_URL__", photo.dataUrl)
    .replaceAll("__PHOTO_CAPTION__", photo.caption)
    .replaceAll("__BREAKING_NEWS__", "");

  for (const { key, content } of results) {
    const re = new RegExp(
      `<!--CONTENT_START:${key}-->[\\s\\S]*?<!--CONTENT_END:${key}-->`
    );
    html = html.replace(re, `<!--CONTENT_START:${key}-->\n${content}\n<!--CONTENT_END:${key}-->`);
  }

  const outPath = path.join(root, "public", "index.html");
  fs.writeFileSync(outPath, html, "utf8");
  console.log(`Wrote ${outPath} (${html.length} chars)`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
