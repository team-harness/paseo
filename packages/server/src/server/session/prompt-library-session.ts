import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import type { PromptLibraryStore } from "../prompt-library/store.js";

interface PromptLibrarySessionOptions {
  emit: (message: SessionOutboundMessage) => void;
  store: PromptLibraryStore;
}

export class PromptLibrarySession {
  constructor(private readonly options: PromptLibrarySessionOptions) {}

  dispatch(message: SessionInboundMessage): Promise<void> | undefined {
    switch (message.type) {
      case "prompt.library.list.request":
        return this.list(message.requestId);
      case "prompt.library.create.request":
        return this.create(message);
      case "prompt.library.update.request":
        return this.update(message);
      case "prompt.library.delete.request":
        return this.remove(message.requestId, message.id);
      case "prompt.library.clear.request":
        return this.clear(message.requestId);
      case "prompt.library.merge.request":
        return this.merge(message.requestId, message.items);
      default:
        return undefined;
    }
  }

  private async list(requestId: string): Promise<void> {
    const items = await this.options.store.list();
    this.options.emit({
      type: "prompt.library.list.response",
      payload: { requestId, items },
    });
  }

  private async create(
    message: Extract<SessionInboundMessage, { type: "prompt.library.create.request" }>,
  ): Promise<void> {
    const result = await this.options.store.create({
      title: message.title,
      content: message.content,
    });
    this.options.emit({
      type: "prompt.library.create.response",
      payload: { requestId: message.requestId, items: result.items },
    });
  }

  private async update(
    message: Extract<SessionInboundMessage, { type: "prompt.library.update.request" }>,
  ): Promise<void> {
    const result = await this.options.store.update(message.id, {
      title: message.title,
      content: message.content,
    });
    this.options.emit({
      type: "prompt.library.update.response",
      payload: { requestId: message.requestId, items: result.items },
    });
  }

  private async remove(requestId: string, id: string): Promise<void> {
    const result = await this.options.store.remove(id);
    this.options.emit({
      type: "prompt.library.delete.response",
      payload: { requestId, items: result.items },
    });
  }

  private async clear(requestId: string): Promise<void> {
    const result = await this.options.store.clear();
    this.options.emit({
      type: "prompt.library.clear.response",
      payload: { requestId, items: result.items },
    });
  }

  private async merge(
    requestId: string,
    items: Extract<SessionInboundMessage, { type: "prompt.library.merge.request" }>["items"],
  ): Promise<void> {
    const result = await this.options.store.merge(items);
    this.options.emit({
      type: "prompt.library.merge.response",
      payload: { requestId, ...result },
    });
  }
}
