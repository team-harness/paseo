import React, { useCallback, useRef, useState } from "react";
import { Text } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Share2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";

export interface DocumentShareInput {
  serverId: string;
  cwd: string;
  path: string;
  content: string;
}

export function DocumentShareButton(input: DocumentShareInput) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[input.serverId]?.client ?? null);
  const supported = useSessionStore(
    (state) => state.sessions[input.serverId]?.serverInfo?.features?.documentShare === true,
  );
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const pendingCopy = useRef<{ content: string; url: string } | null>(null);

  const share = useCallback(async () => {
    if (inFlight.current) return;
    // COMPAT(documentShare): added in v0.8.0, remove after 2027-03-16 once daemon floor supports documentShare.
    if (!supported) {
      toast.error(t("panels.file.shareUnavailable"));
      return;
    }
    if (!client) {
      toast.error(t("workspace.terminal.hostDisconnected"));
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      let url = pendingCopy.current?.content === input.content ? pendingCopy.current.url : null;
      if (!url) {
        url = await client.shareDocument({
          cwd: input.cwd,
          path: input.path,
          content: input.content,
        });
        pendingCopy.current = { content: input.content, url };
      }
      try {
        const copied = await Clipboard.setStringAsync(url);
        if (!copied) throw new Error("Clipboard unavailable");
        pendingCopy.current = null;
        toast.show(t("message.actions.shareCopied"), { variant: "success", durationMs: 5000 });
      } catch {
        // Keep the published URL so retrying clipboard access cannot publish twice.
        toast.show(<Text selectable>{t("panels.file.shareCopyFailed", { url })}</Text>, {
          variant: "error",
          durationMs: null,
        });
      }
    } catch (error) {
      toast.show(`${t("panels.file.shareFailed")}\n${toErrorMessage(error)}`, {
        variant: "error",
        durationMs: 10000,
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [client, input.content, input.cwd, input.path, supported, t, toast]);

  if (!/\.(md|markdown)$/i.test(input.path)) return null;
  return (
    <Button
      variant="ghost"
      size="xs"
      leftIcon={Share2}
      loading={busy}
      disabled={busy}
      onPress={share}
      testID="file-share-document"
    >
      {t(busy ? "message.actions.sharing" : "message.actions.share")}
    </Button>
  );
}
