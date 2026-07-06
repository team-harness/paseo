import { createContext, useContext, useMemo, type ReactNode } from "react";

interface HostBottomChromeContextValue {
  bottomSafeAreaOwned: boolean;
  chromeHeight: number;
}

interface HostBottomChromeProviderProps extends HostBottomChromeContextValue {
  children: ReactNode;
}

const HostBottomChromeContext = createContext<HostBottomChromeContextValue>({
  bottomSafeAreaOwned: false,
  chromeHeight: 0,
});

export function HostBottomChromeProvider({
  bottomSafeAreaOwned,
  chromeHeight,
  children,
}: HostBottomChromeProviderProps) {
  const value = useMemo(
    () => ({ bottomSafeAreaOwned, chromeHeight }),
    [bottomSafeAreaOwned, chromeHeight],
  );

  return (
    <HostBottomChromeContext.Provider value={value}>{children}</HostBottomChromeContext.Provider>
  );
}

export function useHostBottomChromeInset(bottomInset: number): number {
  const chrome = useContext(HostBottomChromeContext);
  return chrome.bottomSafeAreaOwned ? 0 : bottomInset;
}

export function useHostBottomChrome() {
  return useContext(HostBottomChromeContext);
}
