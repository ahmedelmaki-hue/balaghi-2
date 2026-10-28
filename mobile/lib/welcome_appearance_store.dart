import 'package:shared_preferences/shared_preferences.dart';

/// A local appearance choice for the phone-login welcome screen only.
class WelcomeAppearanceStore {
  const WelcomeAppearanceStore();

  static const _darkKey = 'phone_login_welcome_dark';

  Future<bool> loadDark() async {
    final preferences = await SharedPreferences.getInstance();
    return preferences.getBool(_darkKey) ?? false;
  }

  Future<void> saveDark(bool enabled) async {
    final preferences = await SharedPreferences.getInstance();
    if (!await preferences.setBool(_darkKey, enabled)) {
      throw StateError('Could not save phone-login welcome appearance');
    }
  }
}
