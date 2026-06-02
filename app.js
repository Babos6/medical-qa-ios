const DB_NAME = "medical-qa-pwa";
const DB_VERSION = 1;
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

const els = {
  statusLine: document.querySelector("#statusLine"),
  settingsButton: document.querySelector("#settingsButton"),
  libraryButton: document.querySelector("#libraryButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  libraryPanel: document.querySelector("#libraryPanel"),
  deepseekKeyInput: document.querySelector("#deepseekKeyInput"),
  modelInput: document.querySelector("#modelInput"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  clearSettingsButton: document.querySelector("#clearSettingsButton"),
  pdfInput: document.querySelector("#pdfInput"),
  indexButton: document.querySelector("#indexButton"),
  refreshButton: document.querySelector("#refreshButton"),
  progress: document.querySelector("#progress"),
  progressBar: document.querySelector("#progressBar"),
  bookList: document.querySelector("#bookList"),
  questionInput: document.querySelector("#questionInput"),
  useDeepseekInput: document.querySelector("#useDeepseekInput"),
  searchButton: document.querySelector("#searchButton"),
  askButton: document.querySelector("#askButton"),
  busyText: document.querySelector("#busyText"),
  answerBox: document.querySelector("#answerBox"),
  citationList: document.querySelector("#citationList"),
  citationCount: document.querySelector("#citationCount"),
  bookTemplate: document.querySelector("#bookTemplate"),
  citationTemplate: document.querySelector("#citationTemplate"),
};

let db;

main().catch((error) => showError(error));

async function main() {
  db = await openDb();
  await loadSettings();
  await refreshLibrary();
  bindEvents();
  registerServiceWorker();
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("books")) {
        database.createObjectStore("books", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains("chunks")) {
        const chunks = database.createObjectStore("chunks", {
          keyPath: "id",
          autoIncrement: true,
        });
        chunks.createIndex("bookId", "bookId", { unique: false });
      }
      if (!database.objectStoreNames.contains("settings")) {
        database.createObjectStore("settings", { keyPath: "key" });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function tx(storeNames, mode = "readonly") {
  const transaction = db.transaction(storeNames, mode);
  return storeNames.map((name) => transaction.objectStore(name));
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const [store] = tx([storeName]);
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

function getSetting(key) {
  return new Promise((resolve, reject) => {
    const [store] = tx(["settings"]);
    const request = store.get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.value || "");
  });
}

function putSetting(key, value) {
  return new Promise((resolve, reject) => {
    const [store] = tx(["settings"], "readwrite");
    const request = store.put({ key, value });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

async function loadSettings() {
  const apiKey = await getSetting("deepseekApiKey");
  const model = (await getSetting("deepseekModel")) || "deepseek-v4-flash";
  els.modelInput.value = model;
  els.deepseekKeyInput.placeholder = apiKey ? "已保存，留空则保留" : "未填写";
  await updateStatus();
}

function bindEvents() {
  els.settingsButton.addEventListener("click", () => toggle(els.settingsPanel));
  els.libraryButton.addEventListener("click", () => toggle(els.libraryPanel));
  els.saveSettingsButton.addEventListener("click", saveSettings);
  els.clearSettingsButton.addEventListener("click", clearSettings);
  els.refreshButton.addEventListener("click", refreshLibrary);
  els.indexButton.addEventListener("click", importSelectedPdfs);
  els.searchButton.addEventListener("click", () => runQuestion({ answer: false }));
  els.askButton.addEventListener("click", () => runQuestion({ answer: true }));
  els.bookList.addEventListener("click", deleteBookFromClick);
  els.answerBox.addEventListener("click", openCitationFromClick);
}

function toggle(element) {
  element.hidden = !element.hidden;
}

async function saveSettings() {
  setBusy("正在保存设置...");
  try {
    const key = els.deepseekKeyInput.value.trim();
    if (key) await putSetting("deepseekApiKey", key);
    await putSetting("deepseekModel", els.modelInput.value);
    els.deepseekKeyInput.value = "";
    await loadSettings();
    showNotice("设置已保存。");
  } catch (error) {
    showError(error);
  } finally {
    setBusy("");
  }
}

async function clearSettings() {
  if (!confirm("确认清空 DeepSeek API Key？")) return;
  await putSetting("deepseekApiKey", "");
  els.deepseekKeyInput.value = "";
  await loadSettings();
  showNotice("DeepSeek Key 已清空。");
}

async function importSelectedPdfs() {
  const files = Array.from(els.pdfInput.files || []);
  if (!files.length) {
    showError(new Error("请先选择 PDF 文件。"));
    return;
  }
  setBusy("正在导入教材...");
  showProgress(0);
  try {
    for (let i = 0; i < files.length; i += 1) {
      await indexPdf(files[i], (ratio) => showProgress((i + ratio) / files.length));
    }
    els.pdfInput.value = "";
    showProgress(1);
    await refreshLibrary();
    showNotice("教材导入完成。");
  } catch (error) {
    showError(error);
  } finally {
    setBusy("");
    window.setTimeout(() => {
      els.progress.hidden = true;
      showProgress(0);
    }, 500);
  }
}

async function indexPdf(file, onProgress) {
  const pdfjsLib = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const bookId = crypto.randomUUID();
  const book = {
    id: bookId,
    name: file.name,
    size: file.size,
    pages: pdf.numPages,
    indexedAt: new Date().toISOString(),
  };

  const chunks = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    const text = normalizeText(content.items.map((item) => item.str || "").join(" "));
    for (const chunk of chunkText(text)) {
      chunks.push({ bookId, bookName: file.name, page: pageNo, text: chunk });
    }
    onProgress(pageNo / pdf.numPages);
  }

  await saveBookWithChunks(book, chunks);
}

async function getPdfJs() {
  const pdfjsLib = globalThis.pdfjsLib || (await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs"));
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  return pdfjsLib;
}

function saveBookWithChunks(book, chunks) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["books", "chunks"], "readwrite");
    const books = transaction.objectStore("books");
    const chunksStore = transaction.objectStore("chunks");
    books.put(book);
    for (const chunk of chunks) chunksStore.add(chunk);
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}

async function refreshLibrary() {
  const books = await getAll("books");
  renderBooks(books.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN")));
  await updateStatus();
}

async function updateStatus() {
  const books = await getAll("books");
  const chunks = await getAll("chunks");
  const hasKey = Boolean(await getSetting("deepseekApiKey"));
  els.statusLine.textContent = `教材 ${books.length} 本 · 片段 ${chunks.length} 个 · ${hasKey ? "DeepSeek 已配置" : "DeepSeek 未配置"}`;
}

function renderBooks(books) {
  els.bookList.innerHTML = "";
  if (!books.length) {
    els.bookList.className = "book-list empty";
    els.bookList.textContent = "暂无教材。";
    return;
  }
  els.bookList.className = "book-list";
  for (const book of books) {
    const row = els.bookTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector(".book-name").textContent = book.name;
    row.querySelector(".book-meta").textContent = `${formatBytes(book.size)} · ${book.pages} 页 · ${new Date(book.indexedAt).toLocaleString()}`;
    row.querySelector(".delete-book").dataset.bookId = book.id;
    els.bookList.append(row);
  }
}

async function deleteBookFromClick(event) {
  const button = event.target.closest(".delete-book");
  if (!button) return;
  const bookId = button.dataset.bookId;
  if (!confirm("确认删除这本教材及其索引？")) return;
  await deleteBook(bookId);
  await refreshLibrary();
}

function deleteBook(bookId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["books", "chunks"], "readwrite");
    transaction.objectStore("books").delete(bookId);
    const chunks = transaction.objectStore("chunks");
    const index = chunks.index("bookId");
    const request = index.openCursor(IDBKeyRange.only(bookId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();
  });
}

async function runQuestion({ answer }) {
  const question = els.questionInput.value.trim();
  if (!question) {
    showError(new Error("请先输入问题。"));
    return;
  }
  setBusy(answer ? "正在检索并回答..." : "正在检索...");
  try {
    const evidence = await searchLocal(question, 14);
    renderCitations(evidence);
    if (!answer || !els.useDeepseekInput.checked) {
      showSearchSummary(question, evidence);
      return;
    }
    const apiKey = await getSetting("deepseekApiKey");
    if (!apiKey) {
      showError(new Error("请先在设置中填写 DeepSeek API Key，或取消 DeepSeek 回答后只检索。"));
      return;
    }
    const model = (await getSetting("deepseekModel")) || "deepseek-v4-flash";
    const response = await askDeepSeek(question, evidence, apiKey, model);
    renderAnswer(response);
  } catch (error) {
    showError(error);
  } finally {
    setBusy("");
  }
}

async function searchLocal(question, limit) {
  const terms = extractTerms(question);
  const chunks = await getAll("chunks");
  const scored = [];
  for (const chunk of chunks) {
    const lower = chunk.text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const count = countOccurrences(lower, term.toLowerCase());
      if (count) score += count * Math.min(8, term.length);
    }
    if (score > 0) {
      scored.push({
        id: "",
        kind: "textbook",
        title: chunk.bookName,
        page: chunk.page,
        text: chunk.text,
        snippet: makeSnippet(chunk.text, terms),
        score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((item, index) => ({ ...item, id: `T${index + 1}` }));
}

async function askDeepSeek(question, evidence, apiKey, model) {
  const compact = evidence.map((item) => ({
    id: item.id,
    title: item.title,
    page: item.page,
    text: item.snippet,
  }));
  const response = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1800,
      messages: [
        {
          role: "system",
          content:
            "你是医学教材问答助手。只能依据提供的教材证据回答；证据不足时说明不足。用中文回答，每个关键结论后引用证据编号，如 [T1]。",
        },
        {
          role: "user",
          content: JSON.stringify({ question, evidence: compact }),
        },
      ],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || `DeepSeek 请求失败：${response.status}`);
  }
  return data.choices?.[0]?.message?.content || "DeepSeek 没有返回回答。";
}

function showSearchSummary(question, evidence) {
  const lines = [`问题：${question}`, "", `找到 ${evidence.length} 条教材证据。`];
  for (const item of evidence.slice(0, 5)) {
    lines.push(`[${item.id}] ${item.title} 第 ${item.page} 页：${item.snippet}`);
  }
  renderAnswer(lines.join("\n"));
}

function renderAnswer(text) {
  els.answerBox.classList.remove("empty");
  els.answerBox.innerHTML = escapeHtml(text).replace(/\[(T\d+)\]/g, (_match, id) => {
    return `<button class="citation-ref" type="button" data-citation-id="${id}">[${id}]</button>`;
  });
}

function renderCitations(items) {
  els.citationCount.textContent = String(items.length);
  els.citationList.innerHTML = "";
  if (!items.length) {
    els.citationList.className = "citation-list empty";
    els.citationList.textContent = "暂无出处。";
    return;
  }
  els.citationList.className = "citation-list";
  for (const item of items) {
    const card = els.citationTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.citationId = item.id;
    card.querySelector(".citation-id").textContent = item.id;
    card.querySelector(".citation-title").textContent = item.title;
    card.querySelector(".citation-meta").textContent = `第 ${item.page} 页`;
    card.querySelector(".citation-text").textContent = item.snippet;
    els.citationList.append(card);
  }
}

function openCitationFromClick(event) {
  const button = event.target.closest(".citation-ref");
  if (!button) return;
  const card = els.citationList.querySelector(`[data-citation-id="${CSS.escape(button.dataset.citationId)}"]`);
  if (!card) return;
  card.open = true;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.add("citation-highlight");
  window.setTimeout(() => card.classList.remove("citation-highlight"), 1600);
}

function extractTerms(text) {
  const terms = [];
  const chineseRuns = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const run of chineseRuns) {
    if (run.length <= 12) terms.push(run);
    for (const size of [4, 3, 2]) {
      for (let i = 0; i <= run.length - size; i += 1) terms.push(run.slice(i, i + size));
    }
  }
  const english = text.match(/[A-Za-z][A-Za-z0-9-]{2,}/g) || [];
  terms.push(...english.map((item) => item.toLowerCase()));
  return Array.from(new Set(terms)).slice(0, 32);
}

function normalizeText(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function chunkText(text, size = 850, overlap = 120) {
  const clean = normalizeText(text);
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const boundary = Math.max(clean.lastIndexOf("。", end), clean.lastIndexOf("；", end));
      if (boundary > start + 280) end = boundary + 1;
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk.length >= 40) chunks.push(chunk);
    if (end >= clean.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

function makeSnippet(text, terms, length = 260) {
  const lower = text.toLowerCase();
  const positions = terms.map((term) => lower.indexOf(term.toLowerCase())).filter((pos) => pos >= 0);
  const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 80);
  let snippet = text.slice(start, start + length);
  if (start > 0) snippet = `...${snippet}`;
  if (start + length < text.length) snippet += "...";
  return snippet;
}

function countOccurrences(text, term) {
  if (!term) return 0;
  let count = 0;
  let index = text.indexOf(term);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024) return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(1)} TB`;
}

function showProgress(ratio) {
  els.progress.hidden = false;
  els.progressBar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
}

function setBusy(text) {
  els.busyText.textContent = text;
  const busy = Boolean(text);
  els.indexButton.disabled = busy;
  els.searchButton.disabled = busy;
  els.askButton.disabled = busy;
}

function showNotice(text) {
  els.answerBox.classList.remove("empty");
  els.answerBox.textContent = text;
}

function showError(error) {
  els.answerBox.classList.remove("empty");
  els.answerBox.textContent = error.message || String(error);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
