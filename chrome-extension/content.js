// content.js - LeetCode AI Mentor (proxy mode)
// Full file with improved renderReviewList(), problem normalization, and single-arrow fix.

// -------- CONFIG --------
const BACKEND_URL = "https://mentor-backend-drv0.onrender.com/api/generate"; 
const RECOMMENDATION_THRESHOLD = 3; // number of *helpful* backend interactions before requesting recommendations

// -------- Global state --------
let chatHistory = [];
let messageCounter = 0;
let currentProblemURL = window.location.href;
let isLoading = false;
let uiInitialized = false;

console.log("LeetCode AI Mentor: content.js active (proxy mode).");

// -------- inject runtime CSS (remove extra arrow and style the chevron) --------
function injectStyles() {
  const css = `
    /* Remove any theme pseudo-element arrow on review-topic-header so only our chevron shows */
    .review-topic-header::after { content: none !important; }

    /* Style the chevron we inject */
    .review-topic-chevron {
      display: inline-block;
      margin-left: 8px;
      font-size: 14px;
      color: #9b59ff; /* purple */
      transition: transform 0.18s ease;
    }
    .review-topic-header.active .review-topic-chevron {
      transform: rotate(180deg);
    }

    /* small layout niceties */
    .review-topic-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
    }
    .review-topic-header .review-topic-chevron {
      margin-left: 12px;
    }

    /* ensure review list items look consistent */
    .review-list-container { padding: 8px 12px; }
    .review-topic-container { margin-bottom: 12px; }
    .review-problem-list { padding: 0; margin: 8px 0 0 0; list-style: none; overflow: hidden; transition: max-height 0.2s ease; }
    .review-problem-row { display: flex; justify-content: space-between; padding: 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.03); }
    .review-problem-left { flex: 1; }
    .review-problem-right { margin-left: 10px; display:flex; align-items:center; }
    .mark-done-btn { background: transparent; border: 1px solid #2ecc71; color: #2ecc71; padding: 6px 10px; border-radius: 18px; cursor: pointer; }
    .review-problem-link { color: #9fb0ff; text-decoration: none; }
    .review-problem-text { color: #ccc; }
  `;
  const style = document.createElement("style");
  style.setAttribute("data-injected-by", "ai-mentor-content");
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
}
// inject styles immediately
injectStyles();

// -------- Storage helpers --------
const SessionStorage = {
  get: (keys) => new Promise((resolve) => chrome.storage.session.get(keys, (r) => resolve(r))),
  set: (obj) => new Promise((resolve) => chrome.storage.session.set(obj, resolve)),
};
const LocalStorage = {
  get: (keys) => new Promise((resolve) => chrome.storage.local.get(keys, (r) => resolve(r))),
  set: (obj) => new Promise((resolve) => chrome.storage.local.set(obj, resolve)),
};

// -------- persistence helpers: solved & review list --------
async function saveSolvedProblem(problemTitle, topic) {
  let { solvedProblems } = await LocalStorage.get("solvedProblems");
  solvedProblems = solvedProblems || [];
  if (problemTitle && topic && !solvedProblems.some((p) => p.title === problemTitle)) {
    solvedProblems.push({ title: problemTitle, topic: topic.trim() });
    await LocalStorage.set({ solvedProblems });
  }
}

async function saveReviewItems(concept, problems, sourceProblem) {
  let { reviewList } = await LocalStorage.get("reviewList");
  reviewList = reviewList || [];
  if (typeof reviewList === "object" && !Array.isArray(reviewList)) reviewList = [];
  const newEntry = { concept, source: sourceProblem, problems };
  const isDuplicate = reviewList.some(
    (item) => item.source === newEntry.source && item.concept === newEntry.concept
  );
  if (!isDuplicate) {
    reviewList.push(newEntry);
    await LocalStorage.set({ reviewList });
    await setNotificationStatus(true);
  }
}
async function setNotificationStatus(hasNotification) {
  await LocalStorage.set({ hasNotification });
  updateNotificationDot();
}
async function updateNotificationDot() {
  const { reviewList } = await LocalStorage.get("reviewList");
  const mentorButton = document.getElementById("ai-mentor-btn");
  const icon = mentorButton ? mentorButton.querySelector(".button-icon") : null;
  if (!icon) return;
  let count = 0;
  if (reviewList) {
    const uniqueProblems = new Set();
    reviewList.forEach((item) => item.problems.forEach((p) => {
      const np = normalizeProblemObject(p);
      if (np && np.url) uniqueProblems.add(np.url);
      else if (np && np.title) uniqueProblems.add(`title:${np.title}`);
    }));
    count = uniqueProblems.size;
  }
  if (count > 0) {
    mentorButton.classList.add("has-notification");
    icon.setAttribute("data-notification-count", count);
  } else {
    mentorButton.classList.remove("has-notification");
    icon.removeAttribute("data-notification-count");
  }
}

// -------- Chat history keyed per problem --------
function getProblemKeyFromURL(url) {
  const match = url.match(/leetcode\.com\/problems\/([^/]+)/);
  return match ? `chatHistory_${match[1]}` : null;
}
async function saveChatHistory() {
  const problemKey = getProblemKeyFromURL(window.location.href);
  if (problemKey) await LocalStorage.set({ [problemKey]: chatHistory });
}
async function loadChatHistory() {
  const problemKey = getProblemKeyFromURL(window.location.href);
  if (problemKey) {
    const { [problemKey]: savedHistory } = await LocalStorage.get(problemKey);
    chatHistory = savedHistory || [];
    const messagesContainer = document.getElementById("ai-chat-messages");
    if (messagesContainer) {
      messagesContainer.innerHTML = "";
      chatHistory.forEach((message) => {
        const sender = message.role === "user" ? "user" : "ai";
        addMessageToChat(sender, message.parts[0].text);
      });
    }
  }
}

// -------- Problem context extraction --------
function getProblemContext() {
  const titleSelectors = [
    'div[data-cy="question-title"]',
    ".mr-2.text-label-1",
    ".text-title-large a",
  ];
  let problemTitle = "Title not found";
  for (const selector of titleSelectors) {
    const titleEl = document.querySelector(selector);
    if (titleEl && titleEl.innerText) {
      problemTitle = titleEl.innerText.replace(/^\d+\.\s*/, "").trim();
      break;
    }
  }
  const descriptionSelector = 'div[data-track-load="description_content"]';
  const descriptionEl = document.querySelector(descriptionSelector);
  let userCode = getCodeFromMonacoEditor();
  return {
    problemTitle,
    problemDescription: descriptionEl ? descriptionEl.innerHTML : "Description not found",
    userCode,
  };
}

function getCodeFromMonacoEditor() {
  try {
    if (window.monaco && window.monaco.editor) {
      const models = window.monaco.editor.getModels?.();
      if (models && models.length > 0) {
        const code = models[0].getValue();
        if (code && code.trim()) return code;
      }
      const editors = window.monaco.editor.getEditors?.();
      if (editors && editors.length) {
        for (const editor of editors) {
          if (editor && typeof editor.getValue === "function") {
            const code = editor.getValue();
            if (code && code.trim()) return code;
          }
        }
      }
    }
    const codeLines = document.querySelectorAll(".view-line");
    if (codeLines.length > 0) {
      const codeArray = Array.from(codeLines).map((line) => line.innerText);
      const code = codeArray.join("\n");
      if (code && code.trim()) return code;
    }
    return "Could not read code from editor.";
  } catch (error) {
    console.error("Error reading code from editor:", error);
    return "Could not read code from editor.";
  }
}

// -------- UI: render messages --------
function addMessageToChat(sender, message, isLoading = false) {
  const messagesContainer = document.getElementById("ai-chat-messages");
  if (!messagesContainer) return null;
  const messageDiv = document.createElement("div");
  messageDiv.classList.add("ai-chat-message", sender === "user" ? "user-message" : "ai-message");
  if (isLoading) {
    messageDiv.classList.add("loading");
    messageDiv.textContent = "Thinking...";
  } else {
    let sanitizedMessage = String(message || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    sanitizedMessage = sanitizedMessage.replace(
      /```(java|javascript|python|c\+\+|c#|kotlin|swift)?\s*([\s\S]*?)```/g,
      "<pre><code>$2</code></pre>"
    );
    sanitizedMessage = sanitizedMessage.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    sanitizedMessage = sanitizedMessage.replace(/\*(.*?)\*/g, "<em>$1</em>");
    sanitizedMessage = sanitizedMessage.replace(/^\s*\*\s+(.*)/gm, "<ul><li>$1</li></ul>");
    sanitizedMessage = sanitizedMessage.replace(/<\/ul>\s*<ul>/g, "");
    const parts = sanitizedMessage.split(/(<pre>[\s\S]*?<\/pre>)/);
    const formattedParts = parts.map((part) => {
      if (part.startsWith("<pre>")) return part;
      return part.replace(/\n/g, "<br>");
    });
    messageDiv.innerHTML = formattedParts.join("");
  }
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return messageDiv;
}

// -------- Normalize problems utilities (robust) --------
function normalizeProblemObject(p) {
  // Accepts various shapes: { title, url }, { name, link }, simple strings, or partial objects.
  if (!p) return null;
  let title = "";
  let url = "";

  if (typeof p === "string") {
    title = p.trim();
  } else if (typeof p === "object") {
    title = p.title || p.name || p.label || p.text || "";
    url = p.url || p.link || p.href || "";
    // sometimes model returns nested structure
    if (!title && p.problemTitle) title = p.problemTitle;
  }

  // If url is present but relative path (e.g., /problems/two-sum/), convert to full
  if (url && url.startsWith("/")) {
    url = `https://leetcode.com${url}`;
  }

  // If url missing but title present, create a best-effort LeetCode problems URL
  if (!url && title) {
    // create slug from title
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    url = `https://leetcode.com/problems/${encodeURIComponent(slug)}/`;
  }

  // If title missing but url present, infer title from URL slug
  if (!title && url) {
    const m = url.match(/\/problems\/([^/]+)/);
    if (m && m[1]) {
      const inferred = decodeURIComponent(m[1]).replace(/-/g, " ");
      title = inferred.replace(/\b\w/g, (c) => c.toUpperCase());
    } else {
      title = url;
    }
  }

  title = String(title || "").trim();
  url = String(url || "").trim();

  if (!title && !url) return null;
  return { title, url };
}

// -------- Render review list UI (FIXED & robust) --------
async function renderReviewList() {
  const panel = document.getElementById("ai-review-list-panel");
  if (!panel) return;
  const { reviewList } = await LocalStorage.get("reviewList");
  if (!reviewList || reviewList.length === 0) {
    panel.innerHTML = '<p style="padding: 15px;">Your review list is empty.</p>';
    updateNotificationDot();
    return;
  }

  // Build topics => normalized, deduped problem lists
  const topics = {};
  for (const item of reviewList) {
    const concept = item.concept || "Misc";
    if (!topics[concept]) topics[concept] = [];
    const problems = Array.isArray(item.problems) ? item.problems : [];
    for (const rawProb of problems) {
      const np = normalizeProblemObject(rawProb);
      if (!np) continue;
      // avoid duplicates by URL in that concept
      if (!topics[concept].some((p) => p.url === np.url)) topics[concept].push(np);
    }
  }

  // Produce HTML using DOM creation for safety (avoid raw concatenation)
  const container = document.createElement("div");
  container.className = "review-list-container";
  for (const topic of Object.keys(topics)) {
    const problems = topics[topic];
    // Skip empty topics
    if (!problems || problems.length === 0) continue;

    const topicContainer = document.createElement("div");
    topicContainer.className = "review-topic-container";

    const header = document.createElement("div");
    header.className = "review-topic-header";
    header.dataset.topic = topic;
    header.textContent = topic;

    // chevron / indicator (only one - CSS removed pseudo)
    const chevron = document.createElement("span");
    chevron.className = "review-topic-chevron";
    chevron.textContent = "▴";
    header.appendChild(chevron);

    const list = document.createElement("ul");
    list.className = "review-problem-list";
    list.dataset.topicList = topic;
    list.style.maxHeight = "0px"; // start collapsed

    for (const prob of problems) {
      const li = document.createElement("li");
      li.dataset.url = prob.url;

      const left = document.createElement("div");
      left.className = "review-problem-left";

      if (prob.url) {
        const a = document.createElement("a");
        a.href = prob.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = prob.title || prob.url;
        a.className = "review-problem-link";
        left.appendChild(a);
      } else {
        const span = document.createElement("span");
        span.className = "review-problem-text";
        span.textContent = prob.title || "Untitled problem";
        left.appendChild(span);
      }

      const btn = document.createElement("button");
      btn.className = "mark-done-btn";
      btn.dataset.url = prob.url;
      btn.dataset.title = prob.title;
      btn.dataset.concept = topic;
      btn.textContent = "Mark as Done";

      const right = document.createElement("div");
      right.className = "review-problem-right";
      right.appendChild(btn);

      li.appendChild(left);
      li.appendChild(right);
      list.appendChild(li);
    }

    topicContainer.appendChild(header);
    topicContainer.appendChild(list);
    container.appendChild(topicContainer);
  }

  panel.innerHTML = ""; // wipe existing
  panel.appendChild(container);
  updateNotificationDot();

  // Attach handlers
  panel.querySelectorAll(".review-topic-header").forEach((header) => {
    header.addEventListener("click", () => {
      header.classList.toggle("active");
      const problemList = panel.querySelector(`[data-topic-list="${header.dataset.topic}"]`);
      if (!problemList) return;
      if (problemList.style.maxHeight && problemList.style.maxHeight !== "0px") {
        problemList.style.maxHeight = "0px";
      } else {
        problemList.style.maxHeight = problemList.scrollHeight + "px";
      }
    });
  });

  panel.querySelectorAll(".mark-done-btn").forEach((button) => {
    button.addEventListener("click", async (e) => {
      e.stopPropagation();
      const { url: urlToRemove, title, concept } = e.target.dataset;
      await saveSolvedProblem(title, concept);
      let { reviewList } = await LocalStorage.get("reviewList");
      reviewList = reviewList || [];
      let updatedReviewList = [];
      reviewList.forEach((item) => {
        item.problems = (item.problems || []).filter((p) => {
          const np = normalizeProblemObject(p);
          return !(np && np.url === urlToRemove);
        });
        if (item.problems.length > 0) updatedReviewList.push(item);
      });
      await LocalStorage.set({ reviewList: updatedReviewList });
      renderReviewList();
      updateNotificationDot();
    });
  });
}

// -------- call backend (proxy) --------
async function callBackend(requestBody) {
  const resp = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Backend error ${resp.status}: ${txt}`);
  }
  const data = await resp.json();
  // server expects to return { text: "..." } or similar
  return data.text || data;
}

// -------- utilities: robust JSON extraction for recommendations --------
function extractJSONFromText(text) {
  if (!text || typeof text !== "string") return null;
  const jsonArrayMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonArrayMatch) return null;
  try {
    const parsed = JSON.parse(jsonArrayMatch[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    try {
      const cleaned = jsonArrayMatch[0].replace(/,\s*]/g, "]");
      const parsed2 = JSON.parse(cleaned);
      return Array.isArray(parsed2) ? parsed2 : null;
    } catch (err2) {
      return null;
    }
  }
}

// -------- recommendations and topic inference --------
async function getRecommendations(problemTitle) {
  if (problemTitle === "Title not found") return;
  try {
    addMessageToChat("ai", "Analyzing problem for related topics...", true);
    const concept = await getTopicForProblem(problemTitle);
    const recommendationPrompt = `List 2-3 classic LeetCode problems for practicing "${concept.trim()}", excluding "${problemTitle}". Provide response as a valid JSON array of objects with "title" and "url" keys. Respond with ONLY the JSON array.`;
    const recoResponse = await callBackend({ contents: [{ parts: [{ text: recommendationPrompt }] }] });

    let recommendations = null;
    if (typeof recoResponse === "string") {
      recommendations = extractJSONFromText(recoResponse);
    } else if (Array.isArray(recoResponse)) {
      recommendations = recoResponse;
    }

    if (!recommendations) {
      recommendations = [];
      if (typeof recoResponse === "string") {
        const lines = recoResponse.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          const urlMatch = line.match(/(https?:\/\/[^\s)]+)/);
          const titleCandidate = line.replace(urlMatch ? urlMatch[0] : "", "").replace(/^[\d\.\)\-]+\s*/, "").trim();
          if (urlMatch) {
            recommendations.push({ title: titleCandidate || urlMatch[0], url: urlMatch[0] });
          }
        }
      }
    }

    if (!Array.isArray(recommendations) || recommendations.length === 0) {
      const loadingMessage = document.querySelector(".ai-message.loading");
      if (loadingMessage) loadingMessage.remove();
      addMessageToChat("ai", "I couldn't generate practice recommendations this time — try again later.");
      return;
    }

    // Normalize each recommended problem to reduce downstream rendering issues
    const normalized = recommendations.map((r) => normalizeProblemObject(r)).filter(Boolean);

    await saveReviewItems(concept.trim(), normalized, problemTitle);
    const loadingMessage = document.querySelector(".ai-message.loading");
    if (loadingMessage) loadingMessage.remove();
    addMessageToChat("ai", `Saved ${normalized.length} recommended problems for review.`);
  } catch (error) {
    console.error("Failed to get recommendations:", error);
    const loadingMessage = document.querySelector(".ai-message.loading");
    if (loadingMessage) loadingMessage.remove();
    addMessageToChat("ai", "I couldn't generate practice recommendations this time — no worries, we can continue.");
  } finally {
    const loadingMessage = document.querySelector(".ai-message.loading");
    if (loadingMessage) loadingMessage.remove();
  }
}

// -------- get topic for problem (via backend) --------
async function getTopicForProblem(problemTitle) {
  let { topicCache } = await LocalStorage.get("topicCache");
  topicCache = topicCache || {};
  if (topicCache[problemTitle]) {
    return topicCache[problemTitle];
  }
  const topicPrompt = `Based on the LeetCode problem title "${problemTitle}", what is the single most important data structure or algorithmic concept required? Respond with ONLY the name of the concept.`;
  const topic = await callBackend({ contents: [{ parts: [{ text: topicPrompt }] }] });
  const cleanTopic = (typeof topic === "string") ? topic.trim() : String(topic);
  topicCache[problemTitle] = cleanTopic;
  await LocalStorage.set({ topicCache });
  return cleanTopic;
}

// -------- detect general-knowledge / off-topic requests --------
function isOffTopicQuery(query) {
  if (!query || typeof query !== "string") return false;
  const offTopicPatterns = /\b(capital of|what is happening|what's happening|who is|who's|news|today|current|weather|time in|date in|president|prime minister|capital|population|currency|latest|breaking)\b/i;
  return offTopicPatterns.test(query);
}

// -------- helper patterns for local handling (greeting) --------
function greetingOnly(q) {
  if (!q) return false;
  return /^\s*(hi|hello|hey|hiya|good morning|good afternoon|good evening|howdy)[.!?]?\s*$/i.test(q);
}

// -------- Determine if a user query is a "helpful" request (should increment messageCounter) --------
function isHelpfulQuery(q) {
  if (!q || typeof q !== "string") return false;
  const s = q.toLowerCase();

  const helpfulKeywords = [
    "hint", "help", "explain", "explanation", "approach", "solution", "walkthrough", "walk-through",
    "debug", "bug", "check my code", "check code", "fix", "fix my", "why is", "error", "stack", "trace",
    "optimi",
    "complexity", "time complexity", "space complexity",
    "implement", "implementation", "how to", "step-by-step", "steps", "example", "test case", "test-case",
    "edge case", "wrong answer", "wa", "runtime", "tle", "mle", "improve", "suggest", "refactor"
  ];

  for (const kw of helpfulKeywords) {
    if (s.includes(kw)) return true;
  }

  if (/\b(can you|could you|would you|please explain|please help|show me|how do i|how to implement|what's the best way|how can i)\b/i.test(q)) {
    return true;
  }

  return false;
}

// -------- main send function (build system prompt and call backend) --------
async function sendMessageToAI(userQuery) {
  if (isLoading || !userQuery) return;

  if (greetingOnly(userQuery)) {
    addMessageToChat("user", userQuery);
    chatHistory.push({ role: "user", parts: [{ text: userQuery }] });

    const greetText = "Hi! 👋 How can I help with this problem — a concise hint, the overall approach, or help debugging your code?";
    addMessageToChat("ai", greetText);
    chatHistory.push({ role: "model", parts: [{ text: greetText }] });
    await saveChatHistory();
    return;
  }

  if (isOffTopicQuery(userQuery)) {
    addMessageToChat("user", userQuery);
    addMessageToChat("ai", "Sorry — I only provide help related to the current LeetCode problem (hints, approach, debugging). I can't answer general knowledge or news questions here.");
    return;
  }

  const helpful = isHelpfulQuery(userQuery);

  isLoading = true;
  let loadingMessage = null;
  try {
    addMessageToChat("user", userQuery);
    const userMessageForHistory = { role: "user", parts: [{ text: userQuery }] };
    chatHistory.push(userMessageForHistory);

    const context = getProblemContext();

    const systemPrompt = `You are an expert LeetCode programming mentor. Help the user solve the current LeetCode problem WITHOUT giving full code solutions. Provide hints, high-level approach steps, and Socratic questions. If the user explicitly requests a "small hint", respond with a concise, one- or two-sentence hint and then ask if they'd like more detail. If the user greets you (e.g., "hi", "hello"), reply with a friendly greeting and ask what they want help with for the current problem (hint, approach, debugging). If the user asks unrelated general-knowledge or news questions, refuse and steer them back to the problem.`;
    const fullContextPrompt = `CONTEXT:\n- Problem: ${context.problemTitle}\n- Description: ${context.problemDescription}\n- My Code: ${context.userCode || "None"}\n\nINSTRUCTIONS:\n- ${systemPrompt}`;
    const systemMessage = { role: "system", parts: [{ text: fullContextPrompt }] };

    const historyForAPI = [systemMessage, ...chatHistory];

    if (helpful) {
      messageCounter++;
    }
    const shouldRequestRecommendations = messageCounter >= RECOMMENDATION_THRESHOLD;

    loadingMessage = addMessageToChat("ai", "", true);
    const requestBody = { contents: historyForAPI };

    const aiResponseText = await callBackend(requestBody);

    if (loadingMessage) loadingMessage.remove();
    addMessageToChat("ai", aiResponseText);

    chatHistory.push({ role: "model", parts: [{ text: aiResponseText }] });
    await saveChatHistory();

    if (shouldRequestRecommendations) {
      const ctx = getProblemContext();
      await getRecommendations(ctx.problemTitle);
      messageCounter = 0;
    }
  } catch (error) {
    if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === "user") chatHistory.pop();
    console.error("Error fetching AI response:", error);
    if (loadingMessage) loadingMessage.remove();
    addMessageToChat("ai", `Sorry, an error occurred. ${error.message}`);
  } finally {
    isLoading = false;
  }
}

// -------- UI creation and interaction (Chat + Review only) --------
function createMainButton() {
  if (document.getElementById("ai-mentor-btn")) return;
  const mentorButton = document.createElement("button");
  mentorButton.id = "ai-mentor-btn";
  mentorButton.innerHTML = `SUPPORT BOT <div class="button-icon"></div>`;
  document.body.appendChild(mentorButton);
  updateNotificationDot();
  mentorButton.addEventListener("click", () => {
    const chatContainer = document.getElementById("ai-chat-container");
    if (!chatContainer) createChatUI();
    else {
      const chatUI = document.getElementById("ai-chat-container");
      chatUI.style.display = chatUI.style.display === "none" ? "flex" : "none";
    }
  });
}

function createChatUI() {
  if (document.getElementById("ai-chat-container")) return;
  const chatContainer = document.createElement("div");
  chatContainer.id = "ai-chat-container";
  chatContainer.style.display = "flex";
  chatContainer.innerHTML = `
    <div id="ai-chat-header">LeetCode AI Mentor</div>
    <div id="ai-chat-tabs">
      <div class="ai-chat-tab active" data-tab="chat">Chat</div>
      <div class="ai-chat-tab" data-tab="review">My Review List</div>
    </div>
    <div class="ai-chat-panel active" id="ai-chat-panel">
      <div id="ai-chat-messages"></div>
      <div id="ai-quick-actions">
        <button class="quick-action-btn" data-prompt="Give me a small hint to get started">Get a Hint</button>
        <button class="quick-action-btn" data-prompt="Explain the approach of the problem">Explain Approach</button>
        <button class="quick-action-btn" id="clear-chat-btn">Clear Chat</button>
      </div>
      <div id="ai-chat-input-container">
        <input id="ai-chat-input" type="text" placeholder="Or type your own question...">
        <button id="ai-chat-send-btn">Send</button>
      </div>
    </div>
    <div class="ai-chat-panel" id="ai-review-list-panel"></div>
  `;
  document.body.appendChild(chatContainer);

  const sendButton = document.getElementById("ai-chat-send-btn");
  const input = document.getElementById("ai-chat-input");
  const header = document.getElementById("ai-chat-header");
  const clearChatBtn = document.getElementById("clear-chat-btn");

  const handleTextInputSend = () => {
    const query = input.value.trim();
    if (query) {
      sendMessageToAI(query);
      input.value = "";
    }
  };
  sendButton.onclick = handleTextInputSend;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") handleTextInputSend(); });

  clearChatBtn.addEventListener("click", () => {
    if (confirm("Clear chat history for this problem?")) {
      chatHistory = [];
      const messagesContainer = document.getElementById("ai-chat-messages");
      if (messagesContainer) messagesContainer.innerHTML = "";
      saveChatHistory();
    }
  });

  makeDraggable(chatContainer, header);
  document.querySelectorAll(".quick-action-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const prompt = button.dataset.prompt;
      if (prompt) sendMessageToAI(prompt);
    });
  });
  const tabs = chatContainer.querySelectorAll(".ai-chat-tab");
  const panels = chatContainer.querySelectorAll(".ai-chat-panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetTab = tab.dataset.tab;
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      panels.forEach((p) => p.classList.remove("active"));
      if (targetTab === "chat") document.getElementById("ai-chat-panel").classList.add("active");
      else if (targetTab === "review") { document.getElementById("ai-review-list-panel").classList.add("active"); renderReviewList(); setNotificationStatus(false); }
    });
  });
  loadChatHistory();
}

function makeDraggable(element, handle) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  handle.onmousedown = dragMouseDown;
  function dragMouseDown(e) {
    e.preventDefault();
    pos3 = e.clientX; pos4 = e.clientY;
    document.onmouseup = closeDragElement; document.onmousemove = elementDrag;
  }
  function elementDrag(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY; pos3 = e.clientX; pos4 = e.clientY;
    element.style.top = element.offsetTop - pos2 + "px";
    element.style.left = element.offsetLeft - pos1 + "px";
  }
  function closeDragElement() { document.onmouseup = null; document.onmousemove = null; }
}

function resetChatState() {
  console.log("AI Mentor: Resetting in-memory chat state.");
  chatHistory = [];
  const messagesContainer = document.getElementById("ai-chat-messages");
  if (messagesContainer) messagesContainer.innerHTML = "";
  uiInitialized = false;
}

async function handleSuccessfulSubmission() {
  console.log("Success detected!");
  const data = await SessionStorage.get("lastSubmittedProblem");
  const problemTitle = data ? data.lastSubmittedProblem.problemTitle : null;
  if (!problemTitle || problemTitle === "Title not found") return;
  const { solvedProblems } = await LocalStorage.get("solvedProblems");
  if (solvedProblems && solvedProblems.some((p) => p.title === problemTitle)) return;
  try {
    const topic = await getTopicForProblem(problemTitle);
    await saveSolvedProblem(problemTitle, topic);
  } catch (error) {
    console.error("Failed to analyze solved problem:", error);
  }
}

function addSubmitListener() {
  const submitButton = document.querySelector('button[data-e2e-locator="submit-button"]');
  if (submitButton && !submitButton.dataset.listenerAttached) {
    submitButton.dataset.listenerAttached = "true";
    submitButton.addEventListener("click", () => {
      const context = getProblemContext();
      if (context.problemTitle !== "Title not found") {
        SessionStorage.set({ lastSubmittedProblem: { problemTitle: context.problemTitle } });
        console.log(`Submit clicked for: ${context.problemTitle}. Title saved to session.`);
      }
    });
  }
}

// -------- observers to initialize UI on problem pages --------
const mainObserver = new MutationObserver(async () => {
  const hookSelector = 'div[data-track-load="description_content"]';
  const hookElement = document.querySelector(hookSelector);
  if (hookElement) {
    if (window.location.href !== currentProblemURL) {
      currentProblemURL = window.location.href;
      uiInitialized = false;
      resetChatState();
      await loadChatHistory();
      if (window.location.href.includes("/submissions/detail/")) {
        submissionObserver.observe(document.body, { childList: true, subtree: true });
      }
    }
    if (!uiInitialized) {
      createMainButton();
      addSubmitListener();
      uiInitialized = true;
    }
  }
});
const submissionObserver = new MutationObserver(() => {
  const successNode = document.querySelector('span[data-e2e-locator="submission-result"]');
  if (successNode && successNode.innerText.trim() === "Accepted") {
    handleSuccessfulSubmission();
    submissionObserver.disconnect();
  }
});

console.log("AI Mentor: Starting observers...");
mainObserver.observe(document.body, { childList: true, subtree: true });
if (window.location.href.includes("/submissions/detail/")) {
  submissionObserver.observe(document.body, { childList: true, subtree: true });
}

// allow background open options
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "openOptionsPage") chrome.runtime.openOptionsPage();
});