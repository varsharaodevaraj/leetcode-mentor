// server.js (updated to use Hugging Face Router / Inference Providers chat endpoint)
require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(helmet());
app.use(express.json({ limit: '300kb' }));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false
}));

const allowedOrigins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const HF_API_KEY = process.env.HF_API_KEY;
let HF_MODEL = process.env.HF_MODEL || 'gpt2'; // you can change this to an Inference-available chat model
const PORT = process.env.PORT || 3000;

if (!HF_API_KEY) {
  console.warn('Warning: HF_API_KEY not set. Set it in .env before using the backend.');
}

// System message enforced server-side
const SYSTEM_PROMPT = `SYSTEM: You are an expert LeetCode programming mentor. Only answer questions related to the provided LeetCode problem. If the user asks unrelated general knowledge or news questions, refuse and ask them to focus on the problem. Provide hints and guiding questions, but do NOT provide full working code solutions.`;

// Basic off-topic heuristic (keeps user on-problem)
function isLikelyOffTopic(text) {
  if (!text) return false;
  const off = ['capital', 'what is happening', 'news', 'who is', 'weather', 'president', 'country', 'india', 'britain', 'france'];
  const s = text.toLowerCase();
  return off.some(k => s.includes(k));
}

/**
 * Call Hugging Face Router chat completions endpoint.
 * Uses the OpenAI-compatible `/v1/chat/completions` interface.
 */
async function callRouterChat(messages, model) {
  const url = 'https://router.huggingface.co/v1/chat/completions';
  const body = {
    model,
    messages,
    max_tokens: 300,
    temperature: 0.2,
    stream: false
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${HF_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
  });
  return resp;
}

app.post('/api/generate', async (req, res) => {
  try {
    const { contents } = req.body;
    if (!contents) return res.status(400).json({ error: 'Missing contents' });

    // Build last user quick-check for off-topic heuristic
    const lastUser = [...contents].reverse().find(m => m.role === 'user');
    const lastText = lastUser ? lastUser.parts.map(p => p.text).join('\n') : '';

    if (isLikelyOffTopic(lastText)) {
      return res.json({
        text: "I can't help with general knowledge or news. I'm an on-problem coding mentor — please ask about the current LeetCode problem."
      });
    }

    // Convert contents -> OpenAI-style messages array
    // Start with server-side system prompt to ensure enforcement
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

    // Append the provided contents, mapping roles:
    // 'system' -> system, 'user' -> user, 'model' or 'assistant' -> assistant
    for (const item of contents) {
      const text = (item.parts || []).map(p => p.text).join('\n');
      if (!text || text.trim() === '') continue;
      const roleLower = (item.role || '').toLowerCase();
      if (roleLower === 'system') messages.push({ role: 'system', content: text });
      else if (roleLower === 'user') messages.push({ role: 'user', content: text });
      else if (roleLower === 'model' || roleLower === 'assistant' || roleLower === 'ai') messages.push({ role: 'assistant', content: text });
      else messages.push({ role: 'user', content: text });
    }

    if (!HF_API_KEY) {
      return res.json({ text: 'Server not configured with HF_API_KEY. Please set it in environment.' });
    }

    // Try to call the configured model via router (chat completions)
    let resp = await callRouterChat(messages, HF_MODEL);

    // If model is gated/unavailable, the router may return 400/404/410 etc.
    // For dev convenience, fallback to 'gpt2' hosted via router if available.
    if (!resp.ok && resp.status === 410) {
      console.warn(`Model ${HF_MODEL} returned 410; retrying with 'gpt2' as fallback`);
      HF_MODEL = 'gpt2';
      resp = await callRouterChat(messages, HF_MODEL);
    }

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error('Router HF error', resp.status, errorText);
      return res.status(502).json({ error: `Model error ${resp.status}`, detail: errorText });
    }

    const j = await resp.json();

    // Router returns OpenAI-compatible response; extract assistant content
    // Try common shapes: choices[0].message.content, choices[0].message, or completion.choices[0].message
    let assistantText = '';
    try {
      if (j.choices && Array.isArray(j.choices) && j.choices.length > 0) {
        const first = j.choices[0];
        if (first.message && (first.message.content || first.message)) {
          assistantText = typeof first.message.content === 'string' ? first.message.content : (first.message.content?.value || JSON.stringify(first.message));
        } else if (first.text) {
          assistantText = first.text;
        } else {
          assistantText = JSON.stringify(first);
        }
      } else if (j.error) {
        assistantText = `Model error: ${j.error}`;
      } else {
        assistantText = JSON.stringify(j);
      }
    } catch (e) {
      assistantText = JSON.stringify(j);
    }

    return res.json({ text: assistantText || 'Model returned no text.' });
  } catch (err) {
    console.error('Server error', err);
    return res.status(500).json({ error: 'internal server error' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, model: HF_MODEL }));
app.listen(PORT, () => console.log(`Mentor backend listening on ${PORT} (model=${HF_MODEL})`));