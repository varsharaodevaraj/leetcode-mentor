// Import necessary packages
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Initialize the Express app
const app = express();
const port = 3000;

// Apply middleware
app.use(cors());
app.use(express.json());

// Initialize the Google Generative AI client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

async function getRecommendationsForProblem(problemTitle) {
    try {
        console.log("Step 1: Identifying core concept...");
        const conceptPrompt = `
            Based on the LeetCode problem title "${problemTitle}", what is the single most important data structure or algorithmic concept required to solve it efficiently? 
            Respond with ONLY the name of the concept (e.g., "Hash Table", "Two Pointers", "Dynamic Programming", "Binary Search").
        `;
        const conceptResult = await model.generateContent(conceptPrompt);
        const concept = (await conceptResult.response.text()).trim();
        console.log(`Concept identified: ${concept}`);

        console.log("Step 2: Finding practice problems...");
        const recommendationPrompt = `
            List 2-3 classic, essential LeetCode problems that are excellent for practicing the concept of "${concept}".
            Do not include the original problem "${problemTitle}".
            Provide your response as a valid JSON array of objects. Each object must have a "title" and a "url" key.
            Example format: [{"title": "Problem A", "url": "https://leetcode.com/problems/problem-a/"}]
            Respond with ONLY the JSON array and no other text or markdown.
        `;
        const recoResult = await model.generateContent(recommendationPrompt);
        const recoText = await recoResult.response.text();
        
        const jsonMatch = recoText.match(/\[.*\]/s);
        if (!jsonMatch) throw new Error("Could not parse recommendation JSON from AI response.");
        
        const recommendations = JSON.parse(jsonMatch[0]);
        console.log("Recommendations generated:", recommendations);

        // --- NEW: Return the concept along with the recommendations ---
        return { concept, recommendations };

    } catch (error) {
        console.error("Error generating recommendations:", error);
        return { concept: "General", recommendations: [] }; // Fallback
    }
}

app.post('/api/chat', async (req, res) => {
    try {
        const { problemTitle, problemDescription, userCode, userQuery, chatHistory, getRecommendations } = req.body;

        if (!userQuery) {
            return res.status(400).json({ error: 'User query is required.' });
        }

        const systemPrompt = `
            You are an expert LeetCode programming mentor. Your goal is to help users solve problems without giving them the direct answer.
            You must adhere to the following rules:
            1.  NEVER provide the full, correct code solution.
            2.  Guide the user with Socratic questions, hints, and suggestions for debugging.
            3.  Nudge them in the right direction. Ask things like, "Have you considered what happens if the input array is empty?".
            4.  Stay strictly on the topic of the provided LeetCode problem.
        `;

        const history = [
            { role: "user", parts: [{ text: systemPrompt }] },
            { role: "model", parts: [{ text: "Understood. I am a LeetCode mentor and will guide the user without providing direct solutions." }] },
            ...chatHistory,
        ];

        const chat = model.startChat({ history });
        const userPrompt = `
            Problem Description: --- ${problemDescription} ---
            My Current Code: --- ${userCode || "I haven't written any code yet."} ---
            My Question: "${userQuery}"
        `;

        const result = await chat.sendMessage(userPrompt);
        const text = result.response.text();

        let recommendationData = { concept: null, recommendations: [] };
        if (getRecommendations) {
            console.log("Recommendation request received. Starting process...");
            recommendationData = await getRecommendationsForProblem(problemTitle);
        }
        
        // --- UPDATED: Send back the full recommendation data object ---
        res.json({ response: text, recommendationData });

    } catch (error) {
        console.error('Error processing chat request:', error);
        res.status(500).json({ error: 'An error occurred while communicating with the AI.' });
    }
});

app.listen(port, () => {
    console.log(`✅ LeetCode Mentor backend server listening at http://localhost:${port}`);
});