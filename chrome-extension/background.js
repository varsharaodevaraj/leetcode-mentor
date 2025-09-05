chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Listener for opening the options page
  if (request.action === "openOptionsPage") {
    chrome.runtime.openOptionsPage();
  }

  // Listener for injecting the Chart.js script
  if (request.action === "injectChartScript") {
    const tabId = sender.tab.id;
    if (tabId) {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['chart.js'],
      })
      .then(() => {
        console.log("Background script successfully injected Chart.js.");
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error("Background script failed to inject Chart.js:", err);
        sendResponse({ success: false, error: err });
      });
    }
    // Return true to indicate you wish to send a response asynchronously
    return true; 
  }
});