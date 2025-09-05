// Global variables
let chatHistory = [];
let messageCounter = 0;
let currentProblemURL = window.location.href;

console.log("LeetCode AI Mentor: content.js script is active (v2.4 - Logic Fix).");

// --- STORAGE HELPER FUNCTIONS ---
const Storage = {
    get: (keys) => new Promise(resolve => chrome.storage.local.get(keys, result => resolve(result))),
    set: (obj) => new Promise(resolve => chrome.storage.local.set(obj, resolve))
};

async function saveReviewItems(concept, problems, sourceProblem) {
    let { reviewList } = await Storage.get('reviewList');
    reviewList = reviewList || [];
    if (typeof reviewList === 'object' && !Array.isArray(reviewList)) { reviewList = []; }

    const newEntry = { concept, source: sourceProblem, problems };
    const isDuplicate = reviewList.some(item => item.source === newEntry.source && item.concept === newEntry.concept);

    if (!isDuplicate) {
        reviewList.push(newEntry);
        await Storage.set({ reviewList });
        await setNotificationStatus(true);
    }
}

async function setNotificationStatus(hasNotification) {
    await Storage.set({ hasNotification });
    updateNotificationDot();
}

function updateNotificationDot() {
    Storage.get('hasNotification').then(({ hasNotification }) => {
        const mentorButton = document.getElementById('ai-mentor-btn');
        if (mentorButton) {
            mentorButton.classList.toggle('has-notification', !!hasNotification);
        }
    });
}


// --- UI AND LOGIC FUNCTIONS ---

function getProblemContext() {
    const titleSelectors = [ 'div[data-cy="question-title"]', '.mr-2.text-label-1', '.text-title-large a' ];
    let problemTitle = "Title not found";
    for (const selector of titleSelectors) {
        const titleEl = document.querySelector(selector);
        if (titleEl && titleEl.innerText) {
            problemTitle = titleEl.innerText.replace(/^\d+\.\s*/, '').trim();
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
    return { problemTitle, problemDescription: descriptionEl ? descriptionEl.innerHTML : "Description not found", userCode };
}

function addMessageToChat(sender, message, isLoading = false) { const messagesContainer = document.getElementById('ai-chat-messages'); if (!messagesContainer) return null; const messageDiv = document.createElement('div'); messageDiv.classList.add('ai-chat-message', sender === 'user' ? 'user-message' : 'ai-message'); if (isLoading) { messageDiv.classList.add('loading'); messageDiv.textContent = 'Thinking...'; } else { message = message.replace(/</g, "&lt;").replace(/>/g, "&gt;"); messageDiv.innerHTML = message.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>'); } messagesContainer.appendChild(messageDiv); messagesContainer.scrollTop = messagesContainer.scrollHeight; return messageDiv; }

async function renderReviewList() {
    const { reviewList } = await Storage.get('reviewList');
    const panel = document.getElementById('ai-review-list-panel');
    if (!panel) return;
    if (!reviewList || reviewList.length === 0) {
        panel.innerHTML = '<p style="padding: 15px;">Your review list is empty.</p>';
        return;
    }
    let html = '';
    reviewList.forEach(item => {
        html += `<div class="review-list-category"><h3>Practice for Data Structure ${item.concept}</h3><p class="source-problem">Recommended from: ${item.source}</p><p>Related problems:</p><ul>`;
        item.problems.forEach(problem => { html += `<li><a href="${problem.url}" target="_blank">${problem.title}</a></li>`; });
        html += `</ul></div>`;
    });
    panel.innerHTML = html;
}

async function callGeminiAPI(apiKey, requestBody) {
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API Error: ${response.status} - ${errorData.error.message}`);
    }
    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

async function getRecommendations(apiKey, problemTitle) {
    try {
        addMessageToChat('ai', 'Analyzing problem to find related topics...', true);
        const conceptPrompt = `Based on the LeetCode problem title "${problemTitle}", what is the single most important data structure or algorithmic concept required? Respond with ONLY the name of the concept (e.g., "Hash Table", "Two Pointers").`;
        const concept = await callGeminiAPI(apiKey, { contents: [{ parts: [{ text: conceptPrompt }] }] });
        const recommendationPrompt = `List 2-3 classic LeetCode problems that are excellent for practicing the concept of "${concept.trim()}". Do not include the original problem "${problemTitle}". Provide your response as a valid JSON array of objects. Each object must have a "title" and a "url" key. Respond with ONLY the JSON array.`;
        const recoResponse = await callGeminiAPI(apiKey, { contents: [{ parts: [{ text: recommendationPrompt }] }] });
        const jsonMatch = recoResponse.match(/\[.*\]/s);
        if (!jsonMatch) throw new Error("Could not parse recommendation JSON.");
        const recommendations = JSON.parse(jsonMatch[0]);
        await saveReviewItems(concept.trim(), recommendations, problemTitle);
    } catch (error) {
        console.error("Failed to get recommendations:", error);
        addMessageToChat('ai', `Could not fetch recommendations. ${error.message}`);
    } finally {
        const loadingMessage = document.querySelector('.ai-message.loading');
        if (loadingMessage) loadingMessage.remove();
    }
}

async function sendMessageToAI() {
    const input = document.getElementById('ai-chat-input');
    if (!input) return;
    const userQuery = input.value.trim();
    if (!userQuery) return;

    let loadingMessage = null;

    try {
        const { geminiApiKey } = await Storage.get('geminiApiKey');
        if (!geminiApiKey) {
            addMessageToChat('ai', 'ERROR: Google Gemini API key not found. Please set it in the extension options.');
            return;
        }

        addMessageToChat('user', userQuery);
        input.value = '';
        loadingMessage = addMessageToChat('ai', '', true);
        
        messageCounter++;
        const shouldRequestRecommendations = messageCounter >= 3;

        const context = getProblemContext();
        
        const systemPrompt = `You are an expert LeetCode programming mentor. Your goal is to help users solve problems without giving them the direct answer...`;

        const requestBody = {
            contents: [ ...chatHistory, { role: "user", parts: [{ text: `System instruction: ${systemPrompt}\nProblem: ${context.problemTitle}\nMy Code: ${context.userCode}\nMy Question: ${userQuery}` }] }]
        };

        const aiResponseText = await callGeminiAPI(geminiApiKey, requestBody);
        
        if (loadingMessage) loadingMessage.remove();
        addMessageToChat('ai', aiResponseText);

        chatHistory.push({ role: 'user', parts: [{ text: userQuery }] });
        chatHistory.push({ role: 'model', parts: [{ text: aiResponseText }] });

        if (shouldRequestRecommendations) {
            if (context.problemTitle !== "Title not found") {
                await getRecommendations(geminiApiKey, context.problemTitle);
            }
            messageCounter = 0;
        }
    } catch (error) {
        console.error('Error fetching AI response:', error);
        if (loadingMessage) loadingMessage.remove();
        addMessageToChat('ai', `Sorry, I encountered an error. ${error.message}`);
    }
}

function showSetupModal() {
    if (document.getElementById('ai-setup-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'ai-setup-modal';
    modal.innerHTML = `<h2>Welcome!</h2><p>To get started, please provide your Google Gemini API key.</p><button id="go-to-options-btn">Set Up API Key</button>`;
    document.body.appendChild(modal);
    document.getElementById('go-to-options-btn').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "openOptionsPage" });
    });
}

function hideSetupModal() {
    const modal = document.getElementById('ai-setup-modal');
    if (modal) modal.remove();
}

function createMainButton() {
    if (document.getElementById('ai-mentor-btn')) return;
    const mentorButton = document.createElement('button');
    mentorButton.id = 'ai-mentor-btn';
    mentorButton.innerHTML = '🤖';
    document.body.appendChild(mentorButton);
    updateNotificationDot();
    mentorButton.addEventListener('click', async () => {
        const { geminiApiKey } = await Storage.get('geminiApiKey');
        const chatContainer = document.getElementById('ai-chat-container');
        if (!geminiApiKey) {
            if (chatContainer) chatContainer.style.display = 'none';
            showSetupModal();
        } else {
            hideSetupModal();
            if (!chatContainer) createChatUI();
            const chatUI = document.getElementById('ai-chat-container');
            chatUI.style.display = chatUI.style.display === 'none' ? 'flex' : 'none';
        }
    });
}

function createChatUI() {
    const chatContainer = document.createElement('div');
    chatContainer.id = 'ai-chat-container';
    chatContainer.style.display = 'none';
    chatContainer.innerHTML = ` <div id="ai-chat-header">LeetCode AI Mentor</div> <div id="ai-chat-tabs"> <div class="ai-chat-tab active" data-tab="chat">Chat</div> <div class="ai-chat-tab" data-tab="review">My Review List</div> </div> <div class="ai-chat-panel active" id="ai-chat-panel"> <div id="ai-chat-messages"></div> <div id="ai-chat-input-container"> <input id="ai-chat-input" type="text" placeholder="Ask a hint..."> <button id="ai-chat-send-btn">Send</button> </div> </div> <div class="ai-chat-panel" id="ai-review-list-panel"></div>`;
    document.body.appendChild(chatContainer);
    const sendButton = document.getElementById('ai-chat-send-btn');
    const input = document.getElementById('ai-chat-input');
    const header = document.getElementById('ai-chat-header');
    sendButton.onclick = sendMessageToAI;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessageToAI(); });
    makeDraggable(chatContainer, header);
    const tabs = chatContainer.querySelectorAll('.ai-chat-tab');
    const panels = chatContainer.querySelectorAll('.ai-chat-panel');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            panels.forEach(p => p.classList.remove('active'));
            if (targetTab === 'chat') {
                document.getElementById('ai-chat-panel').classList.add('active');
            } else if (targetTab === 'review') {
                document.getElementById('ai-review-list-panel').classList.add('active');
                renderReviewList();
                setNotificationStatus(false);
            }
        });
    });
}

function makeDraggable(element, handle) { let pos1=0,pos2=0,pos3=0,pos4=0; handle.onmousedown=dragMouseDown; function dragMouseDown(e){e.preventDefault();pos3=e.clientX;pos4=e.clientY;document.onmouseup=closeDragElement;document.onmousemove=elementDrag} function elementDrag(e){e.preventDefault();pos1=pos3-e.clientX;pos2=pos4-e.clientY;pos3=e.clientX;pos4=e.clientY;element.style.top=(element.offsetTop-pos2)+"px";element.style.left=(element.offsetLeft-pos1)+"px"} function closeDragElement(){document.onmouseup=null;document.onmousemove=null} }
function resetChatState() { console.log("AI Mentor: Navigated to a new problem. Resetting chat state."); chatHistory = []; messageCounter = 0; const messagesContainer = document.getElementById('ai-chat-messages'); if (messagesContainer) messagesContainer.innerHTML = ''; }

const observer = new MutationObserver(() => {
    if (window.location.href !== currentProblemURL) {
        currentProblemURL = window.location.href;
        resetChatState();
    }
    const hookSelector = 'div[data-track-load="description_content"]';
    const hookElement = document.querySelector(hookSelector);
    if (hookElement) {
        createMainButton();
    }
});
console.log("AI Mentor: Starting observer...");
observer.observe(document.body, { childList: true, subtree: true });