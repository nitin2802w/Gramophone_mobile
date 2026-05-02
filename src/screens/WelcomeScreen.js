import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, StatusBar, Animated, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerUser, checkStatus, saveCredentials } from '../services/api';

// ── Theme ──────────────────────────────────────────────────────────────────────
const COLORS = {
  bg:       '#0d0d14',
  surface:  '#1d1d28',
  surface2: '#252534',
  violet:   '#9060f0',
  violet2:  '#b898ff',
  rose:     '#ff4570',
  teal:     '#00c8a8',
  amber:    '#f5a623',
  text:     '#e2d8f5',
  text2:    '#c4b8e0',
  muted:    '#4a4468',
  border:   'rgba(144,96,240,0.25)',
};

export default function WelcomeScreen({ navigation }) {
  const [name,      setName]      = useState('');
  const [loading,   setLoading]   = useState(false);
  const [step,      setStep]      = useState('check'); // 'check' | 'welcome'

  // Animations
  const fadeAnim    = useRef(new Animated.Value(0)).current;
  const slideAnim   = useRef(new Animated.Value(40)).current;
  const pulseAnim   = useRef(new Animated.Value(1)).current;
  const rotateAnim  = useRef(new Animated.Value(0)).current;

  // ── Check if already logged in ─────────────────────────────────────────────
  useEffect(() => {
    checkExistingSession();
  }, []);

  const checkExistingSession = async () => {
    try {
      const savedToken = await AsyncStorage.getItem('token');
      const savedName  = await AsyncStorage.getItem('username');

      if (savedToken && savedName) {
        // Already logged in — go to main app
        navigation.replace('Main');
      } else {
        setStep('welcome');
        startAnimations();
      }
    } catch (e) {
      setStep('welcome');
      startAnimations();
    }
  };

  const startAnimations = () => {
    // Fade in
    Animated.timing(fadeAnim, {
      toValue: 1, duration: 1000,
      useNativeDriver: true,
    }).start();

    // Slide up
    Animated.timing(slideAnim, {
      toValue: 0, duration: 800,
      useNativeDriver: true,
    }).start();

    // Pulse the logo
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08, duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1, duration: 1800,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Rotate vinyl
    Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1, duration: 8000,
        useNativeDriver: true,
      })
    ).start();
  };

  const spin = rotateAnim.interpolate({
    inputRange:  [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // ── Handle Connect ─────────────────────────────────────────────────────────
  const handleConnect = async () => {
    // Validate inputs
    if (!name.trim()) {
      Alert.alert('Missing Name', 'Please enter your name to continue.');
      return;
    }

    setLoading(true);

    try {
      // Step 1 — Check if server is reachable
      let status;
      try {
        status = await checkStatus();
      } catch (e) {
        Alert.alert(
          'Cannot Reach Server',
          'The server might be temporarily down. Please try again in a moment.',
        );
        setLoading(false);
        return;
      }

      if (!status.ok) {
        Alert.alert('Server Error', 'Server responded but something is wrong.');
        setLoading(false);
        return;
      }

      // Step 2 — Register user
      const result = await registerUser(name.trim());

      if (result.error) {
        Alert.alert('Registration Failed', result.error);
        setLoading(false);
        return;
      }

      // Step 3 — Save credentials (no URL needed — it's hardcoded)
      await saveCredentials(result.username, result.token);

      // Step 4 — Go to main app
      navigation.replace('Main');

    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.\n\n' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Loading / checking session ─────────────────────────────────────────────
  if (step === 'check') {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
        <ActivityIndicator size="large" color={COLORS.violet} />
      </View>
    );
  }

  // ── Welcome Screen ─────────────────────────────────────────────────────────
  return (
    <LinearGradient
      colors={['#1a0828', '#0d0d14', '#0a0a14']}
      style={styles.container}
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Header ── */}
          <Animated.View
            style={[
              styles.header,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            {/* Vinyl Logo */}
            <Animated.View
              style={[styles.vinylWrap, { transform: [{ scale: pulseAnim }] }]}
            >
              <Animated.View
                style={[styles.vinyl, { transform: [{ rotate: spin }] }]}
              >
                {/* Outer ring */}
                <LinearGradient
                  colors={['#1a1a2e', '#0d0d1a']}
                  style={styles.vinylDisc}
                >
                  {/* Grooves */}
                  <View style={styles.groove1} />
                  <View style={styles.groove2} />
                  <View style={styles.groove3} />

                  {/* Center label */}
                  <LinearGradient
                    colors={[COLORS.violet, '#4a1a8a']}
                    style={styles.vinylCenter}
                  >
                    <View style={styles.vinylHole} />
                  </LinearGradient>
                </LinearGradient>
              </Animated.View>

              {/* Glow effect */}
              <View style={styles.vinylGlow} />
            </Animated.View>

            {/* App Name */}
            <Text style={styles.appName}>GRAMOPHONE</Text>
            <Text style={styles.appSubtitle}>Your Personal Music Server</Text>
          </Animated.View>

          {/* ── Form ── */}
          <Animated.View
            style={[
              styles.form,
              { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
            ]}
          >
            {/* Welcome text */}
            <Text style={styles.welcomeText}>Welcome</Text>
            <Text style={styles.welcomeSub}>
              Enter your name to get started
            </Text>

            {/* Name Input */}
            <View style={styles.inputWrap}>
              <Text style={styles.inputLabel}>YOUR NAME</Text>
              <View style={styles.inputContainer}>
                <Text style={styles.inputIcon}>👤</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your name"
                  placeholderTextColor={COLORS.muted}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleConnect}
                />
              </View>
            </View>

            {/* Connect Button */}
            <TouchableOpacity
              style={styles.connectBtn}
              onPress={handleConnect}
              disabled={loading}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={[COLORS.violet, COLORS.rose]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.connectGradient}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.connectText}>Get Started  →</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Info text */}
            <Text style={styles.infoText}>
              First time? Just enter your name.{'\n'}
              Your account will be created automatically.
            </Text>
          </Animated.View>

          {/* ── Footer ── */}
          <Animated.View style={[styles.footer, { opacity: fadeAnim }]}>
            <View style={styles.footerDot} />
            <Text style={styles.footerText}>Free Music Forever</Text>
            <View style={styles.footerDot} />
          </Animated.View>

        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0d0d14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 80,
    paddingBottom: 40,
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  vinylWrap: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  vinyl: {
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  vinylDisc: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(144,96,240,0.3)',
  },
  groove1: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 0.5,
    borderColor: 'rgba(144,96,240,0.15)',
  },
  groove2: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 0.5,
    borderColor: 'rgba(144,96,240,0.12)',
  },
  groove3: {
    position: 'absolute',
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 0.5,
    borderColor: 'rgba(144,96,240,0.1)',
  },
  vinylCenter: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vinylHole: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0d0d14',
  },
  vinylGlow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(144,96,240,0.12)',
  },
  appName: {
    fontSize: 28,
    fontWeight: '900',
    color: COLORS.text,
    letterSpacing: 8,
    marginBottom: 6,
  },
  appSubtitle: {
    fontSize: 12,
    color: COLORS.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // Form
  form: {
    flex: 1,
  },
  welcomeText: {
    fontSize: 32,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 6,
  },
  welcomeSub: {
    fontSize: 14,
    color: COLORS.muted,
    marginBottom: 32,
    lineHeight: 20,
  },
  inputWrap: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.violet2,
    letterSpacing: 2,
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 16,
    height: 56,
  },
  inputIcon: {
    fontSize: 18,
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: COLORS.text,
    fontSize: 15,
    height: '100%',
  },

  // Button
  connectBtn: {
    marginTop: 8,
    marginBottom: 24,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: COLORS.violet,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  connectGradient: {
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // Info
  infoText: {
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
    gap: 8,
  },
  footerDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.muted,
  },
  footerText: {
    fontSize: 11,
    color: COLORS.muted,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});