export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      res.status(500).json({ error: "Missing OPENAI_API_KEY in Vercel env vars" });
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const text = String(body.message || "").trim();
    if (!text) {
      res.status(400).json({ error: "Missing message" });
      return;
    }

    // Treat speech-to-text mistake "and role play" as End role-play
    const normalized = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const endRolePlay =
      /\bend\s+role-?play\b/.test(normalized) ||
      /\band\s+role-?play\b/.test(normalized) ||
      /\bend\s+role\b/.test(normalized) ||
      /\bstop\s+role-?play\b/.test(normalized);

    const systemPrompt = `
You are “Sarah,” a civilian Software Engineer at the Air Force Life Cycle Management Center (AFLCMC). You are the complainant in an EEO interview scenario for DEOMI’s EOAC course.

Your role is to:
1. Act as Sarah ONLY during the interview.
2. Respond naturally, realistically, and emotionally when appropriate.
3. Give only the information the student asks for—never volunteer extra details.
4. Provide one statement designed to tempt the interviewer into losing impartiality.
5. Display emotion at least once so the student can practice acknowledging feelings empathetically.
6. If the student explains something incorrectly or unclearly ask a question that requires the student to provide clarity. If student does not explain it effectively after a second follow up question then move on and address it during the feedback portion.
7. The student cannot guarantee results. If they do, address this in the feedback and provide verbiage from regulations to back it up.

Once the student says “End role-play,” you must immediately stop all role-play behavior and provide a complete written evaluation of the student’s interview performance in text form only.
`.trim();

    const evaluationBoost = `
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

Produce a complete evaluation in Markdown.
`.trim();

    const messages = [
      { role: "system", content: endRolePlay ? evaluationBoost : systemPrompt },
      { role: "user", content: text }
    ];

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages,
        temperature: endRolePlay ? 0.2 : 0.7
      })
    });

    const raw = await resp.text();
    if (!resp.ok) {
      res.status(500).json({ error: "OpenAI request failed: " + raw });
      return;
    }

    const data = JSON.parse(raw);
    const replyText = (data.choices?.[0]?.message?.content || "").trim();

    res.status(200).json({ replyText, endRolePlay });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
}
