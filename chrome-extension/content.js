// Global variables
let chatHistory = [];
let messageCounter = 0;
let currentProblemURL = window.location.href;

console.log("LeetCode AI Mentor: content.js script is active.");

// Function to scrape problem details from the LeetCode page
function getProblemContext() {
    const titleSelector = 'div[data-cy="question-title"]';
    const descriptionSelector = 'div[data-track-load="description_content"]';
    
    const titleEl = document.querySelector(titleSelector);
    const descriptionEl = document.querySelector(descriptionSelector);

    let userCode = "Could not read code from editor.";
    if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
            userCode = models[0].getValue();
        }
    }

    return {
        problemTitle: titleEl ? titleEl.innerText : "Title not found",
        problemDescription: descriptionEl ? descriptionEl.innerHTML : "Description not found",
        userCode: userCode,
    };
}

// Function to add a regular message to the chat UI
function addMessageToChat(sender, message, isLoading = false) {
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

// Function to add the special recommendation message
function addRecommendationMessageToChat(recommendations) {
    const messagesContainer = document.getElementById('ai-chat-messages');
    if (!messagesContainer || recommendations.length === 0) return;

    const tipDiv = document.createElement('div');
    tipDiv.classList.add('ai-chat-message', 'mentor-tip');

    let htmlContent = `<strong>Mentor Tip:</strong> To strengthen your skills in this area, you might want to try these problems:<ul>`;
    recommendations.forEach(rec => {
        htmlContent += `<li><a href="${rec.url}" target="_blank">${rec.title}</a></li>`;
    });
    htmlContent += `</ul>`;

    tipDiv.innerHTML = htmlContent;
    messagesContainer.appendChild(tipDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Function to send data to the backend and get AI response
async function sendMessageToAI() {
    const input = document.getElementById('ai-chat-input');
    if (!input) return;
    const userQuery = input.value.trim();

    if (!userQuery) return;

    messageCounter++;
    addMessageToChat('user', userQuery);
    chatHistory.push({ role: "user", parts: [{ text: userQuery }] });
    input.value = '';

    const loadingMessage = addMessageToChat('ai', '', true); // Corrected typo here
    const shouldRequestRecommendations = messageCounter >= 3;

    try {
        const context = getProblemContext();
        
        const response = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ...context,
                userQuery: userQuery,
                chatHistory: chatHistory.slice(0, -1),
                getRecommendations: shouldRequestRecommendations
            }),
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        
        loadingMessage.remove();
        addMessageToChat('ai', data.response);
        chatHistory.push({ role: "model", parts: [{ text: data.response }] });

        if (data.recommendations && data.recommendations.length > 0) {
            addRecommendationMessageToChat(data.recommendations);
            messageCounter = 0;
        }

    } catch (error) {
        console.error('Error fetching AI response:', error);
        loadingMessage.remove();
        addMessageToChat('ai', 'Sorry, I encountered an error. Please try again.');
    }
}

// Function to create the chat UI and inject it into the page
function createChatUI() {
    if (document.getElementById('ai-mentor-btn')) return;
    console.log("AI Mentor: Hook element found! Creating UI...");

    const mentorButton = document.createElement('button');
    mentorButton.id = 'ai-mentor-btn';
    mentorButton.innerHTML = '🤖';
    document.body.appendChild(mentorButton);

    const chatContainer = document.createElement('div');
    chatContainer.id = 'ai-chat-container';
    chatContainer.style.display = 'none';

    chatContainer.innerHTML = `
        <div id="ai-chat-header">LeetCode AI Mentor</div>
        <div id="ai-chat-messages"></div>
        <div id="ai-chat-input-container">
            <input id="ai-chat-input" type="text" placeholder="Ask a hint...">
            <button id="ai-chat-send-btn">Send</button>
        </div>
    `;
    document.body.appendChild(chatContainer);

    const sendButton = document.getElementById('ai-chat-send-btn');
    const input = document.getElementById('ai-chat-input');
    const header = document.getElementById('ai-chat-header');
    
    mentorButton.addEventListener('click', () => {
        chatContainer.style.display = chatContainer.style.display === 'none' ? 'flex' : 'none';
    });

    sendButton.onclick = sendMessageToAI;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessageToAI(); });

    makeDraggable(chatContainer, header);
}

// Utility function to make an element draggable
function makeDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.onmousedown = dragMouseDown;
    function dragMouseDown(e) { e.preventDefault(); pos3 = e.clientX; pos4 = e.clientY; document.onmouseup = closeDragElement; document.onmousemove = elementDrag; }
    function elementDrag(e) { e.preventDefault(); pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY; pos3 = e.clientX; pos4 = e.clientY; element.style.top = (element.offsetTop - pos2) + "px"; element.style.left = (element.offsetLeft - pos1) + "px"; }
    function closeDragElement() { document.onmouseup = null; document.onmousemove = null; }
}

// Function to reset the chat state for a new problem
function resetChatState() {
    console.log("AI Mentor: Navigated to a new problem. Resetting chat state.");
    chatHistory = [];
    messageCounter = 0;
    const messagesContainer = document.getElementById('ai-chat-messages');
    if (messagesContainer) { messagesContainer.innerHTML = ''; }
}

// Main execution logic using MutationObserver for reliability
const observer = new MutationObserver(() => {
    // 1. Check for navigation
    if (window.location.href !== currentProblemURL) {
        currentProblemURL = window.location.href;
        resetChatState();
    }
    
    // 2. Check for the reliable hook element you found
    const hookSelector = 'div[data-track-load="description_content"]';
    const hookElement = document.querySelector(hookSelector);
    
    // 3. If the element exists, inject the UI and STOP observing
    if (hookElement) {
        console.log(`AI Mentor: Found the hook element ("${hookSelector}").`);
        createChatUI();
        observer.disconnect(); // We're done, no need to keep checking
        console.log("AI Mentor: Observer disconnected after successful injection.");
    }
});

console.log("AI Mentor: Starting observer to watch for page changes...");
observer.observe(document.body, { childList: true, subtree: true });