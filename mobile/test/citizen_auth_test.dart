import 'dart:convert';

import 'package:balaghi/citizen_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('normalizes Libyan mobile numbers before sending OTP', () {
    expect(normalizeLibyanMobile('091 234 5678'), '+218912345678');
    expect(normalizeLibyanMobile('+218 91 234 5678'), '+218912345678');
    expect(normalizeLibyanMobile('912345678'), '+218912345678');
    expect(normalizeLibyanMobile('0212345678'), isNull);
    expect(normalizeLibyanMobile('091234567'), isNull);
  });

  test('uses phone OTP and completes the citizen profile', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      if (request.url.path == '/api/auth/otp/send') {
        return http.Response('{"message":"verification code requested"}', 200);
      }
      if (request.url.path == '/api/auth/otp/verify') {
        return http.Response(
          jsonEncode({
            'user': {'phone': '+218912345678', 'full_name': null},
            'needs_profile': true,
            'session': {
              'access_token': 'access-token',
              'refresh_token': 'refresh-token',
              'expires_in': 3600,
            },
          }),
          200,
        );
      }
      if (request.url.path == '/api/auth/me') {
        return http.Response(
          jsonEncode({
            'user': {'full_name': 'أحمد الحي'},
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      return http.Response('not found', 404);
    });
    final api = CitizenAuthApi(
      baseUrl: 'https://example.org/api/',
      client: client,
    );

    await api.sendOtp('+218912345678');
    final session = await api.verifyOtp('+218912345678', '123456');
    final completed = await api.completeProfile(session, 'أحمد الحي');

    expect(session.needsProfile, isTrue);
    expect(completed.needsProfile, isFalse);
    expect(completed.fullName, 'أحمد الحي');
    expect(requests.map((request) => request.method), [
      'POST',
      'POST',
      'PATCH',
    ]);
    expect(jsonDecode(requests[0].body), {'phone': '+218912345678'});
    expect(jsonDecode(requests[1].body), {
      'phone': '+218912345678',
      'code': '123456',
    });
    expect(requests[2].headers['authorization'], 'Bearer access-token');
    expect(jsonDecode(requests[2].body), {'full_name': 'أحمد الحي'});
    api.dispose();
    client.close();
  });

  test('rejects an invalid OTP without treating it as a session', () async {
    final api = CitizenAuthApi(
      baseUrl: 'https://example.org/api',
      client: MockClient((_) async => http.Response('invalid code', 401)),
    );

    await expectLater(
      api.verifyOtp('+218912345678', '000000'),
      throwsA(
        isA<AuthFailure>().having(
          (error) => error.message,
          'message',
          'رمز تحقق خاطئ',
        ),
      ),
    );
    api.dispose();
  });

  test('a suspended citizen sees why the code cannot be sent', () async {
    final api = CitizenAuthApi(
      baseUrl: 'https://example.test/api',
      client: MockClient(
        (_) async => http.Response('{"error":"account disabled"}', 403),
      ),
    );
    await expectLater(
      api.sendOtp('+218912345678'),
      throwsA(
        isA<AuthFailure>().having(
          (error) => error.message,
          'message',
          suspendedAccountMessage,
        ),
      ),
    );
    api.dispose();
  });
}
