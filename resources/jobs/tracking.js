(function () {
  const fallbackUrl = "https://script.google.com/macros/s/AKfycbyZk304pNlxkINzWiZb7ocFFcXK-jgjrWV8csRHFOGv8A7n-I3yy9cmP4lLKZ86FEBV/exec";
  const trackingUrl = window.JOBS_BACKEND_CONFIG && window.JOBS_BACKEND_CONFIG.backendUrl
    ? window.JOBS_BACKEND_CONFIG.backendUrl
    : fallbackUrl;

  window.trackEvent = function trackEvent(event) {
    try {
      fetch(trackingUrl, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "track_event",
          ...event
        })
      }).catch(function () {});
    } catch (e) {
      console.log("Tracking failed", e);
    }
  };
})();
