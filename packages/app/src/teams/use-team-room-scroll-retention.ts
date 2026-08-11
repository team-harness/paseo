import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from "react-native";

import {
  createTeamRoomScrollRetention,
  type TeamRoomScrollRetention,
} from "./team-room-scroll-retention";

export function useTeamRoomScrollRetention<Item>(input: {
  active: boolean;
  listRef: RefObject<FlatList<Item> | null>;
}) {
  const controllerRef = useRef<TeamRoomScrollRetention | null>(null);
  controllerRef.current ??= createTeamRoomScrollRetention({
    scrollToEnd: () => input.listRef.current?.scrollToEnd({ animated: false }),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
  });
  const controller = controllerRef.current;

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      controller.scrolled({
        offsetY: contentOffset.y,
        contentHeight: contentSize.height,
        viewportHeight: layoutMeasurement.height,
      });
    },
    [controller],
  );

  useLayoutEffect(() => {
    controller.setActive(input.active);
  }, [controller, input.active]);

  useLayoutEffect(() => () => controller.dispose(), [controller]);

  return {
    onContentSizeChange: controller.contentChanged,
    onLayout: controller.layoutChanged,
    onScroll,
    onScrollBeginDrag: controller.beginDrag,
  };
}
