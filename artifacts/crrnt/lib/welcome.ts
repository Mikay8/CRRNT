/**
 * First-run welcome gate.
 *
 * The welcome screen owns the first notification ask: it shows once, on
 * native, only while the OS notification permission is still undecided.
 * Users who already granted or denied permission never see it — their
 * decision stands. Dismissing it (either button) marks it seen so it
 * never reappears.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const WELCOME_SEEN_KEY = "@crrnt/welcome-seen/v1";

export async function hasSeenWelcome(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(WELCOME_SEEN_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function markWelcomeSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(WELCOME_SEEN_KEY, "1");
  } catch {
    // Non-critical: the gate re-checks permission next launch.
  }
}
