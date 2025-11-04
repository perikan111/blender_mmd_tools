import { CreateMLCEngine } from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.1.16/dist/index.min.js";

const WORKER_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.1.16/dist/worker.js";
const DEFAULT_SYSTEM_PROMPT = "あなたは有能な日本語アシスタントです。簡潔かつ丁寧に回答してください。";
const AVAILABLE_MODELS = [
  { id: "Phi-2-q4f16_1", label: "Phi-2 (2.7B) - 4bit" },
  { id: "TinyLlama-1.1B-Chat-v1.0-q4f16_1", label: "TinyLlama 1.1B Chat - 4bit" },
  { id: "Qwen1.5-0.5B-Chat-q4f16_1", label: "Qwen1.5 0.5B Chat - 4bit" },
  { id: "Llama-3-8B-Instruct-q4f32_1", label: "Llama 3 8B Instruct - 4bit" }
];

const dom = {
  modelSelect: document.getElementById("model-select"),
  systemPrompt: document.getElementById("system-prompt"),
  gpuStatus: document.getElementById("gpu-status"),
  modelStatus: document.getElementById("model-status"),
  modelProgress: document.getElementById("model-progress"),
  chatLog: document.getElementById("chat-log"),
  chatForm: document.getElementById("chat-form"),
  userInput: document.getElementById("user-input"),
  sendButton: document.getElementById("send-button"),
  stopButton: document.getElementById("stop-button"),
  downloadButton: document.getElementById("download-model"),
  clearHistoryButton: document.getElementById("clear-history"),
};

let engine = null;
let currentModelId = AVAILABLE_MODELS[0].id;
let abortController = null;
let isLoadingModel = false;
const conversation = [];

function appendMessage(role, content) {
  const li = document.createElement("li");
  li.classList.add("message", role);

  const roleLabel = document.createElement("span");
  roleLabel.className = "role";
  roleLabel.textContent = role === "user" ? "あなた" : role === "assistant" ? "アシスタント" : "システム";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = content;

  li.append(roleLabel, bubble);
  dom.chatLog.appendChild(li);
  dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
  return bubble;
}

function clearMessages() {
  dom.chatLog.innerHTML = "";
}

function setUIState({ busy, modelLoading }) {
  const disabled = busy || modelLoading;
  dom.userInput.disabled = disabled;
  dom.sendButton.disabled = disabled;
  dom.stopButton.disabled = !busy;
  dom.modelSelect.disabled = modelLoading;
  dom.downloadButton.disabled = modelLoading;
  dom.clearHistoryButton.disabled = modelLoading;
  isLoadingModel = modelLoading;
}

function updateGPUStatus() {
  if (!navigator.gpu) {
    dom.gpuStatus.textContent = "WebGPU 未対応のブラウザです。対応ブラウザでアクセスしてください。";
    setUIState({ busy: false, modelLoading: true });
    dom.modelStatus.textContent = "";
    dom.modelProgress.hidden = true;
    return false;
  }
  dom.gpuStatus.textContent = "WebGPU 利用可能";
  return true;
}

async function initEngine(modelId, { forceReload = false } = {}) {
  if (!updateGPUStatus()) {
    return;
  }
  if (engine) {
    try {
      await engine?.dispose?.();
    } catch (err) {
      console.warn("failed to dispose previous engine", err);
    }
    engine = null;
  }

  setUIState({ busy: false, modelLoading: true });
  dom.modelProgress.value = 0;
  dom.modelProgress.hidden = false;
  dom.modelStatus.textContent = forceReload
    ? "モデルを再読み込みしています..."
    : "モデルを初期化しています...";

  const worker = new Worker(WORKER_URL, { type: "module" });
  try {
    engine = await CreateMLCEngine(worker, {
      model: modelId,
      progress_callback: ({ progress, time, text }) => {
        dom.modelProgress.value = progress;
        dom.modelStatus.textContent = text ?? `ダウンロード中... ${(progress * 100).toFixed(1)}%`;
      },
      app_config: {
        log_level: "info",
      },
    });
  } catch (error) {
    console.error(error);
    dom.modelStatus.textContent = "モデルの初期化に失敗しました。";
    dom.modelProgress.hidden = true;
    setUIState({ busy: false, modelLoading: false });
    throw error;
  }

  dom.modelStatus.textContent = `モデル '${modelId}' を利用可能です。`;
  dom.modelProgress.hidden = true;
  setUIState({ busy: false, modelLoading: false });
  currentModelId = modelId;
  resetConversation();
}

function resetConversation() {
  conversation.length = 0;
  const systemPrompt = dom.systemPrompt.value.trim() || DEFAULT_SYSTEM_PROMPT;
  conversation.push({ role: "system", content: systemPrompt });
  clearMessages();
  appendMessage("system", systemPrompt);
}

async function sendMessage(userContent) {
  if (!engine || isLoadingModel) {
    return;
  }
  const trimmed = userContent.trim();
  if (!trimmed) {
    return;
  }

  dom.userInput.value = "";
  conversation.push({ role: "user", content: trimmed });
  appendMessage("user", trimmed);

  const assistantBubble = appendMessage("assistant", "");
  setUIState({ busy: true, modelLoading: false });

  abortController = new AbortController();
  let assembled = "";
  try {
    const stream = await engine.chat.completions.create({
      messages: conversation,
      stream: true,
      temperature: 0.7,
      max_tokens: 1024,
      signal: abortController.signal,
    });
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        assembled += delta;
        assistantBubble.textContent = assembled;
        dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      assistantBubble.textContent = assembled || "(生成を中断しました)";
    } else {
      console.error(error);
      assistantBubble.textContent = "応答中にエラーが発生しました。コンソールを確認してください。";
    }
  } finally {
    if (assembled.trim()) {
      conversation.push({ role: "assistant", content: assembled.trim() });
    }
    setUIState({ busy: false, modelLoading: false });
    abortController = null;
  }
}

function populateModelOptions() {
  for (const model of AVAILABLE_MODELS) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    dom.modelSelect.appendChild(option);
  }
  dom.modelSelect.value = currentModelId;
}

function setupEventListeners() {
  dom.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage(dom.userInput.value);
  });

  dom.stopButton.addEventListener("click", () => {
    abortController?.abort();
  });

  dom.modelSelect.addEventListener("change", async (event) => {
    const modelId = event.target.value;
    if (modelId === currentModelId && engine) {
      return;
    }
    await initEngine(modelId);
  });

  dom.downloadButton.addEventListener("click", async () => {
    await initEngine(currentModelId, { forceReload: true });
  });

  dom.clearHistoryButton.addEventListener("click", () => {
    resetConversation();
  });

  dom.systemPrompt.addEventListener("change", () => {
    resetConversation();
  });
}

async function main() {
  populateModelOptions();
  dom.systemPrompt.value = DEFAULT_SYSTEM_PROMPT;
  setupEventListeners();
  updateGPUStatus();
  await initEngine(currentModelId);
}

main().catch((error) => {
  console.error("初期化中にエラーが発生しました", error);
  dom.modelStatus.textContent = "初期化に失敗しました。ページを再読み込みしてください。";
  setUIState({ busy: false, modelLoading: false });
});
