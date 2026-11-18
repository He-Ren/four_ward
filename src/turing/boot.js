(() => {
  "use strict";
  const source = new URL(document.currentScript.src);
  const base = new URL(".", source);
  const revision = source.search;

  function loadScript(name) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const url = new URL(name, base);
      url.search = revision;
      script.src = url.href;
      script.onload = resolve;
      script.onerror = () => reject(new Error("游戏文件加载失败，请重新打开页面。"));
      document.head.append(script);
    });
  }

  async function loadJSON(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-cache" });
      if (!response.ok) throw new Error(`题库或配置加载失败（${response.status}）。`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function showError(error) {
    const card = document.createElement("section");
    card.className = "scene scene--full";
    const content = document.createElement("div");
    content.className = "full-card loading-card";
    const title = document.createElement("h2");
    title.textContent = "暂时没能开始";
    const message = document.createElement("p");
    message.textContent = error?.message || "请检查游戏文件是否完整，然后重试。";
    const retry = document.createElement("button");
    retry.className = "primary-button";
    retry.textContent = "重新加载";
    retry.onclick = () => location.reload();
    content.append(title, message, retry);
    card.append(content);
    const stage = document.getElementById("stage");
    stage.replaceChildren(card);
    stage.setAttribute("aria-busy", "false");
    document.body.dataset.state = "error";
  }

  async function boot() {
    if (location.protocol === "file:") {
      await loadScript("offline-data.js");
    } else {
      const configPath = new URLSearchParams(location.search).get("config") || "config/turing/default.json";
      const [config, scenarios] = await Promise.all([
        loadJSON(new URL(configPath, location.href)),
        loadJSON(new URL("assets/turing/scenarios.json", location.href)),
      ]);
      window.TuringData = { config, scenarios };
    }
    await loadScript("core.js");
    await loadScript("main.js");
    window.TuringGame.start(window.TuringData);
  }

  void boot().catch(showError);
})();
