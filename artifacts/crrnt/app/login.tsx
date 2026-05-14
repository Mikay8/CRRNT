import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/contexts/AuthContext";

const LOGO_DARK = require("@/assets/images/full-logo-dark.png") as number;

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login, enterGuestMode } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      // AuthGate handles redirect to /(tabs) or /onboarding once user state is set
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed";
      Alert.alert("Login failed", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 72 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Image
          source={LOGO_DARK}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="CRRNT"
        />

        <Text style={styles.tagline}>
          The news that actually{"\n"}affects your life.
        </Text>

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#4B5563"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#4B5563"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
            />
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              (!email || !password || loading) && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
            onPress={handleLogin}
            disabled={!email || !password || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>

          <Pressable
            style={styles.forgotRow}
            onPress={() => router.push("/auth/forgot-password" as any)}
          >
            <Text style={styles.forgotLink}>Forgot password?</Text>
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Don't have an account? </Text>
          <Pressable onPress={() => router.push("/auth/register" as any)}>
            <Text style={styles.footerLink}>Create one</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Pressable
        style={[styles.guestRow, { paddingBottom: insets.bottom + 12 }]}
        onPress={async () => {
          await enterGuestMode();
          router.replace("/(tabs)" as any);
        }}
      >
        <Text style={styles.guestLink}>Browse without an account</Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#090D12" },
  container: {
    flexGrow: 1,
    paddingHorizontal: 28,
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
  },
  logo: { width: 120, height: 36, marginBottom: 20 },
  tagline: {
    fontFamily: "Outfit_700Bold",
    fontSize: 26,
    color: "#F9FAFB",
    textAlign: "center",
    lineHeight: 34,
    marginBottom: 40,
  },
  form: { width: "100%", gap: 16 },
  field: { gap: 6 },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: "#9CA3AF",
    marginLeft: 2,
  },
  input: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1F2937",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#F9FAFB",
    fontFamily: "Inter_400Regular",
    fontSize: 16,
  },
  button: {
    backgroundColor: "#06B6D4",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.8 },
  buttonText: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: "#fff",
  },
  forgotRow: {
    alignItems: "center",
    marginTop: 12,
  },
  forgotLink: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: "#6B7280",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 28,
  },
  footerText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: "#6B7280",
  },
  footerLink: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: "#06B6D4",
  },
  guestRow: {
    alignItems: "center",
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#1F2937",
    backgroundColor: "#090D12",
  },
  guestLink: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: "#4B5563",
    textDecorationLine: "underline",
  },
});
