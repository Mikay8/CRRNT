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

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const isValid = email.trim() && password.length >= 6 && password === confirm;

  const handleRegister = async () => {
    if (!isValid) return;
    if (password !== confirm) {
      Alert.alert("Passwords don't match", "Please re-enter your password.");
      return;
    }
    setLoading(true);
    try {
      const { requiresConfirmation } = await register(email.trim().toLowerCase(), password);
      if (requiresConfirmation) {
        Alert.alert(
          "Check your email",
          "We sent you a confirmation link. Please verify your email then sign in.",
          [{ text: "OK", onPress: () => router.replace("/login" as any) }]
        );
      }
      // AuthGate handles the redirect to /onboarding once user state is set
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      Alert.alert("Registration failed", msg);
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
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 },
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
          Create your{"\n"}free account
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
              placeholder="At least 6 characters"
              placeholderTextColor="#4B5563"
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Confirm password</Text>
            <TextInput
              style={[
                styles.input,
                confirm && confirm !== password && styles.inputError,
              ]}
              value={confirm}
              onChangeText={setConfirm}
              placeholder="Re-enter password"
              placeholderTextColor="#4B5563"
              secureTextEntry
              autoCapitalize="none"
            />
            {confirm.length > 0 && confirm !== password ? (
              <Text style={styles.errorText}>Passwords don't match</Text>
            ) : null}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              !isValid && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
            onPress={handleRegister}
            disabled={!isValid || loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Create account</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <Pressable onPress={() => router.push("/login" as any)}>
            <Text style={styles.footerLink}>Sign in</Text>
          </Pressable>
        </View>
      </ScrollView>
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
  inputError: { borderColor: "#EF4444" },
  errorText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: "#EF4444",
    marginLeft: 2,
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
});
