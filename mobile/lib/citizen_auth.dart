import 'dart:async';
import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

class AuthFailure implements Exception {
  const AuthFailure(this.message, {this.network = false, this.status});
  final String message;

  /// True when the server could not be reached, not when it refused the request.
  final bool network;

  /// The HTTP status of a reply that was not a success; null without a reply.
  final int? status;

  /// True when the server refused the session itself (signed out, expired or
  /// suspended), not when it was restarting, busy or unreachable.
  bool get sessionRefused => status == 401 || status == 403;
}

/// Shown when the municipality suspended the citizen's account (HTTP 403).
const suspendedAccountMessage = 'حسابك موقوف. تواصل مع البلدية لمعرفة السبب.';

String? normalizeLibyanMobile(String input) {
  final digits = input.replaceAll(RegExp(r'\D'), '');
  final national = digits.startsWith('218')
      ? digits.substring(3)
      : digits.startsWith('0')
      ? digits.substring(1)
      : digits;
  return RegExp(r'^9\d{8}$').hasMatch(national) ? '+218$national' : null;
}

class CitizenSession {
  const CitizenSession({
    required this.accessToken,
    required this.refreshToken,
    required this.phone,
    required this.expiresAt,
    this.fullName,
    this.needsProfile = false,
  });

  final String accessToken;
  final String refreshToken;
  final String phone;
  final String? fullName;
  final DateTime expiresAt;
  final bool needsProfile;

  CitizenSession copyWith({String? fullName, bool? needsProfile}) =>
      CitizenSession(
        accessToken: accessToken,
        refreshToken: refreshToken,
        phone: phone,
        expiresAt: expiresAt,
        fullName: fullName ?? this.fullName,
        needsProfile: needsProfile ?? this.needsProfile,
      );

  Map<String, dynamic> toJson() => {
    'access_token': accessToken,
    'refresh_token': refreshToken,
    'phone': phone,
    'full_name': fullName,
    'expires_at': expiresAt.toIso8601String(),
    'needs_profile': needsProfile,
  };

  factory CitizenSession.fromSaved(Map<String, dynamic> json) {
    return CitizenSession(
      accessToken: json['access_token'] as String,
      refreshToken: json['refresh_token'] as String,
      phone: json['phone'] as String,
      fullName: json['full_name'] as String?,
      expiresAt: DateTime.parse(json['expires_at'] as String),
      needsProfile: json['needs_profile'] == true,
    );
  }

  factory CitizenSession.fromResponse(Map<String, dynamic> json) {
    final session = Map<String, dynamic>.from(json['session'] as Map);
    final user = Map<String, dynamic>.from(json['user'] as Map);
    final accessToken = session['access_token'] as String?;
    final refreshToken = session['refresh_token'] as String?;
    final phone = user['phone'] as String?;
    final expiresIn = session['expires_in'] as num?;
    if (accessToken == null ||
        accessToken.isEmpty ||
        refreshToken == null ||
        refreshToken.isEmpty ||
        phone == null ||
        expiresIn == null) {
      throw const FormatException('Invalid authentication response');
    }
    return CitizenSession(
      accessToken: accessToken,
      refreshToken: refreshToken,
      phone: phone,
      fullName: user['full_name'] as String?,
      expiresAt: DateTime.now().add(Duration(seconds: expiresIn.toInt())),
      needsProfile: json['needs_profile'] == true,
    );
  }
}

class CitizenAuthStore {
  const CitizenAuthStore();
  static const _storage = FlutterSecureStorage();
  static const _key = 'citizen_session';

  Future<void> save(CitizenSession session) =>
      _storage.write(key: _key, value: jsonEncode(session.toJson()));

  Future<CitizenSession?> load() async {
    try {
      final saved = await _storage.read(key: _key);
      if (saved == null) return null;
      return CitizenSession.fromSaved(
        jsonDecode(saved) as Map<String, dynamic>,
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> clear() => _storage.delete(key: _key);
}

class CitizenAuthApi {
  CitizenAuthApi({required String baseUrl, http.Client? client})
    : _baseUrl = baseUrl.replaceFirst(RegExp(r'/$'), ''),
      _client = client ?? http.Client(),
      _ownsClient = client == null;

  final String _baseUrl;
  final http.Client _client;
  final bool _ownsClient;

  Future<Map<String, dynamic>> _post(
    String path,
    Map<String, dynamic> body, {
    String? accessToken,
  }) async {
    http.Response response;
    try {
      response = await _client
          .post(
            Uri.parse('$_baseUrl$path'),
            headers: {
              'content-type': 'application/json',
              if (accessToken != null) 'authorization': 'Bearer $accessToken',
            },
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 12));
    } catch (_) {
      throw const AuthFailure(
        'تعذر الاتصال بالخادم. تحقق من الشبكة ثم حاول مجددًا.',
        network: true,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final status = response.statusCode;
      if (status == 429) {
        throw AuthFailure(
          path == '/auth/otp/verify'
              ? 'محاولات كثيرة متتالية. انتظر بضع دقائق ثم أعد المحاولة.'
              : 'انتظر قليلًا قبل طلب رمز جديد.',
          status: status,
        );
      }
      if (status == 403) {
        throw AuthFailure(suspendedAccountMessage, status: status);
      }
      if (path == '/auth/otp/verify' && status == 401) {
        throw AuthFailure('رمز تحقق خاطئ', status: status);
      }
      throw AuthFailure('تعذر إكمال الطلب. حاول مجددًا.', status: status);
    }
    try {
      return jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw const AuthFailure('استجابة الخادم غير صالحة.');
    }
  }

  Future<void> sendOtp(String phone) async {
    await _post('/auth/otp/send', {'phone': phone});
  }

  Future<CitizenSession> verifyOtp(String phone, String code) async {
    try {
      return CitizenSession.fromResponse(
        await _post('/auth/otp/verify', {'phone': phone, 'code': code}),
      );
    } on FormatException {
      throw const AuthFailure('استجابة الخادم غير صالحة.');
    } on TypeError {
      throw const AuthFailure('استجابة الخادم غير صالحة.');
    }
  }

  Future<CitizenSession> completeProfile(
    CitizenSession session,
    String fullName,
  ) async {
    http.Response response;
    try {
      response = await _client
          .patch(
            Uri.parse('$_baseUrl/auth/me'),
            headers: {
              'content-type': 'application/json',
              'authorization': 'Bearer ${session.accessToken}',
            },
            body: jsonEncode({'full_name': fullName}),
          )
          .timeout(const Duration(seconds: 12));
    } catch (_) {
      throw const AuthFailure(
        'تعذر الاتصال بالخادم. تحقق من الشبكة ثم حاول مجددًا.',
      );
    }
    if (response.statusCode == 403) {
      throw const AuthFailure(suspendedAccountMessage);
    }
    if (response.statusCode != 200) {
      throw const AuthFailure('تعذر حفظ الاسم. حاول مجددًا.');
    }
    return session.copyWith(fullName: fullName, needsProfile: false);
  }

  Future<CitizenSession> refresh(CitizenSession session) async {
    try {
      return CitizenSession.fromResponse(
        await _post('/auth/refresh', {'refresh_token': session.refreshToken}),
      );
    } on FormatException {
      throw const AuthFailure('استجابة الخادم غير صالحة.');
    } on TypeError {
      throw const AuthFailure('استجابة الخادم غير صالحة.');
    }
  }

  Future<CitizenSession?> restore(CitizenAuthStore store) async {
    final saved = await store.load();
    if (saved == null) return null;
    if (saved.expiresAt.isAfter(
      DateTime.now().add(const Duration(minutes: 1)),
    )) {
      return saved;
    }
    try {
      final refreshed = await refresh(saved);
      await store.save(refreshed);
      return refreshed;
    } on AuthFailure catch (error) {
      // Only a refusal ends the session. Offline, or with the server restarting
      // or busy, the session is kept and refreshed on the next try; signing in
      // again would cost the citizen another SMS code.
      if (!error.sessionRefused) return saved;
      await store.clear();
      return null;
    } catch (_) {
      await store.clear();
      return null;
    }
  }

  void dispose() {
    if (_ownsClient) _client.close();
  }
}
