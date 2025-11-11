const express = require("express");
const rateLimit = require("express-rate-limit");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "1mb" }));

const HF_API_KEY = process.env.HF_API_KEY;
const HF_MODEL = process.env.HF_MODEL || "meta-llama/Llama-3.2-1B-Instruct";
const PORT = process.env.PORT || 3000;
const CORS_ORIGINS = process.env.CORS_ORIGINS || "*";
const EXTENSION_API_KEY = process.env.EXTENSION_API_KEY || null;

// Rate limiting (basic)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Setup CORS
const allowedOrigins = CORS_ORIGINS.split(",").map((s) => s.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      // allow non-browser requests (curl/postman) where origin is undefined
      if (!origin) return callback(null, true);
      if (CORS_ORIGINS === "*" || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS not allowed"), false);
    },
  })
);

// Optional check for extension key
app.use((req, res, next) => {
  if (!EXTENSION_API_KEY) return next();
  const key = req.headers["x-extension-key"];
  if (!key || key !== EXTENSION_API_KEY) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
});

// Helper to convert extension 'contents' to HF 'messages' (strings)
function convertContentsToMessages(contents) {
  // incoming `contents` expected format:
  // [{ role: "user"|"system"|"model", parts: [{ text: "..." }] }, ...]
  if (!Array.isArray(contents)) return null;
  return contents.map((c) => {
    const role = c.role === "user" ? "user" : c.role === "system" ? "system" : "assistant";
    const text = Array.isArray(c.parts)
      ? c.parts.map((p) => (p && p.text ? p.text : "")).join("\n")
      : "";
    return { role, content: text };
  });
}

// /api/generate - main endpoint used by extension
app.post("/api/generate", async (req, res) => {
  try {
    if (!HF_API_KEY) {
      return res.status(500).json({ error: "Server not configured with HF_API_KEY." });
    }

    const body = req.body || {};
    const { contents, model: clientModel } = body;

    // convert contents -> messages for HF router
    let messages = convertContentsToMessages(contents || []);
    if (!messages) {
      return res.status(400).json({ error: "Invalid request body: contents required." });
    }

    // allow overriding model by env or client (prefers env)
    const modelToUse = process.env.HF_MODEL || clientModel || HF_MODEL;

    const hfUrl = "https://router.huggingface.co/v1/chat/completions";
    const hfBody = {
      model: modelToUse,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 512,
    };

    const resp = await fetch(hfUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${HF_API_KEY}`,
      },
      body: JSON.stringify(hfBody),
    });

    const data = await resp.json();

    // handle HF errors
    if (!resp.ok) {
      return res.status(resp.status).json({ error: "Model error", detail: data });
    }

    // HF router returns choices[0].message.content OR choices[0].message.content[0] depending on model
    let text = "";
    if (data?.choices && data.choices.length > 0) {
      const choice = data.choices[0];
      if (choice.message) {
        // latest router returns message.content possibly as string or object structure
        // handle string or {content}
        const msg = choice.message;
        if (typeof msg.content === "string") text = msg.content;
        else if (msg.content && typeof msg.content === "object") {
          // sometimes content is { parts: [ { text: "..." } ] }
          if (Array.isArray(msg.content.parts)) {
            text = msg.content.parts.map((p) => p.text || "").join("\n");
          } else {
            text = JSON.stringify(msg.content);
          }
        } else if (msg.content === undefined && msg.text) {
          text = msg.text;
        } else {
          text = JSON.stringify(msg);
        }
      } else if (choice.text) {
        text = choice.text;
      } else {
        text = JSON.stringify(choice);
      }
    } else if (typeof data?.text === "string") {
      text = data.text;
    } else {
      text = JSON.stringify(data);
    }

    return res.json({ text });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "server_error", detail: err.message || String(err) });
  }
});

// Health
app.get("/", (req, res) => {
  res.send("Mentor backend is up.");
});

app.listen(PORT, () => {
  console.log(`Mentor backend listening on ${PORT} (model=${HF_MODEL})`);
  console.log("Available at your primary URL (Render will show it)");
});