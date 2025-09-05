// Global variable to hold the chat history for the current problem
let chatHistory = [];

// Function to scrape problem details from the LeetCode page
function getProblemContext() {
    // These selectors are specific to LeetCode's current layout.
    // They might need updating if LeetCode changes its website structure.
    const titleSelector = '.text-title-large a';
    const descriptionSelector = 'div[data-track-load="description_content"]';
    const codeEditorSelector = '.monaco-editor';

    const titleEl = document.querySelector(titleSelector);
    const descriptionEl = document.querySelector(descriptionSelector);
    const codeEditorEl = document.querySelector(codeEditorSelector);

    // This is a more advanced way to get the code from the Monaco editor instance
    let userCode = "Could not read code from editor.";
    if (codeEditorEl && codeEditorEl.env && codeEditorEl.env.editor) {
        userCode = codeEditorEl.env.editor.getValue();
    }

    return {
        problemTitle: titleEl ? titleEl.innerText : "Title not found",
        problemDescription: descriptionEl ? descriptionEl.innerHTML : "Description not found",
        userCode: userCode,
    };
}

// Function to add a message to the chat UI
function addMessageToChat(sender, message, isLoading = false) {
    const messagesContainer = document.getElementById('ai-chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('ai-chat-message', sender === 'user' ? 'user-message' : 'ai-message');
    
    if (isLoading) {
        messageDiv.classList.add('loading');
        messageDiv.textContent = 'Thinking...';
    } else {
        // Sanitize and render message (basic markdown for code blocks)
        messageDiv.innerHTML = message.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    }
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight; // Auto-scroll to bottom
    return messageDiv; // Return the element to update it later if needed
}

// Function to send data to the backend and get AI response
async function sendMessageToAI() {
    const input = document.getElementById('ai-chat-input');
    const userQuery = input.value.trim();

    if (!userQuery) return;

    // Display user's message immediately
    addMessageToChat('user', userQuery);
    chatHistory.push({ role: "user", parts: [{ text: userQuery }] });
    input.value = '';

    // Show a loading indicator
    const loadingMessage = addMessageToChat('ai', '', true);

    try {
        const context = getProblemContext();
        
        const response = await fetch('http://localhost:3000/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                ...context,
                userQuery: userQuery,
                chatHistory: chatHistory.slice(0, -1) // Send history *before* the current query
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        // Remove loading indicator and display the actual AI response
        loadingMessage.remove();
        addMessageToChat('ai', data.response);
        chatHistory.push({ role: "model", parts: [{ text: data.response }] });

    } catch (error) {
        console.error('Error fetching AI response:', error);
        loadingMessage.remove();
        addMessageToChat('ai', 'Sorry, I encountered an error. Please try again.');
    }
}

// Function to create the chat UI and inject it into the page
function createChatUI() {
    // --- Main Button ---
    const mentorButton = document.createElement('button');
    mentorButton.id = 'ai-mentor-btn';
    mentorButton.innerHTML = '🤖';
    document.body.appendChild(mentorButton);

    // --- Chat Container ---
    const chatContainer = document.createElement('div');
    chatContainer.id = 'ai-chat-container';
    chatContainer.style.display = 'none'; // Initially hidden

    // --- Header ---
    const chatHeader = document.createElement('div');
    chatHeader.id = 'ai-chat-header';
    chatHeader.textContent = 'LeetCode AI Mentor';
    chatContainer.appendChild(chatHeader);

    // --- Messages Area ---
    const messages = document.createElement('div');
    messages.id = 'ai-chat-messages';
    chatContainer.appendChild(messages);

    // --- Input Area ---
    const inputContainer = document.createElement('div');
    inputContainer.id = 'ai-chat-input-container';
    
    const input = document.createElement('input');
    input.id = 'ai-chat-input';
    input.type = 'text';
    input.placeholder = 'Ask a hint...';
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            sendMessageToAI();
        }
    });

    const sendButton = document.createElement('button');
    sendButton.id = 'ai-chat-send-btn';
    sendButton.textContent = 'Send';
    sendButton.onclick = sendMessageToAI;

    inputContainer.appendChild(input);
    inputContainer.appendChild(sendButton);
    chatContainer.appendChild(inputContainer);

    document.body.appendChild(chatContainer);

    // --- Event Listeners ---
    mentorButton.addEventListener('click', () => {
        chatContainer.style.display = chatContainer.style.display === 'none' ? 'flex' : 'none';
    });

    // Make the chatbox draggable
    makeDraggable(chatContainer, chatHeader);
}

// Utility function to make an element draggable
function makeDraggable(element, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
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
        element.style.top = (element.offsetTop - pos2) + "px";
        element.style.left = (element.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
    }
}

// Main execution logic
// We use a MutationObserver to wait for the LeetCode UI to be fully loaded
// This is more robust than a simple setTimeout
const observer = new MutationObserver((mutations, obs) => {
    const targetNode = document.querySelector('.text-title-large');
    if (targetNode) {
        if (!document.getElementById('ai-mentor-btn')) {
            console.log("LeetCode AI Mentor: UI ready, injecting chat.");
            createChatUI();
        }
        // Once the UI is injected, we could disconnect, but let's keep it
        // in case of single-page navigations that might remove our button.
        // obs.disconnect(); 
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});