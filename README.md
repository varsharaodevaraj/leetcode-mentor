# LeetCode AI Mentor 🤖

![Project Status](https://img.shields.io/badge/status-complete-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Technology](https://img.shields.io/badge/tech-JavaScript-yellow)

An intelligent Chrome extension that acts as a personal coding mentor on LeetCode problem pages. It provides contextual hints and tracks user progress to create a personalized, data-driven study plan.

---

![LeetCode AI Mentor Demo](https-user-images.githubusercontent.com/your-username/your-repo/your-demo.gif)
*(**Suggestion:** Record a short GIF of the extension in action and replace the link above. Tools like Giphy Capture or Kap are great for this.)*

##  Core Features

* **Contextual AI Mentor:** Provides Socratic-style hints for LeetCode problems using the Google Gemini API without revealing the direct solution.
* **Persistent Chat History:** Remembers your conversation for each specific problem, even after refreshing or navigating away.
* **Personalized Review List:** Automatically captures AI-recommended problems when you're stuck, consolidates them by topic into a collapsible UI, and allows you to "Mark as Done."
* **Data-Driven Analytics Dashboard:**
    * **Mastery Score:** Visualizes your overall proficiency with a dynamic donut chart.
    * **Skills Breakdown:** Displays your strengths and weaknesses with gradient-colored skill tags.
* **Secure & Serverless:** Built on a "Bring Your Own Key" (BYOK) model, ensuring user privacy and infinite scalability with zero backend costs.
* **Polished UI:** Features a custom floating button, a draggable tabbed interface, and a seamless onboarding experience for new users.

## 🛠️ Tech Stack & Architecture

* **Frontend:** JavaScript (ES6+), HTML5, CSS3
* **Extension Framework:** Chrome Extension APIs (Manifest V3)
* **Core APIs:** `chrome.storage`, `chrome.scripting`, `chrome.runtime`
* **AI:** Google Gemini API
* **Data Visualization:** Chart.js
* **Architecture:** The extension is fully **serverless**. It operates on a **"Bring Your Own Key" (BYOK)** model where all logic runs on the client-side. The content script interacts with the LeetCode DOM, the background script handles privileged operations, and all data is securely stored in the user's local browser storage.

##  Getting Started

To run this extension locally on your machine, follow these steps:

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/your-username/leetcode-ai-mentor.git](https://github.com/your-username/leetcode-ai-mentor.git)
    ```

2.  **Navigate to the `chrome-extension` directory.** This folder contains the complete, unpacked extension.

3.  **Open Chrome and go to the Extensions page:**
    * You can paste this into your address bar: `chrome://extensions`

4.  **Enable Developer Mode:**
    * Find the "Developer mode" toggle in the top-right corner and turn it on.

5.  **Load the Extension:**
    * Click the **"Load unpacked"** button.
    * Select the `chrome-extension` folder from this project on your local machine.

## ⚙️ Configuration

The extension requires you to provide your own Google Gemini API key to function.

1.  **Get a Gemini API Key:**
    * Visit [Google AI Studio](https://aistudio.google.com/app/apikey).
    * Click on **"Create API key"**.

2.  **Set the Key in the Extension:**
    * Once the extension is loaded, click the Extensions icon (puzzle piece) in your Chrome toolbar.
    * Find "LeetCode AI Mentor" and click the three-dots menu (⋮).
    * Select **"Options"**.
    * Paste your API key into the input field and click **"Save Key"**.

The extension is now ready to use! Navigate to any LeetCode problem page to see the "SUPPORT BOT" button appear.

## 📄 License

This project is licensed under the MIT License. See the `LICENSE` file for details.
