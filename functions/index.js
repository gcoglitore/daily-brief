const functions = require("firebase-functions/v2");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const https = require("https");
const fs = require("fs");
const path = require("path");

admin.initializeApp();
setGlobalOptions({ maxInstances: 1 });

// Helper: call Anthropic API
async function callClaude(systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || "");
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// Generate the full briefing HTML
async function generateBrief() {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });

  const docNum = (() => {
    const d = new Date();
    return d.getFullYear().toString().slice(2) +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0") + "-001";
  })();

  const zuluTime = new Date().toISOString().slice(11, 16) + "Z";

  const SYS = `You are a senior intelligence analyst writing the Presidential Daily Brief for a former Chairman of the Joint Chiefs of Staff. Write in precise U.S. intelligence community briefing format. Use authoritative measured language with specific countries, actors, units, vessels, events. Include analytic confidence levels. Format using HTML with these CSS classes: region (div), rname (div), badge bc/bh/be/bm (span), f (div for finding), fn (span for finding number), kj (div), kjl (div). No script or style tags. Today: ${today}.`;

  const sections = {
    exec: `Write a 3-4 sentence Executive Summary for today's Presidential Daily Brief dated ${today}. Cover the most critical global security developments. Use <strong> tags for critical terms. Cover current Middle East/Iran/Hormuz situation, Ukraine war day count, Indo-Pacific PLA activity, and any other tier-1 items. Begin with (S).`,
    s1: `Write Section I: MIDDLE EAST & CENTCOM for ${today}. Cover current US-Iran war status, ceasefire situation, Strait of Hormuz, U.S. carrier strike groups in theater, Israel-Lebanon. Use region divs, rname with badges, f divs with fn spans for findings, kj div for key judgment.`,
    s2: `Write Section II: INDO-PACIFIC & INDOPACOM for ${today}. Cover China/Taiwan PLA activity, South China Sea, North Korea weapons tests and KPA anniversary watch items. Use region divs, badges, findings, key judgments.`,
    s3: `Write Section III: EUROPEAN THEATER & NATO for ${today}. Cover Russia-Ukraine war current day count and battlefield situation, NATO Arctic Sentry, Russian threat assessment. Use region divs, badges, findings, key judgments.`,
    s4: `Write Section IV: U.S. FORCE POSTURE for ${today}. Create a summary of U.S. carrier strike group dispositions and overall force posture assessment. Include DEFCON status and readiness rating. Use region divs and findings.`,
    s5: `Write Section V: CYBER & INFORMATION WARFARE for ${today}. Cover Iran cyber threats post-internet restoration, Chinese PLA cyber operations, Russian cyber activity. Use region divs, badges, findings.`,
    s6: `Write Section VI: WMD & NUCLEAR WATCH for ${today}. Cover North Korea nuclear/missile developments, Iran nuclear program status, Russia and China nuclear posture. Use region divs, badges, findings, key judgments.`,
    s7: `Write Section VII: TERRORISM for ${today}. Cover ISIS-Syria, AQAP-Yemen, ISIS-K, Africa Sahel jihadist activity. Use region divs, badges, findings.`,
    s8: `Write Section VIII: ARCTIC & HIGH NORTH for ${today}. Cover NATO Arctic Sentry, Russian Arctic buildup and warnings, Svalbard contingency, strategic resource competition. Use region divs, badges, findings, key judgment.`
  };

  // Generate all sections in parallel
  const results = {};
  await Promise.allSettled(
    Object.entries(sections).map(async ([key, prompt]) => {
      try {
        results[key] = await callClaude(SYS, prompt);
      } catch (e) {
        results[key] = `<div style="color:#cc0000;font-family:monospace;font-size:11px;padding:12px">FEED UNAVAILABLE — ${e.message}</div>`;
      }
    })
  );

  // Build the full HTML
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DAILY INTELLIGENCE BRIEF — DSB-${docNum}</title>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Share+Tech+Mono&family=Source+Serif+4:wght@400;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1510;font-family:'Source Serif 4',Georgia,serif}
.cb{background:#cc0000;color:white;text-align:center;padding:6px;font-family:'Oswald',sans-serif;font-size:12px;letter-spacing:5px;position:sticky;top:0;z-index:100}
.hdr{background:linear-gradient(135deg,#0a0e18,#1a2b4a,#0a0e18);padding:24px 32px;border-bottom:3px solid #c8a84b;display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:center}
.hm{font-family:'Share Tech Mono',monospace;font-size:10px;color:#5a7aaa;line-height:2;letter-spacing:1px}
.hm span{color:#8aaad0}.hc{text-align:center}.hr{text-align:right}
.seal{width:80px;height:80px;border:2px solid #c8a84b;border-radius:50%;margin:0 auto 10px;display:flex;align-items:center;justify-content:center;font-size:36px;background:radial-gradient(circle,#1a2b4a,#050810);box-shadow:0 0 20px rgba(200,168,75,0.3)}
.ht{font-family:'Oswald',sans-serif;color:#c8a84b;font-size:18px;letter-spacing:4px}
.hs{font-family:'Share Tech Mono',monospace;color:#3a5a8a;font-size:9px;letter-spacing:2px;margin-top:4px}
.tb{background:#0f1319;padding:8px 32px;display:flex;align-items:center;gap:24px;font-family:'Share Tech Mono',monospace;font-size:10px;border-bottom:1px solid #1a2b4a;flex-wrap:wrap}
.tl{padding:3px 10px;opacity:0.3;font-size:9px;letter-spacing:1px;border:1px solid transparent}.tl.a{opacity:1}
.tle{color:#d4a017;border-color:#d4a017!important}
.dc{margin-left:auto;display:flex;align-items:center;gap:10px;color:#4a6a9a}
.dv{background:#880000;color:white;padding:3px 12px;border:1px solid #cc0000;font-weight:bold;letter-spacing:2px}
.body{background:#f2ecd8;max-width:960px;margin:0 auto;box-shadow:0 0 40px rgba(0,0,0,0.5)}
.tsb{background:#e8dfc8;padding:6px 32px;display:flex;justify-content:space-between;font-family:'Share Tech Mono',monospace;font-size:9px;color:#6b6458;border-bottom:1px solid #c8bfa8;flex-wrap:wrap;gap:8px}
.lv{display:flex;align-items:center;gap:6px;color:#4a8c4a}
.dot{width:6px;height:6px;background:#4a8c4a;border-radius:50%;animation:blink 1.5s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.2}}
.exec{background:#1a2b4a;color:#c8d8e8;padding:24px 32px;border-bottom:3px solid #c8a84b}
.el{font-family:'Oswald',sans-serif;font-size:10px;letter-spacing:3px;color:#c8a84b;margin-bottom:10px}
.et{font-size:13px;line-height:1.8}.et strong{color:white}
.sec{border-bottom:1px solid #c8bfa8}
.sh{background:#e8dfc8;padding:10px 32px;display:flex;align-items:center;gap:12px;cursor:pointer;border-bottom:2px solid #b8afa0}
.sn{font-family:'Oswald',sans-serif;font-size:11px;color:#cc0000;letter-spacing:2px;min-width:28px}
.st{font-family:'Oswald',sans-serif;font-size:13px;letter-spacing:2px;color:#1a1510;flex:1}
.sc{font-family:'Share Tech Mono',monospace;font-size:8px;color:#cc0000;background:rgba(204,0,0,0.08);padding:2px 6px;border:1px solid rgba(204,0,0,0.2)}
.sb{padding:20px 32px;display:none}.sb.o{display:block}
.region{border-left:3px solid #1a2b4a;padding-left:16px;margin-bottom:20px}
.rn,.rname{font-family:'Oswald',sans-serif;font-size:11px;letter-spacing:2px;color:#1a2b4a;margin-bottom:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.badge,.bc,.bh,.be,.bm{font-family:'Share Tech Mono',monospace;font-size:8px;padding:2px 6px;letter-spacing:1px}
.bc{background:rgba(204,0,0,0.12);color:#cc0000;border:1px solid #cc0000}
.bh{background:rgba(220,100,30,0.12);color:#dd6622;border:1px solid #dd6622}
.be{background:rgba(212,160,23,0.12);color:#d4a017;border:1px solid #d4a017}
.bm{background:rgba(74,122,170,0.12);color:#4a7aaa;border:1px solid #4a7aaa}
.f,.finding{display:flex;gap:10px;margin-bottom:8px;font-size:12px;line-height:1.7;color:#2a2520}
.fn,.fnum{font-family:'Share Tech Mono',monospace;font-size:9px;color:#6b6458;min-width:22px;padding-top:2px}
.kj,.key-judgment{background:rgba(26,43,74,0.06);border:1px solid rgba(26,43,74,0.2);border-left:4px solid #1a2b4a;padding:12px 16px;margin-bottom:10px;font-size:12px;line-height:1.7}
.kjl,.kj-label{font-family:'Oswald',sans-serif;font-size:9px;letter-spacing:2px;color:#1a2b4a;margin-bottom:4px}
.ft{background:#e8dfc8;padding:16px 32px;display:flex;justify-content:space-between;border-top:2px solid #b8afa0;font-family:'Share Tech Mono',monospace;font-size:9px;color:#6b6458}
</style>
</head>
<body>
<div class="cb">⬛ TOP SECRET / SCI — NOFORN — AUTHORIZED RECIPIENTS ONLY ⬛</div>
<div class="hdr">
  <div class="hm">DOCUMENT: <span>DSB-${docNum}</span><br>DATE: <span>${today.toUpperCase()}</span><br>TIME: <span>${zuluTime}</span> ZULU<br>PREPARED BY: <span>IC FUSION CENTER</span><br>CLASSIFICATION: <span>TS/SCI // NOFORN</span></div>
  <div class="hc"><div class="seal">🦅</div><div class="ht">Daily Intelligence Brief</div><div class="hs">OFFICE OF THE DIRECTOR OF NATIONAL INTELLIGENCE</div></div>
  <div class="hm hr">RECIPIENT: <span>AUTHORIZED PRINCIPALS</span><br>DISTRIBUTION: <span>EYES ONLY</span><br>COPY: <span>001 OF 001</span><br>HANDLE VIA: <span>SPECIAL CHANNELS</span><br>DESTROY: <span>AFTER REVIEW</span></div>
</div>
<div class="tb">
  <span style="color:#4a6a9a;letter-spacing:2px">NATIONAL THREAT LEVEL:</span>
  <div style="display:flex;gap:4px">
    <div class="tl" style="color:#4a9a4a">LOW</div>
    <div class="tl" style="color:#4a7aaa">GUARDED</div>
    <div class="tl tle a">ELEVATED</div>
    <div class="tl" style="color:#dd6622">HIGH</div>
    <div class="tl" style="color:#cc0000">SEVERE</div>
  </div>
  <div class="dc"><span>DEFCON:</span><span class="dv">3</span><span style="margin-left:16px">FPCON: ALPHA</span></div>
</div>
<div class="body">
  <div class="tsb">
    <span>DSB DAILY INTELLIGENCE BRIEF // ${today.toUpperCase()}</span>
    <div class="lv"><div class="dot"></div>GENERATED ${zuluTime} — AUTO-UPDATED DAILY 0500 PST</div>
    <span>SOURCE: OSINT FUSION // DNI // ISW // USNI // CSIS</span>
  </div>
  <div class="exec"><div class="el">// EXECUTIVE SUMMARY — LEAD ITEMS</div><div class="et">${results.exec || ""}</div></div>
  <div class="sec"><div class="sh" onclick="tog('s1')"><span class="sn">I.</span><span class="st">Middle East &amp; CENTCOM Theater</span><span class="sc">TS/SCI</span><span id="a1" style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#6b6458">▼</span></div><div class="sb o" id="s1">${results.s1 || ""}</div></div>
  <div class="sec"><div class="sh" onclick="tog('s2')"><span class="sn">II.</span><span class="st">Indo-Pacific &amp; INDOPACOM Theater</span><span class="sc">TS/SCI</span><span id="a2" style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#6b6458">▼</span></div><div class="sb o" id="s2">${results.s2 || ""}</div></div>
  <div class="sec"><div class="sh" onclick="tog('s3')"><span class="sn">III.</span><span class="st">European Theater &amp; NATO</span><span class="sc">TS/SCI</span><span id="a3" style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#6b6458">▼</span></div><div class="sb o" id="s3">${results.s3 || ""}</div></div>
  <div class="sec"><div class="sh" onclick="tog('s4')"><span class="sn">IV.</span><span class="st">U.S. Force Posture &amp; Naval Disposition</span><span class="sc">TS/SCI</span><span id="a4" style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#6b6458">▼</span></div><div class="sb o" id="s4">${results.s4 || ""}</div></div>
  <div class="sec"><div class="sh" onclick="tog('s5')"><span class="sn">V.</span><span class="st">Cyber &amp; Information Warfare</span><span class="sc">TS/SCI</span><span id="a5" style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#6b6458">▼</span></div><div class="sb" id="s5">${results.s5 || ""}</div></div>
  <div class="sec"><div class="sh" onclick="tog('s6')"><span class="sn">VI.</span><span class="st">WMD, Strategic &amp; Nuclear Watch</span><span class="sc">TS/SCI // SIGMA</span><span id="a6" style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#6b6458">▼</span></div><div class="sb" id="s6">${results.s6 || ""}</div></div>
  <div class="sec"><div class="sh" onclick="tog('s7')"><span class="sn">VII.</span><span class="st">Terrorism &amp; Transnational Threats</span><span class="sc">TS/SCI</span><span id="a7" style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#6b6458">▼</span></div><div class="sb" id="s7">${results.s7 || ""}</div></div>
  <div class="sec"><div class="sh" onclick="tog('s8')"><span class="sn">VIII.</span><span class="st">Arctic &amp; High North Operations</span><span class="sc">TS/SCI</span><span id="a8" style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#6b6458">▼</span></div><div class="sb" id="s8">${results.s8 || ""}</div></div>
  <div class="ft">
    <div>DOCUMENT: DSB-${docNum} // DATE: ${today.toUpperCase()}<br><span style="font-size:8px;color:#9a9080">AUTO-GENERATED // SOURCES: OSINT FUSION // DNI ATA 2026 // ISW // USNI // CSIS // CFR // DEFENSE ONE // NATO // ODNI</span></div>
    <div style="text-align:right">PAGE: 001<br><span style="color:#cc0000">TOP SECRET / SCI — NOFORN</span></div>
  </div>
</div>
<script>
function tog(id){const b=document.getElementById(id),a=document.getElementById("a"+id.slice(1)),o=b.classList.contains("o");b.classList.toggle("o",!o);b.style.display=o?"none":"block";if(a)a.style.transform=o?"":"rotate(180deg)";}
["s1","s2","s3","s4"].forEach(id=>{const b=document.getElementById(id);if(b){b.style.display="block";b.classList.add("o");}});
["s5","s6","s7","s8"].forEach(id=>{const b=document.getElementById(id);if(b)b.style.display="none";});
</script>
</body>
</html>`;

  return html;
}

// Scheduled function — runs every day at 5:00 AM Pacific
exports.dailyBriefUpdate = onSchedule({
  schedule: "0 5 * * *",
  timeZone: "America/Los_Angeles",
  secrets: ["ANTHROPIC_API_KEY"]
}, async (event) => {
  console.log("Generating daily intelligence brief...");
  const html = await generateBrief();
  
  // Save to Firebase Storage as the new index.html
  const bucket = admin.storage().bucket();
  const file = bucket.file("public/index.html");
  await file.save(html, {
    metadata: { contentType: "text/html", cacheControl: "no-cache" }
  });
  
  // Also save to Realtime Database as backup
  await admin.database().ref("briefs/" + new Date().toISOString().slice(0, 10)).set({
    generated: new Date().toISOString(),
    html: html.slice(0, 500) + "..." // Store summary only
  });
  
  console.log("Daily brief generated and deployed successfully.");
});
