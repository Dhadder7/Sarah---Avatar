console.log("SERVER FILE LOADED");

import express from "express";
import dotenv from "dotenv";

import { fileURLToPath } from "url";
import path from "path";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");


const app = express();
app.use(express.json());

// Serve everything inside /public at the site root
app.use(express.static(publicDir));


const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const PORT = Number(process.env.PORT || 3000);

if (!OPENAI_API_KEY) {
  console.error("❌ Missing OPENAI_API_KEY in .env");
  process.exit(1);
}

// ===== Sarah prompt (ROLE-PLAY ONLY) =====
const systemPrompt = `
You are “Sarah,” a civilian Software Engineer at the Air Force Life Cycle Management Center (AFLCMC). You are the complainant in an EEO interview scenario for DEOMI’s EOAC course.

ROLE-PLAY RULES (During Interview)
- Act as Sarah ONLY during the interview.
- Respond naturally, realistically, and emotionally when appropriate.
- Give only the information the student asks for—never volunteer extra details.
- If the student asks vague questions, provide vague answers.
- If the student asks precise questions, provide precise answers.
- Include one emotional moment.
- Include bias-baiting statements to test impartiality (e.g., “You can see how that's discrimination, right?”, "How would you feel if that happened to you, how would you handle it?", "what's goin to happen to them now?").
- If the student explains something incorrectly or unclearly, ask up to two follow-up questions for clarity. If still unclear after the second follow-up, move on and address it during the evaluation.
- The student cannot guarantee results. If they do, note it for evaluation with regulatory-based correction.


IMPORTANT:
- Do NOT provide any evaluation/feedback unless the student says exactly: End role-play

SCENARIO DETAILS
Employee: Sarah (female), software engineer
Employer: Air Force Life Cycle Management Center
Protected Class: Sex
Issues:
- Non-selection for promotion to Senior Software Engineer
- Hostile work environment due to subtle sexist comments
Alleged Offender: Male colleague named Mark
Basis: Sarah believes gender discrimination occurred
Claim: Less qualified male engineers were promoted ahead of her; ongoing sexist remarks contribute to a hostile work environment.
`.trim();

// ===== Evaluation prompt (TEXT-ONLY, ANALYTICAL) =====
const evaluationPrompt = `
You are now acting as an EEO instructor and evaluator for DEOMI EOAC.

Your task is to provide a written, text-only evaluation of the interview.

REQUIREMENTS:
- Be highly analytical and detailed
- Use structured headings
- Reference applicable regulations where appropriate (Title VII, DoDI 1350.02, DAFI 36-2710)
- Identify strengths, gaps, and missed opportunities
- Provide concrete improvement recommendations
- Do NOT role-play
- Do NOT speak conversationally
- Do NOT shorten responses for readability
- This is NOT voice output; assume the student is reading carefully

Your response MUST be in Markdown and MUST include the following sections in order:

**Evaluation of Interview Performance**

1. Mutual Trust & Rapport
2. Explanation of Process
3. Selective & Flexible Interview Techniques
4. Information Gathering
5. Interviewee Support
6. Closing Procedures

Each section MUST include:
- What the student did well
- What the student missed
- Regulatory alignment or conflict
- Specific recommendations for improvement
`.trim();

// ===== Simple in-memory transcript store (per browser session) =====
const transcripts = new Map();

function getSessionId(req) {
  const fromHeader = (req.headers["x-session-id"] || "").toString().trim();
  if (fromHeader) return fromHeader;

  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown-ip";
  const ua = req.headers["user-agent"] || "unknown-ua";
  return `${ip}::${ua}`;
}

// ===== GPT call (Chat Completions) =====
async function callGPT(activePrompt, userText, transcriptText = "") {
  const isEval = activePrompt === evaluationPrompt;

  const userContent = isEval
    ? `FULL INTERVIEW TRANSCRIPT (student + Sarah):\n${transcriptText}\n\nNOW EVALUATE THE STUDENT.`
    : userText;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: activePrompt },
        { role: "user", content: userContent }
      ],
      temperature: isEval ? 0.3 : 0.7,
      max_tokens: isEval ? 1400 : 450
    })
  });

  const raw = await resp.text();
  if (!resp.ok) throw new Error(raw);

  const data = JSON.parse(raw);
  return (data.choices?.[0]?.message?.content || "").trim();
}

// ===== API route =====
app.post("/api/sarah-chat", async (req, res) => {
  try {
    const text = ((req.body && req.body.message) || "").trim();
    console.log("📩 /api/sarah-chat:", text);

    if (!text) return res.status(400).json({ error: "Missing message" });

    const sessionId = getSessionId(req);
    if (!transcripts.has(sessionId)) transcripts.set(sessionId, []);

// Treat common speech-to-text mistakes as "End role-play"
const normalized = text
  .toLowerCase()
  .replace(/[^\w\s-]/g, " ")   // remove punctuation
  .replace(/\s+/g, " ")        // collapse spaces
  .trim();

const endRolePlay =
  /\bend\s+role-?play\b/.test(normalized) ||   // "end role play" / "end role-play"
  /\band\s+role-?play\b/.test(normalized) ||   // "and role play" (common STT error)
  /\bend\s+role\b/.test(normalized) ||         // "end role"
  /\bstop\s+role-?play\b/.test(normalized);    // "stop role play"

    const activePrompt = endRolePlay ? evaluationPrompt : systemPrompt;

    // Add student line to transcript
    transcripts.get(sessionId).push(`STUDENT: ${text}`);

    // Build transcript string (used for evaluation)
    const transcriptText = transcripts.get(sessionId).join("\n");

    // Call GPT
    const replyText = await callGPT(activePrompt, text, transcriptText);

    // Add Sarah/evaluation to transcript
    transcripts.get(sessionId).push(endRolePlay ? `EVALUATION:\n${replyText}` : `SARAH: ${replyText}`);

    // Reset transcript after evaluation (optional)
    if (endRolePlay) transcripts.set(sessionId, []);

    return res.json({ replyText, endRolePlay });
  } catch (err) {
    console.error("💥 Server error:", err?.message || err);
    return res.status(500).json({
      error: "OpenAI request failed: " + (err?.message || err)
    });
  }
});

// Root
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});


app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
