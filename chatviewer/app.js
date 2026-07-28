const conversation = document.querySelector("#conversation");

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

function appendInlineMarkdown(target, text) {
  const fragments = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  for (const fragment of fragments) {
    if (fragment.startsWith("`") && fragment.endsWith("`")) {
      const code = element("code", "", fragment.slice(1, -1));
      target.append(code);
    } else if (fragment.startsWith("**") && fragment.endsWith("**")) {
      const strong = element("strong", "", fragment.slice(2, -2));
      target.append(strong);
    } else {
      target.append(document.createTextNode(fragment));
    }
  }
}

function renderMarkdown(text) {
  const root = element("div", "markdown");
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  let codeLines = null;
  let list = null;

  const flushList = () => {
    list = null;
  };
  const appendParagraph = (line) => {
    const paragraph = element("p");
    appendInlineMarkdown(paragraph, line);
    root.append(paragraph);
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      flushList();
      if (codeLines === null) {
        codeLines = [];
      } else {
        const pre = element("pre");
        pre.append(element("code", "", codeLines.join("\n")));
        root.append(pre);
        codeLines = null;
      }
      continue;
    }
    if (codeLines !== null) {
      codeLines.push(line);
      continue;
    }
    const heading = /^(#{2,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushList();
      const node = element(heading[1].length === 2 ? "h2" : "h3");
      appendInlineMarkdown(node, heading[2]);
      root.append(node);
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!list || list.tagName !== "UL") {
        list = element("ul");
        root.append(list);
      }
      const item = element("li");
      appendInlineMarkdown(item, bullet[1]);
      list.append(item);
      continue;
    }
    if (!line.trim()) {
      flushList();
      continue;
    }
    flushList();
    appendParagraph(line);
  }
  if (codeLines !== null) {
    const pre = element("pre");
    pre.append(element("code", "", codeLines.join("\n")));
    root.append(pre);
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
    `entry record${entry.status === "failed" || entry.level === "error" ? " error" : ""}`,
  );
  const heading = element("div", "record-heading");
  heading.append(element("strong", "", recordLabel(entry)));
  const status = entry.status || entry.level;
  if (status) heading.append(element("span", "status", status));
  record.append(heading);
  if (entry.kind === "thought") record.append(element("p", "", entry.text));
  if (entry.kind === "activity") record.append(element("p", "", entry.message));
  if (entry.kind === "todo") {
    const list = element("ul", "todo-list");
    for (const item of entry.items)
      list.append(element("li", item.completed ? "done" : "", item.text));
    record.append(list);
  }
  if (entry.kind === "tool") {
    const details = element("details");
    details.append(element("summary", "", "Details"));
    const data = {};
    if (entry.input !== undefined) data.input = entry.input;
    if (entry.output !== undefined) data.output = entry.output;
    if (entry.error !== undefined) data.error = entry.error;
    details.append(element("pre", "", JSON.stringify(data, null, 2)));
    record.append(details);
  }
  return record;
}

function renderHistory(history) {
  document.title = `${history.conversation.title} - Paseo Chat`;
  conversation.replaceChildren();
  const meta = element("header", "conversation-meta");
  meta.append(element("h1", "", history.conversation.title));
  const details = [
    history.conversation.provider,
    history.conversation.model,
    `Shared ${formatTime(history.exportedAt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  if (details) meta.append(element("p", "", details));
  conversation.append(meta);

  for (const entry of history.entries) {
    if (entry.kind === "message") {
      const article = element("article", `entry message ${entry.role}`);
      const bubble = element("div", "bubble");
      bubble.append(
        element(
          "div",
          "entry-meta",
          `${entry.role === "user" ? "You" : "Assistant"} · ${formatTime(entry.createdAt)}`,
        ),
      );
      bubble.append(renderMarkdown(entry.markdown));
      article.append(bubble);
      conversation.append(article);
    } else {
      conversation.append(renderRecord(entry));
    }
  }
}

async function loadHistory() {
  const historyUrl = new URLSearchParams(window.location.search).get("history");
  if (!historyUrl) return;
  try {
    const response = await fetch(historyUrl, { cache: "no-store" });
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

void loadHistory();
