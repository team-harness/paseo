import type { TextInput } from "react-native";

import { isWeb } from "@/constants/platform";

type TextInputHandle = TextInput | { getNativeRef?: () => unknown };
type SelectableElement = HTMLElement & {
  setSelectionRange?: (start: number, end: number) => void;
};
interface NativeSelectableInput {
  setNativeProps?: (props: { selection: { start: number; end: number } }) => void;
}

function getNativeInputRef(current: TextInputHandle): unknown {
  const handle = current as { getNativeRef?: () => unknown };
  return typeof handle.getNativeRef === "function" ? handle.getNativeRef() : current;
}

/**
 * The DOM node behind a `TextInput`, on web.
 *
 * React Native Web hands back either the element itself or a wrapper with
 * `getNativeRef`, depending on which version of the input is rendered.
 */
export function getTextInputNativeElement(current: TextInputHandle | null): HTMLElement | null {
  if (!current) return null;
  const native = getNativeInputRef(current);
  return native instanceof HTMLElement ? native : null;
}

/**
 * Puts the caret somewhere in a `TextInput`.
 *
 * React restores the selection a controlled input had before its value changed,
 * so anything that rewrites the value from outside a keystroke — completing a
 * mention, inserting a snippet — has to say where the caret went or it is left
 * inside the word that was just replaced.
 */
export function setTextInputSelection(
  input: TextInputHandle | null,
  selection: { start: number; end: number },
): void {
  if (!input) return;
  if (isWeb) {
    const element = getTextInputNativeElement(input) as SelectableElement | null;
    element?.setSelectionRange?.(selection.start, selection.end);
    return;
  }
  const nativeInput = getNativeInputRef(input) as NativeSelectableInput;
  nativeInput.setNativeProps?.({ selection });
}
