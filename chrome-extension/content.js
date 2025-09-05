// Global variables
let chatHistory = [];
let messageCounter = 0;
let currentProblemURL = window.location.href;

console.log("LeetCode AI Mentor: content.js script is active (v1.1).");

// --- STORAGE HELPER FUNCTIONS ---
const Storage = {
    get: (key) => new Promise(resolve => chrome.storage.local.get(key, result => resolve(result[key]))),
    set: (obj) => new Promise(resolve => chrome.storage.local.set(obj, resolve))
};

async function saveReviewItems(concept, problems, sourceProblem) {
    const reviewList = await Storage.get('reviewList') || {};
    if (!reviewList[concept]) {
        reviewList[concept] = [];
    }
    problems.forEach(problem => {
        // Avoid adding duplicates
        if (!reviewList[concept].some(p => p.url === problem.url)) {
            reviewList[concept].push({ ...problem, from: sourceProblem });
        }
    });
    await Storage.set({ reviewList });
    await setNotificationStatus(true);
}

async function setNotificationStatus(hasNotification) {
    await Storage.set({ hasNotification });
    updateNotificationDot();
}

function updateNotificationDot() {
    Storage.get('hasNotification').then(hasNotif => {
        const mentorButton = document.getElementById('ai-mentor-btn');
        if (mentorButton) {
            mentorButton.classList.toggle('has-notification', !!hasNotif);
        }
    });
}

// --- UI AND LOGIC FUNCTIONS ---

function getProblemContext() {
    // ... (This function remains unchanged)
    const titleSelector = 'div[data-cy="question-title"]';
    const descriptionSelector = 'div[data-track-load="description_content"]';
    const titleEl = document.querySelector(titleSelector);
    const descriptionEl = document.querySelector(descriptionSelector);
    let userCode = "Could not read code from editor.";
    if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) userCode = models[0].getValue();
    }
    return {
        problemTitle: titleEl ? titleEl.innerText : "Title not found",
        problemDescription: descriptionEl ? descriptionEl.innerHTML : "Description not found",
        userCode,
    };
}

function addMessageToChat(sender, message, isLoading = false) {
    // ... (This function remains unchanged)
    const messagesContainer = document.getElementById('ai-chat-messages');
    if (!messagesContainer) return null;
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('ai-chat-message', sender === 'user' ? 'user-message' : 'ai-message');
    if (isLoading) {
        messageDiv.classList.add('loading');
        messageDiv.textContent = 'Thinking...';
    } else {
        message = message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        messageDiv.innerHTML = message.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    }
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return messageDiv;
}

async function renderReviewList() {
    const panel = document.getElementById('ai-review-list-panel');
    if (!panel) return;

    const reviewList = await Storage.get('reviewList') || {};
    if (Object.keys(reviewList).length === 0) {
        panel.innerHTML = '<p>Your review list is empty. When the mentor gives you recommendations, they will appear here!</p>';
        return;
    }

    let html = '';
    for (const concept in reviewList) {
        html += `<div class="review-list-category">
                    <h3>Practice for ${concept}</h3>
                    <ul>`;
        reviewList[concept].forEach(item => {
            html += `<li><a href="${item.url}" target="_blank">${item.title}</a></li>`;
        });
        html += `   </ul>
                 </div>`;
    }
    panel.innerHTML = html;
}

async function sendMessageToAI() {
    const input = document.getElementById('ai-chat-input');
    if (!input) return;
    const userQuery = input.value.trim();
    if (!userQuery) return;

    messageCounter++;
    addMessageToChat('user', userQuery);
    chatHistory.push({ role: "user", parts: [{ text: userQuery }] });
    input.value = '';

    const loadingMessage = addMessageToChat('ai', '', true);
    const shouldRequestRecommendations = messageCounter >= 3;

    try {
        const context = getProblemContext();
        const response = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...context,
                userQuery,
                chatHistory: chatHistory.slice(0, -1),
                getRecommendations: shouldRequestRecommendations,
            }),
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const data = await response.json();

        loadingMessage.remove();
        addMessageToChat('ai', data.response);
        chatHistory.push({ role: "model", parts: [{ text: data.response }] });

        // --- UPDATED: Handle new recommendation data structure ---
        const { concept, recommendations } = data.recommendationData;
        if (concept && recommendations && recommendations.length > 0) {
            await saveReviewItems(concept, recommendations, context.problemTitle);
            messageCounter = 0; // Reset after successful recommendation
        }
    } catch (error) {
        console.error('Error fetching AI response:', error);
        loadingMessage.remove();
        addMessageToChat('ai', 'Sorry, I encountered an error. Please try again.');
    }
}

function createChatUI() {
    if (document.getElementById('ai-mentor-btn')) return;
    console.log("AI Mentor: Hook element found! Creating UI...");

    const mentorButton = document.createElement('button');
    mentorButton.id = 'ai-mentor-btn';
    mentorButton.innerHTML = '🤖';
    document.body.appendChild(mentorButton);
    updateNotificationDot(); // Check for notification on initial creation

    const chatContainer = document.createElement('div');
    chatContainer.id = 'ai-chat-container';
    chatContainer.style.display = 'none';

    // --- NEW: Build the tabbed UI structure ---
    chatContainer.innerHTML = `
        <div id="ai-chat-header">LeetCode AI Mentor</div>
        <div id="ai-chat-tabs">
            <div class="ai-chat-tab active" data-tab="chat">Chat</div>
            <div class="ai-chat-tab" data-tab="review">My Review List</div>
        </div>
        
        <!-- Chat Panel -->
        <div class="ai-chat-panel active" id="ai-chat-panel">
            <div id="ai-chat-messages"></div>
            <div id="ai-chat-input-container">
                <input id="ai-chat-input" type="text" placeholder="Ask a hint...">
                <button id="ai-chat-send-btn">Send</button>
            </div>
        </div>

        <!-- Review List Panel -->
        <div class="ai-chat-panel" id="ai-review-list-panel">
            <!-- Content will be rendered here by renderReviewList() -->
        </div>
    `;
    document.body.appendChild(chatContainer);

    // --- Add Event Listeners ---
    const sendButton = document.getElementById('ai-chat-send-btn');
    const input = document.getElementById('ai-chat-input');
    const header = document.getElementById('ai-chat-header');
    
    mentorButton.addEventListener('click', () => {
        chatContainer.style.display = chatContainer.style.display === 'none' ? 'flex' : 'none';
    });

    sendButton.onclick = sendMessageToAI;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessageToAI(); });
    makeDraggable(chatContainer, header);

    // Tab switching logic
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
                renderReviewList(); // Re-render list every time tab is opened
                setNotificationStatus(false); // Clear notification when user views the list
            }
        });
    });
}

function makeDraggable(element, handle) { /* ... (same as before) ... */ }
function makeDraggable(element, handle) { let pos1=0,pos2=0,pos3=0,pos4=0; handle.onmousedown=dragMouseDown; function dragMouseDown(e){e.preventDefault();pos3=e.clientX;pos4=e.clientY;document.onmouseup=closeDragElement;document.onmousemove=elementDrag} function elementDrag(e){e.preventDefault();pos1=pos3-e.clientX;pos2=pos4-e.clientY;pos3=e.clientX;pos4=e.clientY;element.style.top=(element.offsetTop-pos2)+"px";element.style.left=(element.offsetLeft-pos1)+"px"} function closeDragElement(){document.onmouseup=null;document.onmousemove=null} }

function resetChatState() {
    console.log("AI Mentor: Navigated to a new problem. Resetting chat state.");
    chatHistory = [];
    messageCounter = 0;
    const messagesContainer = document.getElementById('ai-chat-messages');
    if (messagesContainer) messagesContainer.innerHTML = '';
}

// --- MAIN EXECUTION LOGIC ---
const observer = new MutationObserver(() => {
    if (window.location.href !== currentProblemURL) {
        currentProblemURL = window.location.href;
        resetChatState();
    }
    
    const hookSelector = 'div[data-track-load="description_content"]';
    const hookElement = document.querySelector(hookSelector);
    
    if (hookElement && !document.getElementById('ai-mentor-btn')) {
        console.log(`AI Mentor: Found the hook element ("${hookSelector}").`);
        createChatUI();
    }
});

console.log("AI Mentor: Starting observer to watch for page changes...");
observer.observe(document.body, { childList: true, subtree: true });