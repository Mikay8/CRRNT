import { Linking, StyleSheet, Text, View } from "react-native";

const UTM = "utm_source=crrnt&utm_medium=referral";

/**
 * Unsplash overlay credit: "Photo by {name} on Unsplash", with both parts as
 * tappable links carrying the UTM params the Unsplash API guidelines require.
 * Renders nothing without a photographer name. Place inside a
 * relatively-positioned image container; the pill anchors bottom-left.
 * The pill itself passes touches through (box-none) so taps on its padding
 * still reach the card underneath; taps on the linked text open the link
 * instead of the card, like the card's other nested buttons.
 */
export default function PhotoCredit({
  name,
  profileUrl,
  bottom = 10,
}: {
  name?: string | null;
  profileUrl?: string | null;
  /** Distance from the image's bottom edge. Detail heroes need 60: the content card overlaps the hero's bottom 50px. */
  bottom?: number;
}) {
  if (!name) return null;
  return (
    <View pointerEvents="box-none" style={[styles.pill, { bottom }]}>
      <Text style={styles.text}>
        Photo by{" "}
        {profileUrl ? (
          <Text
            style={styles.link}
            onPress={() => void Linking.openURL(withUtm(profileUrl))}
          >
            {name}
          </Text>
        ) : (
          name
        )}{" "}
        on{" "}
        <Text
          style={styles.link}
          onPress={() => void Linking.openURL(`https://unsplash.com/?${UTM}`)}
        >
          Unsplash
        </Text>
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
