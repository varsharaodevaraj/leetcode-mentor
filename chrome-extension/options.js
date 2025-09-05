function save_options() {
  const apiKey = document.getElementById('apiKey').value;
  chrome.storage.local.set({ geminiApiKey: apiKey }, function() {
    const status = document.getElementById('status');
    status.textContent = 'API Key saved successfully!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
}

function restore_options() {
  chrome.storage.local.get(['geminiApiKey'], function(items) {
    document.getElementById('apiKey').value = items.geminiApiKey || '';
  });
}

// UPDATED: Function to reset all stored data, including chat histories
function reset_data() {
    if (confirm("Are you sure you want to delete all your saved data? This includes all analytics, review lists, AND chat histories. This cannot be undone.")) {
        // Get all keys from local storage
        chrome.storage.local.get(null, function(items) {
            const keysToRemove = [];
            // Find all keys related to our extension (analytics, review, cache, and all chats)
            for (const key in items) {
                if (key.startsWith('chatHistory_') || key === 'solvedProblems' || key === 'reviewList' || key === 'topicCache') {
                    keysToRemove.push(key);
                }
            }

            // Remove the identified keys
            chrome.storage.local.remove(keysToRemove, function() {
                const status = document.getElementById('reset-status');
                status.textContent = 'All extension data has been reset.';
                console.log('Cleared keys:', keysToRemove);
                setTimeout(() => { status.textContent = ''; }, 3000);
            });
        });
    }
}


document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('save').addEventListener('click', save_options);
document.getElementById('reset-data').addEventListener('click', reset_data);