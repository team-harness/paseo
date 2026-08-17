import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { User } from "lucide-react-native";

import { AgentStatusDot } from "@/components/agent-status-dot";
import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";

/** The size a room message and a roster row both draw the avatar at. */
export const MEMBER_AVATAR_SIZE = 32;

const WHITE_TEXT = { color: "#ffffff" } as const;

export interface MemberAvatarProps {
  /** The agent this stands for, or null when a person said it. */
  agentId: string | null;
  /** Role, title, or whatever the room knows to call them; the initial comes from it. */
  label: string;
  size?: number;
  status?: string | null;
  requiresAttention?: boolean | null;
  attentionReason?: "finished" | "error" | "permission" | null;
  pendingPermissionCount?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * A team member, as a circle.
 *
 * The color is hashed from the agent id through the same identity table the
 * project icons use, so a member keeps one color everywhere and two members
 * never collide by having similar roles. Roles are what people type and read;
 * ids are what stays stable, so the letter comes from one and the color from
 * the other.
 */
export function MemberAvatar({
  agentId,
  label,
  size = MEMBER_AVATAR_SIZE,
  status,
  requiresAttention,
  attentionReason,
  pendingPermissionCount,
  onPress,
  accessibilityLabel,
  testID,
}: MemberAvatarProps) {
  const circle = useMemo(
    () => [
      styles.circle,
      { width: size, height: size, borderRadius: size / 2 },
      // A person has no id to hash and no role to abbreviate, so they get the
      // one neutral fill and the glyph instead of a letter.
      agentId ? { backgroundColor: identityColor(deriveIdentityColorName(agentId)) } : null,
      agentId ? null : styles.human,
    ],
    [agentId, size],
  );
  const letter = useMemo(
    () => [styles.letter, { fontSize: Math.round(size * 0.42) }, WHITE_TEXT],
    [size],
  );

  const face = (
    <View style={circle}>
      {agentId ? (
        <Text style={letter}>{initialOf(label)}</Text>
      ) : (
        <HumanGlyph size={Math.round(size * 0.5)} />
      )}
      {status ? (
        <View style={styles.dotRing}>
          <AgentStatusDot
            status={status}
            requiresAttention={requiresAttention}
            attentionReason={attentionReason}
            pendingPermissionCount={pendingPermissionCount}
            // An idle member gets a quiet dot rather than none: an avatar with
            // nothing on it reads as an avatar whose status failed to load.
            showInactive
          />
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return <View testID={testID}>{face}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      style={styles.press}
      testID={testID}
    >
      {face}
    </Pressable>
  );
}

/** First letter of a role, or `?` when there is nothing to take one from. */
function initialOf(label: string): string {
  return [...label.trim()][0]?.toUpperCase() ?? "?";
}

const HumanGlyph = withUnistyles(User, (theme) => ({ color: theme.colors.foregroundMuted }));

const styles = StyleSheet.create((theme) => ({
  press: {
    // The circle is under 44pt on purpose; the tap target is not.
    padding: 2,
  },
  circle: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface3,
  },
  human: {
    backgroundColor: theme.colors.surface3,
  },
  letter: {
    fontWeight: theme.fontWeight.medium,
    // The letter is a mark, not a word; letting it wrap or ellipsize turns one
    // glyph into two lines at small sizes.
    includeFontPadding: false,
  },
  dotRing: {
    position: "absolute",
    right: -1,
    bottom: -1,
    padding: 2,
    borderRadius: theme.borderRadius.full,
    // The ring is the surface behind the avatar, so the dot reads against the
    // fill instead of blending into whichever identity color landed under it.
    backgroundColor: theme.colors.surface0,
  },
}));
