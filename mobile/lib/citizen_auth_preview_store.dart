import 'package:shared_preferences/shared_preferences.dart';

/// Remembers only that the local login preview was completed.
/// It never grants access to authenticated API requests.
class CitizenAuthPreviewStore {
  const CitizenAuthPreviewStore();

  static const _completedKey = 'citizen_auth_preview_completed';
  static const _nameKey = 'citizen_auth_preview_name';
  static const _phoneKey = 'citizen_auth_preview_phone';

  Future<bool> isCompleted() async {
    try {
      final preferences = await SharedPreferences.getInstance();
      return preferences.getBool(_completedKey) ?? false;
    } catch (_) {
      return false;
    }
  }

  Future<({String? fullName, String? phone})> loadProfile() async {
    final preferences = await SharedPreferences.getInstance();
    return (
      fullName: preferences.getString(_nameKey),
      phone: preferences.getString(_phoneKey),
    );
  }

  Future<void> markCompleted({String? fullName, String? phone}) async {
    final preferences = await SharedPreferences.getInstance();
    if (fullName != null && !await preferences.setString(_nameKey, fullName)) {
      throw StateError('Could not save login preview name');
    }
    if (phone != null && !await preferences.setString(_phoneKey, phone)) {
      throw StateError('Could not save login preview phone');
    }
    if (!await preferences.setBool(_completedKey, true)) {
      throw StateError('Could not save login preview completion');
    }
  }

  Future<void> updateName(String fullName) async {
    final preferences = await SharedPreferences.getInstance();
    if (!await preferences.setString(_nameKey, fullName)) {
      throw StateError('Could not save login preview name');
    }
  }

  Future<void> clear() async {
    final preferences = await SharedPreferences.getInstance();
    if (!await preferences.remove(_completedKey) ||
        !await preferences.remove(_nameKey) ||
        !await preferences.remove(_phoneKey)) {
      throw StateError('Could not clear login preview');
    }
  }
}
