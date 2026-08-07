import { Text, View } from "react-native";
import { ArrowLeftToLine, RotateCw } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { TeamRouteResolution } from "@/navigation/team-route-resolution";
import { formatConnectionStatus } from "@/utils/daemons";
import type { Theme } from "@/styles/theme";

type VisibleTeamRouteResolution = Extract<
  TeamRouteResolution,
  { kind: "waitingForHost" | "hydrating" | "unsupported" }
>;

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

export function TeamRouteResolutionView({
  resolution,
  hostName,
  lastHostError,
  onRetry,
  onBack,
}: {
  resolution: VisibleTeamRouteResolution;
  hostName: string;
  lastHostError: string | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslation();

  if (resolution.kind === "unsupported") {
    // Waiting is the wrong answer here: this daemon will never send a team
    // list, so the spinner would spin until the user gave up.
    return (
      <View style={styles.emptyState} testID="team-route-unsupported">
        <View style={styles.textStack}>
          <Text style={styles.title}>{t("teams.route.unsupported", { hostName })}</Text>
        </View>
        <View style={styles.actions}>
          <Button size="sm" variant="outline" leftIcon={ArrowLeftToLine} onPress={onBack}>
            {t("common.actions.back")}
          </Button>
        </View>
      </View>
    );
  }

  if (resolution.kind === "hydrating") {
    return (
      <View style={styles.emptyState} testID="team-route-hydrating">
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
        <View style={styles.textStack}>
          <Text style={styles.title}>{t("teams.route.loading")}</Text>
        </View>
      </View>
    );
  }

  const isConnecting =
    resolution.connectionStatus === "connecting" || resolution.connectionStatus === "idle";

  return (
    <View style={styles.emptyState} testID="team-route-waiting-for-host">
      {isConnecting ? (
        <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
      ) : null}
      <View style={styles.textStack}>
        <Text style={styles.title}>
          {isConnecting
            ? t("agentPanel.unavailable.connecting", { serverLabel: hostName })
            : t("workspace.route.cannotReachHost", { hostName })}
        </Text>
        <Text style={styles.description}>
          {isConnecting
            ? t("agentPanel.unavailable.showWhenOnline")
            : t("workspace.route.hostStatus", {
                status: formatConnectionStatus(resolution.connectionStatus),
              })}
        </Text>
        {lastHostError ? <Text style={styles.error}>{lastHostError}</Text> : null}
      </View>
      {!isConnecting ? (
        <View style={styles.actions}>
          <Button size="sm" variant="default" leftIcon={RotateCw} onPress={onRetry}>
            {t("common.actions.retry")}
          </Button>
          <Button size="sm" variant="outline" leftIcon={ArrowLeftToLine} onPress={onBack}>
            {t("common.actions.back")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[6],
  },
  textStack: {
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: 520,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    textAlign: "center",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.4),
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
}));
