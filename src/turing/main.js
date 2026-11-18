(() => {
  "use strict";
  const { QUESTION_COUNT, MODELS, validateConfig, validateScenarios, drawRound, Round, boldSegments } = window.TuringCore;
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
  const CROSS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

  // Shared by the game and the local visual-review page.
  function resultMarkup(won, score) {
    if (typeof won !== "boolean" || !Number.isInteger(score) || score < 0 || score > QUESTION_COUNT) {
      throw new Error("无效的本轮结果。");
    }
    return `
        <div class="full-card result-card" data-won="${won}">
          <div class="card-content result-content"><div class="result-body">
          <p class="eyebrow">本轮挑战完成</p>
          ${won ? '<span class="result-symbol" aria-hidden="true">✓</span>' : ""}
          <h2 tabindex="-1">${won ? "恭喜！" : "就差一点！"}</h2>
          <p class="result-score">你做对了<strong>${score}</strong>道题</p>
          <p class="result-message">${won ? "请将此页面展示给工作人员领取奖励 🎉" : "再试一次吧"}</p>
          </div></div>
          <div class="card-actions"><button class="primary-button" id="play-again" type="button">再来一轮</button></div>
        </div>`;
  }

  function start(data) {
    const config = validateConfig(data?.config);
    const scenarios = validateScenarios(data?.scenarios);
    const stage = document.getElementById("stage");
    const grid = document.getElementById("progress-grid");
    const marker = document.getElementById("current-marker");
    const track = document.getElementById("progress-track");
    const caption = document.getElementById("score-caption");
    const announcement = document.getElementById("announcement");
    const celebration = window.TuringConfetti.createCelebration();
    let round = null;
    let currentScene = null;
    let transitioning = false;
    let advanceTimer = null;

    const cells = Array.from({ length: QUESTION_COUNT }, (_, index) => {
      const cell = document.createElement("li");
      cell.className = "progress-cell";
      const number = document.createElement("span");
      number.className = "progress-number";
      number.setAttribute("aria-hidden", "true");
      number.textContent = String(index + 1).padStart(2, "0");
      const symbol = document.createElement("span");
      symbol.className = "progress-symbol";
      symbol.setAttribute("aria-hidden", "true");
      cell.append(number, symbol);
      return cell;
    });
    grid.replaceChildren(...cells);

    function updateMarker() {
      const showingQuestion = round && round.phase !== "finished";
      marker.classList.toggle("is-visible", Boolean(showingQuestion));
      cells.forEach((cell, index) => {
        if (showingQuestion && index === round.index) cell.setAttribute("aria-current", "step");
        else cell.removeAttribute("aria-current");
      });
      if (!showingQuestion) return;
      const cell = cells[round.index];
      marker.style.width = `${cell.offsetWidth + 8}px`;
      marker.style.height = `${cell.offsetHeight + 8}px`;
      marker.style.transform = `translate(${cell.offsetLeft - 4}px, ${cell.offsetTop - 4}px)`;
    }

    function updateProgress() {
      cells.forEach((cell, index) => {
        const result = round?.results[index] ?? null;
        const status = result === null ? "pending" : result ? "correct" : "wrong";
        cell.dataset.result = status;
        cell.querySelector(".progress-symbol").textContent = result === null ? "?" : result ? "✓" : "×";
        cell.setAttribute("aria-label", `第 ${index + 1} 题，${result === null ? "未回答" : result ? "答对" : "答错"}`);
      });
      caption.textContent = round
        ? `还需答对 ${Math.max(0, config.k - round.score)} 题`
        : `答对 ${config.k} 题胜利`;
      updateMarker();
    }

    if (typeof ResizeObserver !== "undefined") new ResizeObserver(updateMarker).observe(track);
    else window.addEventListener("resize", updateMarker);

    function sceneFromHTML(html, full = false) {
      const scene = document.createElement("section");
      scene.className = `scene${full ? " scene--full" : ""}`;
      // Only trusted UI templates and validated numeric settings enter this HTML.
      // Prompts and model replies are always inserted through text nodes below.
      scene.innerHTML = html;
      return scene;
    }

    function welcomeScene() {
      const scene = sceneFromHTML(`
        <div class="full-card intro-card">
          <div class="card-content intro-content">
          <h2 tabindex="-1">你能认出回答背后的 AI 吗？</h2>
          <ol class="rules" aria-label="游戏规则">
            <li><span class="rule-number" aria-hidden="true">01</span><span>给出对话场景，并展示AI的回答。</span></li>
            <li><span class="rule-number" aria-hidden="true">02</span><span>阅读对话，猜猜写这个回答的是哪家AI。</span></li>
            <li><span class="rule-number" aria-hidden="true">03</span><span>10题中答对${config.k}题，即可领取奖励。</span></li>
          </ol>
          </div>
          <div class="card-actions"><button class="primary-button" id="start-round" type="button">开始挑战</button></div>
        </div>`, true);
      scene.querySelector("button").addEventListener("click", beginRound);
      return scene;
    }

    function appendAnswer(container, text) {
      for (const paragraph of text.split(/\n\s*\n/)) {
        if (!paragraph.trim()) continue;
        const p = document.createElement("p");
        for (const part of boldSegments(paragraph)) {
          if (part.bold) {
            const strong = document.createElement("strong");
            strong.textContent = part.text;
            p.append(strong);
          } else p.append(document.createTextNode(part.text));
        }
        container.append(p);
      }
    }

    function questionScene() {
      const question = round.current;
      const scene = sceneFromHTML(`
        <article class="dialogue-card" aria-labelledby="question-heading">
          <header class="card-heading"><h2 id="question-heading" tabindex="-1">第 ${String(round.index + 1).padStart(2, "0")} 题 / 10</h2><span class="question-hint">猜猜是谁在回答</span></header>
          <div class="conversation" tabindex="0" role="region" aria-label="当前题目和 AI 回答，可上下滚动阅读">
            <p class="speaker">你问</p><p class="prompt"></p>
            <p class="speaker">AI 回答</p><div class="answer"></div>
          </div>
        </article>
        <div class="choices" role="group" aria-label="这段回答来自哪个模型？"></div>`);
      scene.querySelector(".prompt").textContent = question.prompt;
      appendAnswer(scene.querySelector(".answer"), question.answer);
      for (const model of question.options) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "choice";
        button.dataset.model = model;
        const label = document.createElement("span");
        label.className = "choice-label";
        label.textContent = MODELS[model];
        const result = document.createElement("span");
        result.className = "choice-result";
        result.setAttribute("aria-hidden", "true");
        button.append(label, result);
        button.addEventListener("click", () => choose(model, button));
        scene.querySelector(".choices").append(button);
      }
      return scene;
    }

    function resultScene() {
      const won = round.won(config.k);
      const scene = sceneFromHTML(resultMarkup(won, round.score), true);
      scene.querySelector("button").addEventListener("click", returnToWelcome);
      return scene;
    }

    async function transitionTo(next, state) {
      transitioning = true;
      document.body.dataset.state = "transitioning";
      const previous = currentScene;
      next.classList.add("is-entering");
      next.inert = true;
      next.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      if (previous) previous.inert = true;
      stage.append(next);
      updateProgress();
      const duration = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 460;
      const timing = { duration, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both" };
      const animations = [next.animate([
        { transform: "translateX(calc(100% + 24px))", opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ], timing)];
      if (previous) animations.push(previous.animate([
        { transform: "translateX(0)", opacity: 1 },
        { transform: "translateX(calc(-100% - 24px))", opacity: 0 },
      ], timing));
      await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
      previous?.remove();
      next.classList.remove("is-entering");
      animations.forEach((animation) => animation.cancel());
      next.inert = false;
      next.querySelectorAll("button").forEach((button) => { button.disabled = false; });
      currentScene = next;
      transitioning = false;
      document.body.dataset.state = state;
      if (state === "result" && round.won(config.k)) celebration.start();
      next.querySelector("h2")?.focus({ preventScroll: true });
    }

    function beginRound() {
      if (transitioning) return;
      celebration.stop();
      clearTimeout(advanceTimer);
      round = new Round(drawRound(scenarios));
      announcement.textContent = "新一轮开始，共 10 道题。";
      void transitionTo(questionScene(), "question");
    }

    function returnToWelcome() {
      if (transitioning) return;
      celebration.stop();
      clearTimeout(advanceTimer);
      advanceTimer = null;
      round = null;
      announcement.textContent = "已返回开始页，点击开始挑战开启新一轮。";
      void transitionTo(welcomeScene(), "welcome");
    }

    function choose(model, button) {
      if (transitioning || !round) return;
      const verdict = round.choose(model);
      if (!verdict) return;
      document.body.dataset.state = "feedback";
      currentScene.querySelectorAll(".choice").forEach((choice) => { choice.disabled = true; });
      currentScene.querySelector(".choices").classList.add("is-answered");
      button.classList.add("is-selected", verdict.correct ? "is-correct" : "is-wrong");
      const feedback = verdict.correct ? "答对了" : "猜错了";
      button.querySelector(".choice-result").innerHTML = verdict.correct ? CHECK : CROSS;
      button.setAttribute("aria-label", `${MODELS[model]}，${feedback}`);
      currentScene.querySelector(".dialogue-card").dataset.verdict = verdict.correct ? "correct" : "wrong";
      currentScene.querySelector(".question-hint").textContent = round.index === 9 ? "即将查看结果" : "即将进入下一题";
      announcement.textContent = `第 ${round.index + 1} 题${feedback}。目前答对 ${round.score} 题。`;
      updateProgress();
      advanceTimer = setTimeout(() => {
        if (!round.advance()) return;
        if (round.phase === "finished") {
          announcement.textContent = `本轮答对 ${round.score} 道题。${round.won(config.k) ? "恭喜获胜，请展示页面领取奖励。" : "再试一次吧。"}`;
          void transitionTo(resultScene(), "result");
        } else void transitionTo(questionScene(), "question");
      }, config.s * 1000);
    }

    currentScene = welcomeScene();
    stage.replaceChildren(currentScene);
    stage.setAttribute("aria-busy", "false");
    document.body.dataset.state = "welcome";
    updateProgress();
  }

  window.TuringGame = Object.freeze({ start, resultMarkup });
})();
