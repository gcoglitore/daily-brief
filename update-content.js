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
    prompt: `Today is ${dateFull}. Search the web for today's most critical global security developments and write a 4-5 sentence Executive Summary covering: any active US-Iran/Middle East situation; current Russia-Ukraine war status (include Day count if you can compute it from Feb 24, 2022 start); any major Indo-Pacific or PLA activity; any other tier-1 items. Use <strong> tags around critical terms (specific countries, vessels, percentages, day counts, named officials). Wrap the entire summary in a single <p> tag. Begin with "(S)". Output ONLY the <p>...</p> HTML — no markdown fences, no preamble.`,
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
    prompt: `Today is ${dateFull}. Search the web for current European/NATO developments. Cover: Russia-Ukraine war (include current day count from Feb 24, 2022), NATO Arctic activity, Russian threats to Baltic states, European defense initiatives. ${STRUCTURE_REMINDER}`,
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

async function generateSection(key, label, prompt) {
  const start = Date.now();
  console.log(`[${key}] Generating ${label}...`);
  try {
    const response = await client.messages.create(
      {
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
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

    const cleaned = text
      .replace(/^```(?:html)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

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

  const keys = Object.keys(SECTIONS);
  const results = await runInBatches(keys, 3, async (k) => ({
    key: k,
    content: await generateSection(k, SECTIONS[k].label, SECTIONS[k].prompt),
  }));

  let html = template
    .replaceAll("__DOC_NUMBER__", docNumber)
    .replaceAll("__DATE_FULL__", dateFull)
    .replaceAll("__TIMESTAMP__", timestamp);

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
