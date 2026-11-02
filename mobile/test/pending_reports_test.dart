import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:balaghi/citizen_auth.dart';
import 'package:balaghi/create_report_repository.dart';
import 'package:balaghi/my_reports_repository.dart';
import 'package:balaghi/my_reports_screen.dart';
import 'package:balaghi/pending_reports.dart';
import 'package:balaghi/public_reports.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';

void main() {
  late Directory directory;
  late PendingReportStore store;
  final image = Uint8List.fromList([0xff, 0xd8, 0xff, 0xd9]);
  final session = CitizenSession(
    accessToken: 'test-token',
    refreshToken: 'refresh-token',
    phone: '+218912345678',
    expiresAt: DateTime.now().add(const Duration(hours: 1)),
  );

  PendingReport pending(String id, {String phone = '+218912345678'}) =>
      PendingReport(
        clientRequestId: id,
        ownerPhone: phone,
        category: ReportCategory.waterLeak,
        location: const LatLng(32.89, 13.19),
        imageMimeType: 'image/jpeg',
        savedAt: DateTime.parse('2026-10-27T10:00:00Z'),
        description: 'تسرب أمام المدرسة',
      );

  const createdJson = '''{
    "id":"55", "category":"water_leak", "status":"new",
    "latitude":32.89, "longitude":13.19,
    "created_at":"2026-10-27T10:05:00Z", "image_url":null
  }''';

  setUp(() async {
    directory = await Directory.systemTemp.createTemp('pending_reports_test');
    store = PendingReportStore(directory: () async => directory);
  });

  tearDown(() async {
    try {
      if (await directory.exists()) await directory.delete(recursive: true);
    } on FileSystemException {
      // Windows may still hold a displayed photo open; the OS cleans temp files.
    }
  });

  test('keeps saved reports per citizen with their photo', () async {
    await store.save(pending('11111111-1111-4111-8111-111111111111'), image);
    await store.save(
      pending('22222222-2222-4222-8222-222222222222', phone: '+218911111111'),
      image,
    );

    final mine = await store.load('+218912345678');
    expect(mine, hasLength(1));
    expect(mine.single.category, ReportCategory.waterLeak);
    expect(mine.single.description, 'تسرب أمام المدرسة');
    expect(await File(mine.single.imagePath).readAsBytes(), image);

    await store.remove(mine.single);
    expect(await store.load('+218912345678'), isEmpty);
    expect(await File(mine.single.imagePath).exists(), isFalse);
    expect(await store.load('+218911111111'), hasLength(1));
  });

  test('sends saved reports with their original request id', () async {
    final requestIds = <String>[];
    final repository = CreateReportRepository(
      baseUrl: 'https://example.test/api',
      client: MockClient((request) async {
        final body = latin1.decode(request.bodyBytes);
        requestIds.add(
          RegExp(
            r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}',
          ).firstMatch(body)!.group(0)!,
        );
        return http.Response(createdJson, 201);
      }),
    );
    await store.save(pending('11111111-1111-4111-8111-111111111111'), image);

    final result = await sendPendingReports(
      session: session,
      store: store,
      repository: repository,
    );

    expect(result.sent, 1);
    expect(result.remaining, isEmpty);
    expect(result.error, isNull);
    expect(requestIds, ['11111111-1111-4111-8111-111111111111']);
    repository.dispose();
  });

  test('keeps reports on the device while the server is unreachable', () async {
    var attempts = 0;
    final repository = CreateReportRepository(
      baseUrl: 'https://example.test/api',
      client: MockClient((_) async {
        attempts++;
        throw const SocketException('offline');
      }),
    );
    await store.save(pending('11111111-1111-4111-8111-111111111111'), image);
    await store.save(pending('22222222-2222-4222-8222-222222222222'), image);

    final result = await sendPendingReports(
      session: session,
      store: store,
      repository: repository,
    );

    expect(result.sent, 0);
    expect(result.remaining, hasLength(2));
    expect(result.error, isNull);
    expect(attempts, 1, reason: 'stops after the first connection failure');
    repository.dispose();
  });

  test('reports a server refusal without deleting the saved report', () async {
    final repository = CreateReportRepository(
      baseUrl: 'https://example.test/api',
      client: MockClient((_) async => http.Response('{}', 422)),
    );
    await store.save(pending('11111111-1111-4111-8111-111111111111'), image);

    final result = await sendPendingReports(
      session: session,
      store: store,
      repository: repository,
    );

    expect(result.sent, 0);
    expect(result.remaining, hasLength(1));
    expect(result.error, contains('خارج النطاق'));
    repository.dispose();
  });

  test('only connection and server failures can be saved for later', () async {
    Future<CreateReportFailure> failure(http.Response response) async {
      final repository = CreateReportRepository(
        baseUrl: 'https://example.test/api',
        client: MockClient((_) async => response),
      );
      try {
        await repository.submit(
          session: session,
          category: ReportCategory.garbage,
          location: const LatLng(32.89, 13.19),
          imageBytes: image,
          imageMimeType: 'image/jpeg',
          clientRequestId: '11111111-1111-4111-8111-111111111111',
        );
        fail('submit should fail');
      } on CreateReportFailure catch (error) {
        return error;
      } finally {
        repository.dispose();
      }
    }

    expect((await failure(http.Response('', 503))).canRetryLater, isTrue);
    expect((await failure(http.Response('', 422))).canRetryLater, isFalse);
    expect((await failure(http.Response('', 401))).canRetryLater, isFalse);
    final suspended = await failure(http.Response('', 403));
    expect(suspended.canRetryLater, isFalse);
    expect(suspended.message, suspendedAccountMessage);
    final dailyLimit = await failure(
      http.Response('{"error":"daily report limit reached"}', 429),
    );
    expect(dailyLimit.canRetryLater, isFalse);
    expect(dailyLimit.message, dailyReportLimitMessage);
  });

  test('an offline session refresh keeps the citizen signed in', () async {
    final expired = CitizenSession(
      accessToken: 'old-token',
      refreshToken: 'refresh-token',
      phone: '+218912345678',
      expiresAt: DateTime.now().subtract(const Duration(minutes: 5)),
    );
    FlutterSecureStorage.setMockInitialValues({
      'citizen_session': jsonEncode(expired.toJson()),
    });
    const authStore = CitizenAuthStore();
    final offline = CitizenAuthApi(
      baseUrl: 'https://example.test/api',
      client: MockClient((_) async => throw const SocketException('offline')),
    );

    final restored = await offline.restore(authStore);
    expect(restored?.refreshToken, 'refresh-token');
    expect(await authStore.load(), isNotNull);
    offline.dispose();

    final refused = CitizenAuthApi(
      baseUrl: 'https://example.test/api',
      client: MockClient((_) async => http.Response('{}', 401)),
    );
    expect(await refused.restore(authStore), isNull);
    expect(await authStore.load(), isNull);
    refused.dispose();
  });

  testWidgets('My Reports shows a saved report until it reaches the server', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({
      'citizen_session': jsonEncode(session.toJson()),
    });
    await tester.runAsync(
      () => store.save(pending('11111111-1111-4111-8111-111111111111'), image),
    );
    final offline = CreateReportRepository(
      baseUrl: 'https://example.test/api',
      client: MockClient((_) async => throw const SocketException('offline')),
    );
    final emptyPage = MyReportsRepository(
      baseUrl: 'https://example.test/api',
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({'items': [], 'page': 1, 'total_pages': 0}),
          200,
        ),
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: MyReportsScreen(
          previewMode: false,
          repository: emptyPage,
          pendingStore: store,
          createRepository: offline,
        ),
      ),
    );
    for (
      var i = 0;
      i < 30 && find.text('بانتظار الإرسال').evaluate().isEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }

    expect(find.text('بانتظار الإرسال'), findsOneWidget);
    expect(find.text('محفوظ على جهازك'), findsOneWidget);
    expect(find.text('إرسال الآن'), findsOneWidget);
    expect(find.text('لم ترسل أي بلاغ بعد'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    offline.dispose();
    emptyPage.dispose();
  });
}
