(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ── State ──────────────────────────────────────
  let isOpen = false;
  let isStreaming = false;
  let messages = [];
  let apiConfigured = false;

  // ── DOM refs ───────────────────────────────────
  const bubble = $("#aiChatBubble");
  const panel = $("#aiChatPanel");
  const msgContainer = $("#aiChatMessages");
  const input = $("#aiChatInput");
  const sendBtn = $("#aiChatSend");
  const welcome = $("#aiChatWelcome");

  // ── API Key management ─────────────────────────
  function getStoredKey() {
    try { return localStorage.getItem("stockquant_ai_key") || ""; } catch (e) { return ""; }
  }
  function setStoredKey(key) {
    try { localStorage.setItem("stockquant_ai_key", key); } catch (e) { /* */ }
  }

  // ── Check AI status ────────────────────────────
  async function checkStatus() {
    try {
      const resp = await fetch("/api/ai/status", {
        headers: { "x-api-key": getStoredKey() },
      });
      const data = await resp.json();
      apiConfigured = data.configured;
      if (apiConfigured) {
        bubble.style.display = "flex";
      } else {
        // Still show bubble so user can set key
        bubble.style.display = "flex";
      }
    } catch (e) {
      apiConfigured = false;
      bubble.style.display = "flex";
    }
  }

  // ── Toggle panel ───────────────────────────────
  function openPanel() {
    isOpen = true;
    panel.style.display = "flex";
    input.focus();
    if (!apiConfigured && !getStoredKey()) {
      showSettingsModal();
    }
  }
  function closePanel() {
    isOpen = false;
    panel.style.display = "none";
  }
  bubble.addEventListener("click", () => {
    if (isOpen) closePanel();
    else openPanel();
  });
  $("#btnAIClose").addEventListener("click", closePanel);

  // ── Settings modal ─────────────────────────────
  function showSettingsModal() {
    const overlay = document.createElement("div");
    overlay.className = "ai-settings-overlay";
    overlay.id = "aiSettingsOverlay";

    const serverKeyNote = apiConfigured
      ? '<div class="ai-server-note">✓ 服务器已配置全局 API Key（无需手动填写）</div>'
      : "";

    overlay.innerHTML = `
      <div class="ai-settings-card">
        <h3>⚙️ 设置 API Key</h3>
        <p>使用 MiMo AI 需要 Xiaomi MiMo API Key。<br>
          在 <a href="https://platform.xiaomimimo.com/" target="_blank" style="color:#a5b4fc;">platform.xiaomimimo.com</a> 注册获取。</p>
        <input type="password" id="aiKeyInput" placeholder="输入你的 MiMo API Key..." value="${escapeHTML(getStoredKey())}" />
        ${serverKeyNote}
        <div class="ai-settings-actions">
          <button class="ai-btn-ghost" id="btnClearKey">清除</button>
          <button class="ai-btn-ghost" id="btnCancelSettings">取消</button>
          <button class="ai-btn-primary" id="btnSaveKey">保存</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const keyInput = $("#aiKeyInput");
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    $("#btnCancelSettings").addEventListener("click", () => overlay.remove());
    $("#btnClearKey").addEventListener("click", () => {
      setStoredKey("");
      keyInput.value = "";
      apiConfigured = false;
    });
    $("#btnSaveKey").addEventListener("click", async () => {
      const key = keyInput.value.trim();
      if (key) setStoredKey(key);
      else setStoredKey("");
      overlay.remove();
      await checkStatus();
      if (apiConfigured) {
        addSystemMsg("✅ API Key 已保存，AI 助手已就绪");
        if (welcome) welcome.style.display = "none";
      }
    });
  }

  $("#btnAISettings").addEventListener("click", showSettingsModal);

  // ── Message rendering ──────────────────────────
  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function scrollToBottom() {
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }

  function addSystemMsg(text) {
    const div = document.createElement("div");
    div.className = "ai-msg ai-msg-error";
    div.textContent = text;
    msgContainer.appendChild(div);
    scrollToBottom();
  }

  function addUserMsg(text) {
    if (welcome) welcome.style.display = "none";
    const div = document.createElement("div");
    div.className = "ai-msg ai-msg-user";
    div.innerHTML = escapeHTML(text).replace(/\n/g, "<br>");
    msgContainer.appendChild(div);
    messages.push({ role: "user", content: text });
    scrollToBottom();
  }

  function createAIMsgBubble() {
    if (welcome) welcome.style.display = "none";
    const div = document.createElement("div");
    div.className = "ai-msg ai-msg-ai";
    div.innerHTML = '<div class="ai-typing"><span></span><span></span><span></span></div>';
    msgContainer.appendChild(div);
    scrollToBottom();
    return div;
  }

  function finalizeAIMsg(bubble, text) {
    bubble.querySelector(".ai-typing")?.remove();
    // Simple markdown: bold, line breaks
    const html = escapeHTML(text)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\n/g, "<br>");
    bubble.innerHTML = html;
    messages.push({ role: "assistant", content: text });
  }

  function showErrorInBubble(bubble, errorText) {
    bubble.querySelector(".ai-typing")?.remove();
    bubble.className = "ai-msg ai-msg-error";
    bubble.textContent = "❌ " + errorText;
  }

  // ── SSE streaming ──────────────────────────────
  async function sendMessage(text) {
    if (isStreaming) return;
    if (!text.trim()) return;

    const apiKey = getStoredKey();
    if (!apiKey && !apiConfigured) {
      addSystemMsg("请先设置 API Key：点击聊天框右上角 ⚙️ 图标");
      return;
    }

    isStreaming = true;
    sendBtn.disabled = true;
    input.value = "";
    input.style.height = "auto";

    addUserMsg(text);

    const aiBubble = createAIMsgBubble();
    let fullText = "";

    try {
      const resp = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": getStoredKey(),
        },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-8),
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        showErrorInBubble(aiBubble, errData.error || `请求失败 (HTTP ${resp.status})`);
        isStreaming = false;
        sendBtn.disabled = false;
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const chunk = JSON.parse(line.slice(6));
              if (chunk.type === "delta") {
                fullText += chunk.text;
                // Update bubble in real-time
                const html = escapeHTML(fullText)
                  .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
                  .replace(/\n/g, "<br>");
                aiBubble.innerHTML = html + '<span class="ai-typing-cursor" style="display:inline-block;width:2px;height:14px;background:#6366f1;animation:blink .6s infinite;vertical-align:middle;margin-left:1px;"></span>';
                scrollToBottom();
              } else if (chunk.type === "done") {
                fullText = chunk.fullText || fullText;
              } else if (chunk.type === "error") {
                showErrorInBubble(aiBubble, chunk.error);
                isStreaming = false;
                sendBtn.disabled = false;
                return;
              }
            } catch (e) { /* skip unparseable lines */ }
          }
        }
      }

      finalizeAIMsg(aiBubble, fullText);
    } catch (e) {
      showErrorInBubble(aiBubble, "网络连接异常，请稍后重试");
    }

    isStreaming = false;
    sendBtn.disabled = false;
    input.focus();
  }

  // ── Input handling ─────────────────────────────
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input.value);
    }
  });

  // Auto-resize textarea
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
  });

  sendBtn.addEventListener("click", () => sendMessage(input.value));

  // ── Hint buttons ───────────────────────────────
  msgContainer.addEventListener("click", (e) => {
    const hintBtn = e.target.closest(".ai-hint-btn");
    if (!hintBtn) return;

    if (!apiConfigured && !getStoredKey()) {
      addSystemMsg("请先设置 API Key：点击聊天框右上角 ⚙️ 图标");
      return;
    }
    sendMessage(hintBtn.dataset.hint);
  });

  // ── Keyboard: Esc to close ─────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen) {
      closePanel();
    }
    // Ctrl+K to open chat (like other AI tools)
    if ((e.ctrlKey || e.metaKey) && e.key === "k" && !isOpen) {
      e.preventDefault();
      openPanel();
    }
  });

  // ── Startup ────────────────────────────────────
  checkStatus();

  // Expose for external use (e.g., trigger from other pages)
  window.AIChat = { open: openPanel, close: closePanel, send: sendMessage };
})();
