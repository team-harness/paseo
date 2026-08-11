import { describe, expect, it } from "vitest";

import {
  createTeamRoomScrollRetention,
  type TeamRoomScrollRetentionPort,
} from "./team-room-scroll-retention";

class FakeScrollPort implements TeamRoomScrollRetentionPort {
  scrollCount = 0;
  private nextFrameId = 1;
  private readonly frames = new Map<number, () => void>();

  scrollToEnd(): void {
    this.scrollCount += 1;
  }

  requestFrame(callback: () => void): number {
    const id = this.nextFrameId;
    this.nextFrameId += 1;
    this.frames.set(id, callback);
    return id;
  }

  cancelFrame(id: number): void {
    this.frames.delete(id);
  }
}

describe("team room scroll retention", () => {
  it("stops following immediately when a drag begins", () => {
    const port = new FakeScrollPort();
    const retention = createTeamRoomScrollRetention(port);
    retention.setActive(true);
    expect(port.scrollCount).toBe(1);

    retention.beginDrag();
    retention.contentChanged();

    expect(port.scrollCount).toBe(1);
  });

  it("resumes following after stable scroll geometry reaches the bottom", () => {
    const port = new FakeScrollPort();
    const retention = createTeamRoomScrollRetention(port);
    retention.setActive(true);
    retention.beginDrag();
    const atBottom = { offsetY: 600, contentHeight: 1000, viewportHeight: 400 };

    retention.scrolled(atBottom);
    retention.scrolled(atBottom);
    retention.contentChanged();

    expect(port.scrollCount).toBe(2);
  });
});
