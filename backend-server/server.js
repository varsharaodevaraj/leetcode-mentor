// Import necessary packages
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Initialize the Express app
const app = express();
const port = 3000;

// Apply middleware
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Enable parsing of JSON request bodies

// Initialize the Google Generative AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

// Define the API endpoint for chat
app.post('/api/chat', async (req, res) => {
    try {
        const { problemTitle, problemDescription, userCode, userQuery, chatHistory } = req.body;

        if (!userQuery) {
            return res.status(400).json({ error: 'User query is required.' });
        }

        // The system prompt is crucial for defining the AI's persona and rules.
        const systemPrompt = `
            You are an expert LeetCode programming mentor. Your goal is to help users solve problems without giving them the direct answer.
            You must adhere to the following rules:
            1.  **NEVER** provide the full, correct code solution.
            2.  Instead of direct answers, guide the user with Socratic questions, hints, and suggestions for debugging.
            3.  Nudge them in the right direction. Ask things like, "Have you considered what happens if the input array is empty?" or "What data structure might be efficient for lookups here?".
            4.  Keep your responses concise and focused on the user's specific question.
            5.  If the user's code is close, point out the area with the logical error, but don't correct it for them. Ask them to rethink that specific part.
            6.  Stay strictly on the topic of the provided LeetCode problem. If asked about anything else, politely decline.
            7.  Base your guidance on the provided problem title, description, and the user's current code.

            The user is currently working on the problem: "${problemTitle}".
        `;

        // We build a history for the model, including the system prompt.
        const history = [
            // System-level instruction
            { role: "user", parts: [{ text: systemPrompt }] },
            { role: "model", parts: [{ text: "Understood. I am a LeetCode mentor and will guide the user without providing direct solutions. Let's begin." }] },
            // Add previous conversation history
            ...chatHistory,
        ];

        // Start a new chat session with the prepared history
        const chat = model.startChat({ history });

        // Construct the user's full prompt for this turn
        const userPrompt = `
            Problem Description:
            ---
            ${problemDescription}
            ---
            My Current Code:
            ---
            ${userCode || "I haven't written any code yet."}
            ---
            My Question: "${userQuery}"
        `;

        // Send the message to the AI and get the response
        const result = await chat.sendMessage(userPrompt);
        const response = result.response;
        const text = response.text();

        res.json({ response: text });

    } catch (error) {
        console.error('Error processing chat request:', error);
        res.status(500).json({ error: 'An error occurred while communicating with the AI.' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`✅ LeetCode Mentor backend server listening at http://localhost:${port}`);
});