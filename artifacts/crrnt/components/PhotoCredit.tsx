import { Linking, StyleSheet, Text, View } from "react-native";

const UTM = "utm_source=crrnt&utm_medium=referral";

/**
 * Photo overlay credit: "Photo by {name} on {source}", source-aware.
 *
 * The story's image_source decides the suffix and links:
 * - "pixabay": "on Pixabay" linking to pixabay.com, and the
 *   photographer's link is the photo page as stored — no UTM params
 *   (those are an Unsplash convention).
 * - "manual": an admin hand-set image (admin portal) — no source
 *   suffix at all, since the credit URL can point anywhere.
 * - anything else (including unset, for stories that predate the
 *   field): the original Unsplash rendering, with both parts as
 *   tappable links carrying the UTM params the Unsplash API
 *   guidelines require.
 *
 * Renders nothing without a photographer name. Place inside a
 * relatively-positioned image container; the pill anchors bottom-left.
 * The pill itself passes touches through (box-none) so taps on its
 * padding still reach the card underneath; taps on the linked text
 * open the link instead of the card, like the card's other nested
 * buttons.
 */
export default function PhotoCredit({
  name,
  profileUrl,
  source,
  bottom = 10,
}: {
  name?: string | null;
  profileUrl?: string | null;
  /** The story's image_source ("unsplash" | "pixabay" | "manual"). */
  source?: string | null;
  /** Distance from the image's bottom edge. Detail heroes need 60: the content card overlaps the hero's bottom 50px. */
  bottom?: number;
}) {
  if (!name) return null;
  const provider =
    source === "pixabay"
      ? { label: "Pixabay", url: "https://pixabay.com/", utm: false }
      : source === "manual"
        ? null
        : {
            label: "Unsplash",
            url: `https://unsplash.com/?${UTM}`,
            utm: true,
          };
  return (
    <View pointerEvents="box-none" style={[styles.pill, { bottom }]}>
      <Text style={styles.text}>
        Photo by{" "}
        {profileUrl ? (
          <Text
            style={styles.link}
            onPress={() =>
              void Linking.openURL(
                provider?.utm ? withUtm(profileUrl) : profileUrl,
              )
            }
          >
            {name}
          </Text>
        ) : (
          name
        )}
        {provider ? (
          <>
            {" "}
            on{" "}
            <Text
              style={styles.link}
              onPress={() => void Linking.openURL(provider.url)}
            >
              {provider.label}
            </Text>
          </>
        ) : null}
      </Text>
    </View>
  );
}

function withUtm(url: string): string {
  return url.includes("?") ? `${url}&${UTM}` : `${url}?${UTM}`;
}

const styles = StyleSheet.create({
  pill: {
    position: "absolute",
    left: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  text: {
    fontFamily: "Inter_500Medium",
    fontSize: 11,
    color: "#FFFFFF",
  },
  link: {
    textDecorationLine: "underline",
  },
});
