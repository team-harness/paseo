const conversation = document.querySelector("#conversation");
const CHAT_SHARE_API_ORIGIN = "https://paseo-chat-share.bazhuayu.xyz";
const MESSAGE_ANCHOR_PREFIX = "message-";

function messageAnchorId(entry) {
  return `${MESSAGE_ANCHOR_PREFIX}${entry.id}`;
}

function currentMessageAnchorId() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  try {
    const anchorId = decodeURIComponent(hash);
    return anchorId.startsWith(MESSAGE_ANCHOR_PREFIX) ? anchorId : null;
  } catch {
    return null;
  }
}

function focusCurrentMessageAnchor() {
  const anchorId = currentMessageAnchorId();
  if (!anchorId) return;
  const target = document.getElementById(anchorId);
  if (!target) return;

  document.querySelector(".entry.is-anchor-target")?.classList.remove("is-anchor-target");
  target.classList.remove("is-anchor-target");
  void target.offsetWidth;
  target.classList.add("is-anchor-target");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function copyMessageAnchor(anchorId, button) {
  const url = new URL(window.location.href);
  url.hash = encodeURIComponent(anchorId);
  window.history.replaceState(null, "", url);
  focusCurrentMessageAnchor();

  try {
    await navigator.clipboard.writeText(url.toString());
    button.classList.add("copied");
    button.setAttribute("aria-label", "Link copied");
    window.setTimeout(() => {
      button.classList.remove("copied");
      button.setAttribute("aria-label", "Copy link to this message");
    }, 1600);
  } catch {
    button.setAttribute("aria-label", "Link ready in the address bar");
  }
}

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function isHistory(value) {
  return (
    value &&
    typeof value === "object" &&
    value.schemaVersion === 1 &&
    value.conversation &&
    typeof value.conversation.title === "string" &&
    Array.isArray(value.entries)
  );
}

function resolveHistoryUrl(history) {
  // Old shares contain the full read URL. New shares expose only the object key.
  if (!history.startsWith("history/")) return history;
  const url = new URL("/v1/history", CHAT_SHARE_API_ORIGIN);
  url.searchParams.set("key", history);
  return url.toString();
}

function isShareableLink(href) {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function renderUnshareableLinksAsLabels(state) {
  for (const token of state.tokens) {
    if (!token.children) continue;
    for (let index = 0; index < token.children.length; index += 1) {
      const open = token.children[index];
      if (open.type !== "link_open" || isShareableLink(open.attrGet("href") ?? "")) continue;

      open.type = "text";
      open.tag = "";
      open.nesting = 0;
      open.attrs = null;
      open.content = "";
      let depth = 1;
      for (let closeIndex = index + 1; closeIndex < token.children.length; closeIndex += 1) {
        const candidate = token.children[closeIndex];
        if (candidate.type === "link_open") depth += 1;
        if (candidate.type !== "link_close") continue;
        depth -= 1;
        if (depth !== 0) continue;
        candidate.type = "text";
        candidate.tag = "";
        candidate.nesting = 0;
        candidate.content = "";
        break;
      }
    }
  }
}

function createMarkdownRenderer() {
  if (typeof window.markdownit !== "function") return null;
  const renderer = window.markdownit({ html: false, linkify: true });
  renderer.core.ruler.after("inline", "paseo-link-labels", renderUnshareableLinksAsLabels);
  const defaultLinkOpen =
    renderer.renderer.rules.link_open ??
    ((tokens, index, options, environment, self) =>
      self.renderToken(tokens, index, options, environment));
  renderer.renderer.rules.link_open = (tokens, index, options, environment, self) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noopener noreferrer");
    return defaultLinkOpen(tokens, index, options, environment, self);
  };
  return renderer;
}

const markdownRenderer = createMarkdownRenderer();

function renderMarkdown(text) {
  const root = element("div", "markdown");
  if (markdownRenderer) {
    // markdown-it escapes raw HTML and rejects unsafe URL protocols.
    root.innerHTML = markdownRenderer.render(text);
  } else {
    root.textContent = text;
  }
  return root;
}

function recordLabel(entry) {
  switch (entry.kind) {
    case "tool":
      return entry.name;
    case "thought":
      return "Thinking";
    case "todo":
      return "Tasks";
    case "compaction":
      return "Context compacted";
    default:
      return "Activity";
  }
}

function renderRecord(entry) {
  const record = element(
    "section",
    `entry record ${entry.kind}-record${
      entry.status === "failed" || entry.level === "error" ? " error" : ""
    }`,
  );
  const heading = element("div", "record-heading");
  heading.append(element("strong", "", recordLabel(entry)));
  const status = entry.status || entry.level;
  if (status) heading.append(element("span", "status", status));
  if (entry.kind === "tool") {
    const toggle = element("button", "tool-toggle");
    toggle.type = "button";
    toggle.append(heading, element("span", "tool-caret"));

    const data = {};
    if (entry.input !== undefined) data.input = entry.input;
    if (entry.output !== undefined) data.output = entry.output;
    if (entry.error !== undefined) data.error = entry.error;
    const detail = element("pre", "", JSON.stringify(data, null, 2));
    detail.hidden = true;

    const setExpanded = (expanded) => {
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute(
        "aria-label",
        `${expanded ? "Hide" : "Show"} details for ${recordLabel(entry)}`,
      );
      detail.hidden = !expanded;
      record.classList.toggle("is-expanded", expanded);
    };
    setExpanded(false);
    toggle.addEventListener("click", () => {
      setExpanded(toggle.getAttribute("aria-expanded") !== "true");
    });
    record.append(toggle, detail);
  } else {
    record.append(heading);
  }
  if (entry.kind === "thought") record.append(element("p", "", entry.text));
  if (entry.kind === "activity") record.append(element("p", "", entry.message));
  if (entry.kind === "todo") {
    const list = element("ul", "todo-list");
    for (const item of entry.items)
      list.append(element("li", item.completed ? "done" : "", item.text));
    record.append(list);
  }
  return record;
}

function renderHistory(history) {
  document.title = `${history.conversation.title} - Paseo Chat`;
  conversation.replaceChildren();
  const conversationMeta = element("header", "conversation-meta");
  conversationMeta.append(element("h1", "", history.conversation.title));
  const details = [
    history.conversation.provider,
    history.conversation.model,
    `Shared ${formatTime(history.exportedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  if (details) conversationMeta.append(element("p", "", details));
  conversation.append(conversationMeta);

  for (const entry of history.entries) {
    if (entry.kind === "message") {
      const article = element("article", `entry message ${entry.role}`);
      if (entry.role === "user") article.id = messageAnchorId(entry);
      const bubble = element("div", "bubble");
      const entryMeta = element(
        "div",
        "entry-meta",
        `${entry.role === "user" ? "You" : "Assistant"} · ${formatTime(entry.createdAt)}`,
      );
      if (entry.role === "user") {
        const anchorButton = element("button", "anchor-button");
        anchorButton.type = "button";
        anchorButton.setAttribute("aria-label", "Copy link to this message");
        anchorButton.addEventListener("click", () => {
          void copyMessageAnchor(article.id, anchorButton);
        });
        entryMeta.append(anchorButton);
      }
      bubble.append(entryMeta);
      bubble.append(renderMarkdown(entry.markdown));
      article.append(bubble);
      conversation.append(article);
    } else {
      conversation.append(renderRecord(entry));
    }
  }

  focusCurrentMessageAnchor();
}

async function loadHistory() {
  const historyReference = new URLSearchParams(window.location.search).get("history");
  if (!historyReference) return;
  try {
    const response = await fetch(resolveHistoryUrl(historyReference), { cache: "no-store" });
    if (!response.ok)
      throw new Error(`The shared history could not be loaded (${response.status})`);
    const history = await response.json();
    if (!isHistory(history)) throw new Error("This file is not a supported Paseo shared history");
    renderHistory(history);
  } catch (error) {
    conversation.replaceChildren(
      element(
        "div",
        "error-state",
        error instanceof Error ? error.message : "Unable to load the shared history",
      ),
    );
  }
}

window.addEventListener("hashchange", focusCurrentMessageAnchor);

void loadHistory();
