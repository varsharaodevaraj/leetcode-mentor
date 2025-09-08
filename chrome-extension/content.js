// Global variables
let chatHistory = []; // this is the array that i'll use for to store the chat with ai, user and ai messages
let messageCounter = 0; // this is to track the hints, hence for the review list
let currentProblemURL = window.location.href; // this is compare if im in the same url or not
let myChart = null; // the analytics part, to destroy and recreate the chart 

console.log(
  "LeetCode AI Mentor: content.js script is active (v9.1 - Final Version)."
);

// --- STORAGE HELPEr FUNCTIONS ---
const SessionStorage = {
  get: (keys) =>
    new Promise((resolve) =>
      chrome.storage.session.get(keys, (result) => resolve(result))
    ),
  set: (obj) =>
    new Promise((resolve) => chrome.storage.session.set(obj, resolve)),
};
const LocalStorage = {
  get: (keys) =>
    new Promise((resolve) =>
      chrome.storage.local.get(keys, (result) => resolve(result))
    ),
  set: (obj) =>
    new Promise((resolve) => chrome.storage.local.set(obj, resolve)),
};
async function saveSolvedProblem(problemTitle, topic) {
  let { solvedProblems } = await LocalStorage.get("solvedProblems");
  solvedProblems = solvedProblems || [];
  if (
    problemTitle &&
    topic &&
    !solvedProblems.some((p) => p.title === problemTitle)
  ) {
    solvedProblems.push({ title: problemTitle, topic: topic.trim() });
    await LocalStorage.set({ solvedProblems });
  }
}
async function saveReviewItems(concept, problems, sourceProblem) {
  let { reviewList } = await LocalStorage.get("reviewList");
  reviewList = reviewList || [];
  if (typeof reviewList === "object" && !Array.isArray(reviewList)) {
    reviewList = [];
  }
  const newEntry = { concept, source: sourceProblem, problems };
  const isDuplicate = reviewList.some(
    (item) =>
      item.source === newEntry.source && item.concept === newEntry.concept
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
    reviewList.forEach((item) => {
      item.problems.forEach((p) => uniqueProblems.add(p.url));
    });
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

// --- Chat history Management ---
function getProblemKeyFromURL(url) {
  const match = url.match(/leetcode\.com\/problems\/([^/]+)/);
  return match ? `chatHistory_${match[1]}` : null;
}
async function saveChatHistory() {
  const problemKey = getProblemKeyFromURL(window.location.href);
  if (problemKey) {
    await LocalStorage.set({ [problemKey]: chatHistory });
  }
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

// --- UI and LOGIC FUNCTIONS ---
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
  let userCode = "Could not read code from editor.";
  if (window.monaco && window.monaco.editor) {
    const models = window.monaco.editor.getModels();
    if (models.length > 0) userCode = models[0].getValue();
  }
  return {
    problemTitle,
    problemDescription: descriptionEl
      ? descriptionEl.innerHTML
      : "Description not found",
    userCode,
  };
}
function addMessageToChat(sender, message, isLoading = false) {
  const messagesContainer = document.getElementById("ai-chat-messages");
  if (!messagesContainer) return null;
  const messageDiv = document.createElement("div");
  messageDiv.classList.add(
    "ai-chat-message",
    sender === "user" ? "user-message" : "ai-message"
  );
  if (isLoading) {
    messageDiv.classList.add("loading");
    messageDiv.textContent = "Thinking...";
  } else {
    message = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    messageDiv.innerHTML = message.replace(
      /```([\s\S]*?)```/g,
      "<pre><code>$1</code></pre>"
    );
  }
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return messageDiv;
}
async function renderReviewList() {
  const panel = document.getElementById("ai-review-list-panel");
  if (!panel) return;
  const { reviewList } = await LocalStorage.get("reviewList");
  if (!reviewList || reviewList.length === 0) {
    panel.innerHTML =
      '<p style="padding: 15px;">Your review list is empty.</p>';
    return;
  }
  const topics = {};
  reviewList.forEach((item) => {
    if (!topics[item.concept]) {
      topics[item.concept] = [];
    }
    item.problems.forEach((problem) => {
      if (!topics[item.concept].some((p) => p.url === problem.url)) {
        topics[item.concept].push(problem);
      }
    });
  });
  let html = "";
  for (const topic in topics) {
    html += `<div class="review-topic-container"><div class="review-topic-header" data-topic="${topic}">${topic}</div><ul class="review-problem-list" data-topic-list="${topic}">`;
    topics[topic].forEach((problem) => {
      html += `<li data-url="${problem.url}"><a href="${problem.url}" target="_blank">${problem.title}</a><button class="mark-done-btn" data-url="${problem.url}" data-title="${problem.title}" data-concept="${topic}">Mark as Done</button></li>`;
    });
    html += `</ul></div>`;
  }
  panel.innerHTML = html;
  panel.querySelectorAll(".review-topic-header").forEach((header) => {
    header.addEventListener("click", () => {
      header.classList.toggle("active");
      const problemList = panel.querySelector(
        `[data-topic-list="${header.dataset.topic}"]`
      );
      if (problemList.style.maxHeight) {
        problemList.style.maxHeight = null;
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
      let updatedReviewList = [];
      reviewList.forEach((item) => {
        item.problems = item.problems.filter((p) => p.url !== urlToRemove);
        if (item.problems.length > 0) {
          updatedReviewList.push(item);
        }
      });
      await LocalStorage.set({ reviewList: updatedReviewList });
      renderReviewList();
      updateNotificationDot();
    });
  });
}
async function callGeminiAPI(apiKey, requestBody) {
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      `API Error: ${response.status} - ${errorData.error.message}`
    );
  }
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}
async function getRecommendations(apiKey, problemTitle) {
  if (problemTitle === "Title not found") return;
  try {
    addMessageToChat("ai", "Analyzing problem for related topics...", true);
    const concept = await getTopicForProblem(apiKey, problemTitle);
    const recommendationPrompt = `List 2-3 classic LeetCode problems for practicing "${concept.trim()}", excluding "${problemTitle}". Provide response as a valid JSON array of objects with "title" and "url" keys. Respond with ONLY the JSON array.`;
    const recoResponse = await callGeminiAPI(apiKey, {
      contents: [{ parts: [{ text: recommendationPrompt }] }],
    });
    const jsonMatch = recoResponse.match(/\[.*\]/s);
    if (!jsonMatch) throw new Error("Could not parse recommendation JSON.");
    const recommendations = JSON.parse(jsonMatch[0]);
    await saveReviewItems(concept.trim(), recommendations, problemTitle);
  } catch (error) {
    console.error("Failed to get recommendations:", error);
    addMessageToChat("ai", `Could not fetch recommendations. ${error.message}`);
  } finally {
    const loadingMessage = document.querySelector(".ai-message.loading");
    if (loadingMessage) loadingMessage.remove();
  }
}

// --- sendMessageToAI with final context fix ---
async function sendMessageToAI() {
  const input = document.getElementById("ai-chat-input");
  if (!input) return;
  const userQuery = input.value.trim();
  if (!userQuery) return;
  let loadingMessage = null;
  try {
    const { geminiApiKey } = await LocalStorage.get("geminiApiKey");
    if (!geminiApiKey) {
      addMessageToChat(
        "ai",
        "ERROR: API key not found. Please set it in options."
      );
      return;
    }

    addMessageToChat("user", userQuery);
    input.value = "";
    loadingMessage = addMessageToChat("ai", "", true);

    // UI and persistent history
    const userMessageForHistory = {
      role: "user",
      parts: [{ text: userQuery }],
    };
    chatHistory.push(userMessageForHistory);

    let historyForAPI = [...chatHistory];

    // If this is the first user message, prepend the full context to the API request
    if (chatHistory.filter((m) => m.role === "user").length === 1) {
      const context = getProblemContext();
      const systemPrompt = `You are an expert LeetCode programming mentor. Your goal is to help users solve problems without giving them the direct answer. Stay strictly on the topic of the provided LeetCode problem. Do not provide the full code solution. Instead, guide the user with hints and Socratic questions.`;

      const fullContextPrompt = `CONTEXT:\n- Problem: ${
        context.problemTitle
      }\n- Description: ${context.problemDescription}\n- My Code: ${
        context.userCode || "None"
      }\n\nINSTRUCTIONS:\n- ${systemPrompt}\n\nMY QUESTION:\n- ${userQuery}`;

      // Replace the simple user query with the full context prompt FOR THE API ONLY
      historyForAPI[historyForAPI.length - 1] = {
        role: "user",
        parts: [{ text: fullContextPrompt }],
      };
    }

    messageCounter++;
    const shouldRequestRecommendations = messageCounter >= 3;

    const requestBody = { contents: historyForAPI };

    const aiResponseText = await callGeminiAPI(geminiApiKey, requestBody);

    if (loadingMessage) loadingMessage.remove();
    addMessageToChat("ai", aiResponseText);

    chatHistory.push({ role: "model", parts: [{ text: aiResponseText }] });
    await saveChatHistory();

    if (shouldRequestRecommendations) {
      const context = getProblemContext();
      await getRecommendations(geminiApiKey, context.problemTitle);
      messageCounter = 0;
    }
  } catch (error) {
    // If an error occurs, remove the user's last message from history to prevent issues
    if (
      chatHistory.length > 0 &&
      chatHistory[chatHistory.length - 1].role === "user"
    ) {
      chatHistory.pop();
    }
    console.error("Error fetching AI response:", error);
    if (loadingMessage) loadingMessage.remove();
    addMessageToChat("ai", `Sorry, an error occurred. ${error.message}`);
  }
}

async function renderAnalytics() {
  const panel = document.getElementById("ai-analytics-panel");
  if (!panel) return;
  const drawUI = async () => {
    panel.innerHTML = `<div class="analytics-section"><h2>Overall Mastery</h2><div id="mastery-chart-container"><canvas id="masteryChart"></canvas><div id="mastery-score-text"></div></div></div><div class="analytics-section"><h2>Skills Breakdown</h2><ul class="skills-overview-list" id="skills-overview-list"></ul></div>`;
    const { solvedProblems } = await LocalStorage.get("solvedProblems");
    const { reviewList } = await LocalStorage.get("reviewList");
    const topicData = {};
    let totalSolved = 0;
    let totalReview = 0;
    if (solvedProblems) {
      solvedProblems.forEach((p) => {
        if (!p.topic || p.topic.toLowerCase().includes("title not found"))
          return;
        if (!topicData[p.topic]) topicData[p.topic] = { solved: 0, review: 0 };
        topicData[p.topic].solved++;
      });
    }
    if (reviewList) {
      reviewList.forEach((item) => {
        const concept = item.concept;
        if (
          !concept ||
          concept.toLowerCase().includes("title not found") ||
          concept.toLowerCase().includes("since no leetcode problem")
        )
          return;
        if (!topicData[concept]) topicData[concept] = { solved: 0, review: 0 };
        topicData[concept].review += item.problems.length;
      });
    }
    const overviewList = document.getElementById("skills-overview-list");
    if (Object.keys(topicData).length === 0) {
      overviewList.innerHTML =
        '<p style="padding: 15px;">No data yet. Solve problems or ask for hints to build your analytics!</p>';
      document.getElementById("mastery-chart-container").style.display = "none";
      return;
    }
    const getScoreColor = (score) => {
      const r = Math.round(255 * Math.min(2 - 2 * score, 1));
      const g = Math.round(255 * Math.min(2 * score, 1));
      return `rgb(${r}, ${g}, 0)`;
    };
    let listHtml = "";
    for (const topic in topicData) {
      const { solved, review } = topicData[topic];
      totalSolved += solved;
      totalReview += review;
      const total = solved + review;
      const score = total > 0 ? solved / total : 0;
      const colorValue = getScoreColor(score);
      let tagText = "Needs Focus";
      if (score >= 0.4) tagText = "Developing";
      if (score >= 0.7) tagText = "Strong";
      if (score === 1.0) tagText = "Mastered";
      listHtml += `<li><span>${topic}</span><span class="skill-tag" style="background-color: ${colorValue}; color: #111;">${tagText}</span></li>`;
    }
    overviewList.innerHTML = listHtml;
    const overallTotal = totalSolved + totalReview;
    const masteryScore =
      overallTotal > 0 ? Math.round((totalSolved / overallTotal) * 100) : 0;
    document.getElementById(
      "mastery-score-text"
    ).innerText = `${masteryScore}%`;
    const ctx = document.getElementById("masteryChart").getContext("2d");
    if (myChart) myChart.destroy();
    myChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Mastered", "Needs Practice"],
        datasets: [
          {
            data: [masteryScore, 100 - masteryScore],
            backgroundColor: ["#8a2be2", "#444"],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        cutout: "75%",
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
  };
  if (window.Chart) {
    await drawUI();
  } else {
    panel.innerHTML = "<p>Loading analytics library...</p>";
    try {
      const response = await chrome.runtime.sendMessage({
        action: "injectChartScript",
      });
      if (response && response.success) {
        await drawUI();
      } else {
        throw new Error("Background script failed to load Chart.js.");
      }
    } catch (e) {
      console.error("Failed to load Chart.js:", e);
      panel.innerHTML = "<p>Error: Could not load charting library.</p>";
    }
  }
}
async function getCurrentTabId() {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab.id;
}
function showSetupModal() {
  if (document.getElementById("ai-setup-modal")) return;
  const modal = document.createElement("div");
  modal.id = "ai-setup-modal";
  modal.innerHTML = `<h2>Welcome!</h2><p>To get started, please provide your Google Gemini API key.</p><button id="go-to-options-btn">Set Up API Key</button>`;
  document.body.appendChild(modal);
  document.getElementById("go-to-options-btn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "openOptionsPage" });
  });
}
function hideSetupModal() {
  const modal = document.getElementById("ai-setup-modal");
  if (modal) modal.remove();
}
function createMainButton() {
  if (document.getElementById("ai-mentor-btn")) return;
  const mentorButton = document.createElement("button");
  mentorButton.id = "ai-mentor-btn";
  mentorButton.innerHTML = `SUPPORT BOT <div class="button-icon"></div>`;
  document.body.appendChild(mentorButton);
  updateNotificationDot();
  mentorButton.addEventListener("click", async () => {
    const { geminiApiKey } = await LocalStorage.get("geminiApiKey");
    const chatContainer = document.getElementById("ai-chat-container");
    if (!geminiApiKey) {
      if (chatContainer) chatContainer.style.display = "none";
      showSetupModal();
    } else {
      hideSetupModal();
      if (!chatContainer) {
        createChatUI();
      } else {
        const chatUI = document.getElementById("ai-chat-container");
        chatUI.style.display =
          chatUI.style.display === "none" ? "flex" : "none";
      }
    }
  });
}
function createChatUI() {
  const chatContainer = document.createElement("div");
  chatContainer.id = "ai-chat-container";
  chatContainer.style.display = "flex";
  chatContainer.innerHTML = `<div id="ai-chat-header">LeetCode AI Mentor</div><div id="ai-chat-tabs"><div class="ai-chat-tab active" data-tab="chat">Chat</div><div class="ai-chat-tab" data-tab="review">Revise List</div><div class="ai-chat-tab" data-tab="analytics">Analytics</div></div><div class="ai-chat-panel active" id="ai-chat-panel"><div id="ai-chat-messages"></div><div id="ai-chat-input-container"><input id="ai-chat-input" type="text" placeholder="Ask a hint..."><button id="ai-chat-send-btn">Send</button></div></div><div class="ai-chat-panel" id="ai-review-list-panel"></div><div class="ai-chat-panel" id="ai-analytics-panel"></div>`;
  document.body.appendChild(chatContainer);
  const sendButton = document.getElementById("ai-chat-send-btn");
  const input = document.getElementById("ai-chat-input");
  const header = document.getElementById("ai-chat-header");
  sendButton.onclick = sendMessageToAI;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessageToAI();
  });
  makeDraggable(chatContainer, header);
  const tabs = chatContainer.querySelectorAll(".ai-chat-tab");
  const panels = chatContainer.querySelectorAll(".ai-chat-panel");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetTab = tab.dataset.tab;
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      panels.forEach((p) => p.classList.remove("active"));
      if (targetTab === "chat") {
        document.getElementById("ai-chat-panel").classList.add("active");
      } else if (targetTab === "review") {
        document.getElementById("ai-review-list-panel").classList.add("active");
        renderReviewList();
        setNotificationStatus(false);
      } else if (targetTab === "analytics") {
        document.getElementById("ai-analytics-panel").classList.add("active");
        renderAnalytics();
      }
    });
  });
  loadChatHistory();
}
function makeDraggable(element, handle) {
  let pos1 = 0,
    pos2 = 0,
    pos3 = 0,
    pos4 = 0;
  handle.onmousedown = dragMouseDown;
  function dragMouseDown(e) {
    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  }
  function elementDrag(e) {
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    element.style.top = element.offsetTop - pos2 + "px";
    element.style.left = element.offsetLeft - pos1 + "px";
  }
  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}
function resetChatState() {
  console.log("AI Mentor: Resetting in-memory chat state.");
  chatHistory = [];
  const messagesContainer = document.getElementById("ai-chat-messages");
  if (messagesContainer) messagesContainer.innerHTML = "";
}
async function handleSuccessfulSubmission() {
  console.log("Success detected!");
  const { geminiApiKey } = await LocalStorage.get("geminiApiKey");
  if (!geminiApiKey) return;
  const data = await SessionStorage.get("lastSubmittedProblem");
  const problemTitle = data ? data.lastSubmittedProblem.problemTitle : null;
  if (!problemTitle || problemTitle === "Title not found") {
    console.log(
      "Skipping submission logging due to invalid title in session storage."
    );
    return;
  }
  const { solvedProblems } = await LocalStorage.get("solvedProblems");
  if (solvedProblems && solvedProblems.some((p) => p.title === problemTitle)) {
    console.log("Problem already logged as solved. Skipping.");
    return;
  }
  try {
    const topic = await getTopicForProblem(geminiApiKey, problemTitle);
    await saveSolvedProblem(problemTitle, topic);
  } catch (error) {
    console.error("Failed to analyze solved problem:", error);
  }
}
function addSubmitListener() {
  const submitButton = document.querySelector(
    'button[data-e2e-locator="submit-button"]'
  );
  if (submitButton && !submitButton.dataset.listenerAttached) {
    submitButton.dataset.listenerAttached = "true";
    submitButton.addEventListener("click", () => {
      const context = getProblemContext();
      if (context.problemTitle !== "Title not found") {
        SessionStorage.set({
          lastSubmittedProblem: { problemTitle: context.problemTitle },
        });
        console.log(
          `Submit clicked for: ${context.problemTitle}. Title saved to session.`
        );
      }
    });
  }
}
const mainObserver = new MutationObserver(async () => {
  const hookSelector = 'div[data-track-load="description_content"]';
  const hookElement = document.querySelector(hookSelector);
  if (hookElement) {
    if (window.location.href !== currentProblemURL) {
      currentProblemURL = window.location.href;
      resetChatState();
      await loadChatHistory();
      if (window.location.href.includes("/submissions/detail/")) {
        submissionObserver.observe(document.body, {
          childList: true,
          subtree: true,
        });
      }
    }
    createMainButton();
    addSubmitListener();
  }
});
const submissionObserver = new MutationObserver(() => {
  const successNode = document.querySelector(
    'span[data-e2e-locator="submission-result"]'
  );
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
async function getTopicForProblem(apiKey, problemTitle) {
  let { topicCache } = await LocalStorage.get("topicCache");
  topicCache = topicCache || {};
  if (topicCache[problemTitle]) {
    console.log(`Cache hit for "${problemTitle}": ${topicCache[problemTitle]}`);
    return topicCache[problemTitle];
  }
  console.log(`Cache miss for "${problemTitle}". Calling API.`);
  const topicPrompt = `Based on the LeetCode problem title "${problemTitle}", what is the single most important data structure or algorithmic concept required? Respond with ONLY the name of the concept.`;
  const topic = await callGeminiAPI(apiKey, {
    contents: [{ parts: [{ text: topicPrompt }] }],
  });
  topicCache[problemTitle] = topic.trim();
  await LocalStorage.set({ topicCache });
  return topic.trim();
}
