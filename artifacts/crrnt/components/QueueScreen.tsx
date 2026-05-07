import {
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { useAudio } from "@/contexts/AudioContext";
import { getCategoryMeta } from "@/constants/categories";
import palette from "@/constants/colors";
import type { Story } from "@workspace/api-client-react";

interface QueueScreenProps {
  visible: boolean;
  onClose: () => void;
  barBottom: number;
}

function QueueItem({
  story,
  onPlay,
  onRemove,
}: {
  story: Story;
  onPlay: () => void;
  onRemove: () => void;
}) {
  const catMeta = getCategoryMeta(story.category);
  return (
    <Pressable
      onPress={onPlay}
      style={({ pressed }) => [styles.queueItem, { opacity: pressed ? 0.7 : 1 }]}
    >
      {story.mediaUrl ? (
        <Image source={{ uri: story.mediaUrl }} style={styles.queueThumb} resizeMode="cover" />
      ) : (
        <View style={[styles.queueThumb, styles.thumbPlaceholder]} />
      )}
      <View style={styles.queueItemInfo}>
        <Text style={styles.queueItemTitle} numberOfLines={2}>
          {story.title}
        </Text>
        <Text style={styles.queueItemMeta}>{catMeta?.label ?? story.category}</Text>
      </View>
      <Pressable
        onPress={(e) => { e.stopPropagation?.(); onRemove(); }}
        hitSlop={10}
        style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.4 : 1 }]}
      >
        <Ionicons name="close" size={18} color={palette.textDim} />
      </Pressable>
    </Pressable>
  );
}

export default function QueueScreen({ visible, onClose, barBottom }: QueueScreenProps) {
  const { story, queue, removeFromQueue, playFromQueue, shuffleQueue } = useAudio();
  const slideAnim = useRef(new Animated.Value(700)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 68,
          friction: 12,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 700,
          duration: 260,
          useNativeDriver: true,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => setModalVisible(false));
    }
  }, [visible]);

  const catMeta = story ? getCategoryMeta(story.category) : null;

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      {/* Sheet — anchored at the mini bar's bottom edge, expands upward */}
      <Animated.View
        style={[
          styles.sheet,
          { bottom: barBottom, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Drag pill */}
        <View style={styles.dragPillRow}>
          <View style={styles.dragPill} />
        </View>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Queue</Text>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            style={({ pressed }) => [{ opacity: pressed ? 0.5 : 1 }]}
          >
            <Ionicons name="close" size={22} color={palette.textMuted} />
          </Pressable>
        </View>

        {/* Now Playing */}
        {story && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>NOW PLAYING</Text>
            <View style={styles.nowPlayingRow}>
              {story.mediaUrl ? (
                <Image
                  source={{ uri: story.mediaUrl }}
                  style={styles.nowPlayingThumb}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.nowPlayingThumb, styles.thumbPlaceholder]} />
              )}
              <View style={styles.queueItemInfo}>
                <Text style={styles.nowPlayingTitle} numberOfLines={2}>
                  {story.title}
                </Text>
                <Text style={styles.queueItemMeta}>
                  {catMeta?.label ?? story.category}
                </Text>
              </View>
              <View style={[styles.playingBadge, { backgroundColor: (catMeta?.color ?? palette.accent) + "22" }]}>
                <Ionicons name="musical-notes" size={14} color={catMeta?.color ?? palette.accent} />
              </View>
            </View>
          </View>
        )}

        {/* Divider */}
        <View style={styles.divider} />

        {/* Queue list */}
        {queue.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>NEXT UP · {queue.length}</Text>
              <Pressable
                onPress={shuffleQueue}
                hitSlop={10}
                style={({ pressed }) => [styles.shuffleBtn, { opacity: pressed ? 0.5 : 1 }]}
              >
                <Ionicons name="shuffle" size={18} color={palette.textDim} />
              </Pressable>
            </View>
            <FlatList
              data={queue}
              keyExtractor={(item, idx) => `${item.articleId}-${idx}`}
              renderItem={({ item, index }) => (
                <QueueItem
                  story={item}
                  onPlay={() => { playFromQueue(index); onClose(); }}
                  onRemove={() => removeFromQueue(index)}
                />
              )}
              showsVerticalScrollIndicator={false}
              style={styles.list}
              contentContainerStyle={styles.listContent}
            />
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="list-outline" size={36} color={palette.textDim} />
            <Text style={styles.emptyTitle}>Queue is empty</Text>
            <Text style={styles.emptySubtext}>Swipe right on a story to add it</Text>
          </View>
        )}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  sheet: {
    position: "absolute",
    left: 10,
    right: 10,
    maxHeight: "75%",
    backgroundColor: palette.surfaceHigh,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.borderStrong,
    overflow: "hidden",
  },
  dragPillRow: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 4,
  },
  dragPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: palette.text,
  },
  section: {
    paddingHorizontal: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionLabel: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    color: palette.textDim,
    letterSpacing: 0.8,
  },
  shuffleBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  nowPlayingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  nowPlayingThumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
  },
  nowPlayingTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: palette.text,
    lineHeight: 20,
    marginBottom: 3,
  },
  playingBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: 1,
    backgroundColor: palette.border,
    marginHorizontal: 20,
    marginVertical: 16,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 4,
    paddingBottom: 16,
  },
  queueItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  queueThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  thumbPlaceholder: {
    backgroundColor: palette.border,
  },
  queueItemInfo: {
    flex: 1,
  },
  queueItemTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: palette.text,
    lineHeight: 18,
    marginBottom: 3,
  },
  queueItemMeta: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: palette.textDim,
  },
  removeBtn: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 10,
  },
  emptyTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    color: palette.textMuted,
  },
  emptySubtext: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: palette.textDim,
    textAlign: "center",
  },
});
