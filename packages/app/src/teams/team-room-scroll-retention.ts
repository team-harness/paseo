const ROOM_BOTTOM_THRESHOLD = 48;
const ROOM_GEOMETRY_TOLERANCE = 1;

export interface TeamRoomScrollMetrics {
  offsetY: number;
  contentHeight: number;
  viewportHeight: number;
}

export interface TeamRoomScrollRetentionPort {
  scrollToEnd(): void;
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
}

export interface TeamRoomScrollRetention {
  setActive(active: boolean): void;
  contentChanged(): void;
  layoutChanged(): void;
  scrolled(metrics: TeamRoomScrollMetrics): void;
  beginDrag(): void;
  dispose(): void;
}

/** Owns follow-versus-read state without depending on React or FlatList. */
export function createTeamRoomScrollRetention(
  port: TeamRoomScrollRetentionPort,
): TeamRoomScrollRetention {
  let active = false;
  let nearBottom = true;
  let pendingFrame: number | null = null;
  let geometry: Pick<TeamRoomScrollMetrics, "contentHeight" | "viewportHeight"> | null = null;

  const cancelPendingPin = () => {
    if (pendingFrame === null) return;
    port.cancelFrame(pendingFrame);
    pendingFrame = null;
  };

  const pinToBottomIfNear = () => {
    cancelPendingPin();
    if (!active || !nearBottom) return;

    port.scrollToEnd();
    pendingFrame = port.requestFrame(() => {
      pendingFrame = null;
      if (active && nearBottom) port.scrollToEnd();
    });
  };

  return {
    setActive(nextActive) {
      active = nextActive;
      if (active) pinToBottomIfNear();
      else cancelPendingPin();
    },
    contentChanged: pinToBottomIfNear,
    layoutChanged: pinToBottomIfNear,
    scrolled(metrics) {
      if (!active || metrics.contentHeight <= 0 || metrics.viewportHeight <= 0) return;
      const previous = geometry;
      geometry = {
        contentHeight: metrics.contentHeight,
        viewportHeight: metrics.viewportHeight,
      };
      if (
        !previous ||
        Math.abs(previous.contentHeight - metrics.contentHeight) > ROOM_GEOMETRY_TOLERANCE ||
        Math.abs(previous.viewportHeight - metrics.viewportHeight) > ROOM_GEOMETRY_TOLERANCE
      ) {
        return;
      }
      const distance = metrics.contentHeight - metrics.viewportHeight - metrics.offsetY;
      nearBottom = distance <= ROOM_BOTTOM_THRESHOLD;
    },
    beginDrag() {
      nearBottom = false;
      cancelPendingPin();
    },
    dispose: cancelPendingPin,
  };
}
