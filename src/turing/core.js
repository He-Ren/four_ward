// Classic script: usable from file:// without modules or dependencies.
(() => {
  "use strict";

  const QUESTION_COUNT = 10;
  const MODELS = Object.freeze({ gpt: "GPT", deepseek: "DeepSeek", doubao: "豆包" });
  const MODEL_IDS = Object.freeze(Object.keys(MODELS));

  function validateConfig(value) {
    if (!value || !Number.isInteger(value.k) || value.k < 0 || value.k > QUESTION_COUNT) {
      throw new Error("配置中的 k 必须是 0 到 10 之间的整数。");
    }
    if (typeof value.s !== "number" || !Number.isFinite(value.s) || value.s < 0 || value.s > 60) {
      throw new Error("配置中的 s 必须是 0 到 60 之间的秒数。");
    }
    return Object.freeze({ k: value.k, s: value.s });
  }

  function validateScenarios(value) {
    if (!Array.isArray(value) || value.length < QUESTION_COUNT) {
      throw new Error("题库至少需要 10 道题。");
    }
    const prompts = new Set();
    for (const [index, scene] of value.entries()) {
      if (typeof scene?.prompt !== "string" || !scene.prompt.trim() || prompts.has(scene.prompt)) {
        throw new Error(`第 ${index + 1} 题的题目为空或与其他题重复。`);
      }
      prompts.add(scene.prompt);
      for (const model of MODEL_IDS) {
        if (typeof scene.responses?.[model] !== "string" || !scene.responses[model].trim()) {
          throw new Error(`第 ${index + 1} 题缺少 ${MODELS[model]} 的回答正文。`);
        }
      }
    }
    return value;
  }

  function shuffle(values, random = Math.random) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [result[index], result[other]] = [result[other], result[index]];
    }
    return result;
  }

  function drawRound(scenes, random = Math.random) {
    validateScenarios(scenes);
    return shuffle(scenes.map((_, index) => index), random)
      .slice(0, QUESTION_COUNT)
      .map((sceneIndex) => {
        const scene = scenes[sceneIndex];
        const correctModel = MODEL_IDS[Math.floor(random() * MODEL_IDS.length)];
        const others = MODEL_IDS.filter((model) => model !== correctModel);
        const wrongModel = others[Math.floor(random() * others.length)];
        return {
          sceneIndex,
          prompt: scene.prompt,
          answer: scene.responses[correctModel],
          correctModel,
          options: shuffle([correctModel, wrongModel], random),
        };
      });
  }

  class Round {
    constructor(questions) {
      if (questions.length !== QUESTION_COUNT) throw new Error("每轮必须有 10 道题。");
      this.questions = questions;
      this.index = 0;
      this.results = Array(QUESTION_COUNT).fill(null);
      this.phase = "question";
    }

    get current() { return this.questions[this.index]; }
    get score() { return this.results.filter((result) => result === true).length; }

    choose(model) {
      if (this.phase !== "question" || !this.current.options.includes(model)) return null;
      const correct = model === this.current.correctModel;
      this.results[this.index] = correct;
      this.phase = "feedback";
      return { correct, model };
    }

    advance() {
      if (this.phase !== "feedback") return false;
      this.index++;
      this.phase = this.index === QUESTION_COUNT ? "finished" : "question";
      return true;
    }

    won(k) { return this.phase === "finished" && this.score >= k; }
  }

  // A deliberately small renderer: HTML and all other markup stay literal text.
  function boldSegments(text) {
    const parts = [];
    const pattern = /\*\*(?=\S)([\s\S]*?\S)\*\*/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), bold: false });
      parts.push({ text: match[1], bold: true });
      cursor = match.index + match[0].length;
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), bold: false });
    return parts;
  }

  globalThis.TuringCore = Object.freeze({
    QUESTION_COUNT, MODELS, MODEL_IDS, validateConfig, validateScenarios,
    drawRound, Round, boldSegments,
  });
})();
