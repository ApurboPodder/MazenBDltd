(() => {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  window.addEventListener("load", () => {
    const workerUrl = new URL("service-worker.js", document.baseURI);
    const scopeUrl = new URL(".", document.baseURI);
    navigator.serviceWorker.register(workerUrl.href, { scope: scopeUrl.pathname })
      .catch((error) => console.warn("The app could not enable offline caching", error));
  }, { once: true });
})();
