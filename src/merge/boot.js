// @ts-check
// Classic script so double-click/file:// still works without module imports.
(() => {
  const script = /** @type {HTMLScriptElement} */ (document.currentScript);
  const base = new URL(".", script.src);
  const revision = new URL(script.src).search;
  /** @param {string} name */
  function load(name) {
    return new Promise((resolve, reject) => {
      const node = document.createElement("script");
      const url = new URL(name, base);
      url.search = revision;
      node.src = url.href;
      node.onload = () => resolve(undefined);
      node.onerror = () =>
        reject(new Error(`无法加载 ${name}，请检查网络后重试。`));
      document.head.append(node);
    });
  }
  async function start() {
    if (location.protocol === "file:") await load("offline-data.js");
    await load("game.js");
  }
  void start().catch((error) => {
    const message = document.getElementById("overlay-message");
    const action = document.getElementById("overlay-action");
    if (message) message.textContent = error.message;
    if (action) {
      action.hidden = false;
      action.textContent = "重新加载";
      action.onclick = () => location.reload();
    }
    document.body.dataset.state = "error";
  });
})();
