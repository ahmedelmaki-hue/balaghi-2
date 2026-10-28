import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'onboarding_screen.dart';
import 'public_map_screen.dart';

// Onboarding shows on the first launch only. Set to true while reviewing its
// design to show it on every launch.
const _showOnboardingEveryLaunch = false;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const BalaghiApp());
}

ThemeData buildBalaghiTheme() {
  final baseTheme = ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: const Color(0xFFF7F8FA),
    colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFF2C94C)),
  );
  return baseTheme.copyWith(
    textTheme: GoogleFonts.cairoTextTheme(baseTheme.textTheme),
    primaryTextTheme: GoogleFonts.cairoTextTheme(baseTheme.primaryTextTheme),
  );
}

class BalaghiApp extends StatelessWidget {
  const BalaghiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'بلاغي',
      debugShowCheckedModeBanner: false,
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      theme: buildBalaghiTheme(),
      home: const _OnboardingGate(),
    );
  }
}

class _OnboardingGate extends StatefulWidget {
  const _OnboardingGate();

  @override
  State<_OnboardingGate> createState() => _OnboardingGateState();
}

class _OnboardingGateState extends State<_OnboardingGate> {
  static const _completedKey = 'onboarding_completed';
  final _preferences = SharedPreferencesAsync();
  bool? _completed = _showOnboardingEveryLaunch ? false : null;

  @override
  void initState() {
    super.initState();
    if (!_showOnboardingEveryLaunch) _readCompletion();
  }

  Future<void> _readCompletion() async {
    bool completed;
    try {
      completed = await _preferences.getBool(_completedKey) ?? false;
    } catch (_) {
      completed = false;
    }
    if (mounted) setState(() => _completed = completed);
  }

  Future<void> _finishOnboarding() async {
    try {
      await _preferences.setBool(_completedKey, true);
    } catch (_) {
      // The visitor can still enter the app if local preferences are unavailable.
    }
    if (mounted) setState(() => _completed = true);
  }

  @override
  Widget build(BuildContext context) {
    if (_completed == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_completed!) return const PublicMapScreen();
    return OnboardingScreen(onFinish: _finishOnboarding);
  }
}
