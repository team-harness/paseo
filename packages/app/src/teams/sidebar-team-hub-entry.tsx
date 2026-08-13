import { router, usePathname } from "expo-router";
import { Users } from "lucide-react-native";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { buildHostTeamsRoute } from "@/utils/host-routes";

export function SidebarTeamHubEntry({
  serverId,
  onBeforeNavigate,
}: {
  serverId: string;
  onBeforeNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const href = buildHostTeamsRoute(serverId);
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(href);
  }, [href, onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={Users}
      label={t("teams.host.title")}
      onPress={handlePress}
      isActive={pathname === href}
      testID="sidebar-teams"
      variant="compact"
    />
  );
}
