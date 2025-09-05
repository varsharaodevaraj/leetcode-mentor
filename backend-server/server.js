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

// --- NEW: Helper function for generating recommendations ---
async function getRecommendationsForProblem(problemTitle, problemDescription) {
    try {
        console.log("Step 1: Identifying core concept...");
        // Step 1: Identify the core concept of the problem
        const conceptPrompt = `
            Based on the LeetCode problem title "${problemTitle}" and its description, what is the single most important data structure or algorithmic concept required to solve it efficiently? 
            Respond with ONLY the name of the concept (e.g., "Hash Table", "Two Pointers", "Dynamic Programming", "Binary Search").
        `;
        const conceptResult = await model.generateContent(conceptPrompt);
        const concept = await conceptResult.response.text();
        console.log(`Concept identified: ${concept.trim()}`);

        // Step 2: Find practice problems for that concept
        console.log("Step 2: Finding practice problems...");
        const recommendationPrompt = `
            List 2-3 classic, essential LeetCode problems that are excellent for practicing the concept of "${concept.trim()}".
            Do not include the original problem "${problemTitle}".
            Provide your response as a valid JSON array of objects. Each object must have a "title" and a "url" key.
            Example format: [{"title": "Problem A", "url": "https://leetcode.com/problems/problem-a/"}]
            Respond with ONLY the JSON array and no other text or markdown.
        `;
        const recoResult = await model.generateContent(recommendationPrompt);
        const recoText = await recoResult.response.text();
        
        // Clean up the response to ensure it's valid JSON
        const jsonResponse = recoText.match(/\[.*\]/s)[0];
        const recommendations = JSON.parse(jsonResponse);
        console.log("Recommendations generated:", recommendations);
        return recommendations;

    } catch (error) {
        console.error("Error generating recommendations:", error);
        return []; // Return an empty array if anything goes wrong
    }
}


// Define the API endpoint for chat
app.post('/api/chat', async (req, res) => {
    try {
        const { problemTitle, problemDescription, userCode, userQuery, chatHistory, getRecommendations } = req.body;

        if (!userQuery) {
            return res.status(400).json({ error: 'User query is required.' });
        }

        // The system prompt is crucial for defining the AI's persona and rules.
        const systemPrompt = `
            You are an expert LeetCode programming mentor. Your goal is to help users solve problems without giving them the direct answer.
            You must adhere to the following rules:
            1.  NEVER provide the full, correct code solution.
            2.  Instead of direct answers, guide the user with Socratic questions, hints, and suggestions for debugging.
            3.  Nudge them in the right direction. Ask things like, "Have you considered what happens if the input array is empty?" or "What data structure might be efficient for lookups here?".
            4.  Keep your responses concise and focused on the user's specific question.
            5.  If the user's code is close, point out the area with the logical error, but don't correct it for them. Ask them to rethink that specific part.
            6.  Stay strictly on the topic of the provided LeetCode problem. If asked about anything else, politely decline.
            7.  Base your guidance on the provided problem title, description, and the user's current code.

            The user is currently working on the problem: "${problemTitle}".
        `;

        const history = [
            { role: "user", parts: [{ text: systemPrompt }] },
            { role: "model", parts: [{ text: "Understood. I am a LeetCode mentor and will guide the user without providing direct solutions. Let's begin." }] },
            ...chatHistory,
        ];

        const chat = model.startChat({ history });

        const userPrompt = `
            Problem Description: --- ${problemDescription} ---
            My Current Code: --- ${userCode || "I haven't written any code yet."} ---
            My Question: "${userQuery}"
        `;

        const result = await chat.sendMessage(userPrompt);
        const response = result.response;
        const text = response.text();

        let recommendations = [];
        if (getRecommendations) {
            console.log("Recommendation request received. Starting process...");
            recommendations = await getRecommendationsForProblem(problemTitle, problemDescription);
        }

        res.json({ response: text, recommendations: recommendations });

    } catch (error) {
        console.error('Error processing chat request:', error);
        res.status(500).json({ error: 'An error occurred while communicating with the AI.' });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`✅ LeetCode Mentor backend server listening at http://localhost:${port}`);
});