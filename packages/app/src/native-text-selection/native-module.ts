import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

export interface NativeTextSelectionEvent {
  surfaceId: string;
  active: boolean;
  text?: string;
  anchorX?: number;
  anchorY?: number;
}

interface PaseoTextSelectionModule {
  registerSurface(viewTag: number, surfaceId: string): Promise<void>;
  unregisterSurface(surfaceId: string): Promise<void>;
  clearSelection(surfaceId: string): Promise<void>;
  addListener(
    eventName: "onTextSelection",
    listener: (event: NativeTextSelectionEvent) => void,
  ): EventSubscription;
}

const textSelectionModule =
  requireOptionalNativeModule<PaseoTextSelectionModule>("PaseoTextSelection");

export function registerNativeTextSelectionSurface(viewTag: number, surfaceId: string) {
  return textSelectionModule?.registerSurface(viewTag, surfaceId);
}

export function unregisterNativeTextSelectionSurface(surfaceId: string) {
  return textSelectionModule?.unregisterSurface(surfaceId);
}

export function clearNativeTextSelection(surfaceId: string) {
  return textSelectionModule?.clearSelection(surfaceId);
}

export function addNativeTextSelectionListener(
  listener: (event: NativeTextSelectionEvent) => void,
): EventSubscription | null {
  return textSelectionModule?.addListener("onTextSelection", listener) ?? null;
}

export function canUseNativeTextSelection(): boolean {
  return textSelectionModule !== null;
}
