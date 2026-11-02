import 'dart:convert';
import 'dart:io';

import 'package:balaghi/citizen_auth.dart';
import 'package:balaghi/my_reports_repository.dart';
import 'package:balaghi/my_reports_screen.dart';
import 'package:balaghi/pending_reports.dart';
import 'package:balaghi/report_updates.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  const phone = '+218912345678';
  final session = CitizenSession(
    accessToken: 'test-token',
    refreshToken: 'refresh-token',
    phone: phone,
    expiresAt: DateTime.now().add(const Duration(hours: 1)),
  );

  // status: pending (awaiting review), new, in_progress, resolved or rejected.
  Map<String, dynamic> json(String id, String status) => {
    'id': id,
    'category': 'pothole',
    'status': status == 'pending' ? 'new' : status,
    'approved_at': status == 'pending' || status == 'rejected'
        ? null
        : '2026-11-02T09:00:00Z',
    'latitude': 32.89,
    'longitude': 13.19,
    'created_at': '2026-11-02T08:00:00Z',
    'image_url': null,
  };
  MyReport report(String id, String status) =>
      MyReport.fromJson(json(id, status));

  MyReportsRepository serverWith(List<Map<String, dynamic>> Function() items) =>
      MyReportsRepository(
        baseUrl: 'https://example.test/api',
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({'items': items(), 'page': 1, 'total_pages': 1}),
            200,
          ),
        ),
      );

  setUp(() => SharedPreferences.setMockInitialValues({}));

  test('the stage is what the citizen sees, not staff-only steps', () {
    expect(reportStage(report('1', 'pending')), 'pending');
    expect(reportStage(report('2', 'new')), 'new');
    expect(reportStage(report('3', 'in_progress')), 'in_progress');
    expect(reportStage(report('4', 'resolved')), 'resolved');
    expect(reportStage(report('5', 'rejected')), 'rejected');
  });

  test('only reports that moved since the last visit count', () {
    final seen = {'1': 'pending', '2': 'new', '3': 'in_progress'};
    final now = [
      report('1', 'new'), // approved since
      report('2', 'new'), // unchanged
      report('3', 'resolved'), // resolved since
      report('4', 'pending'), // sent since, still awaiting review
      report('5', 'rejected'), // sent and rejected since
    ];
    expect(changedReports(seen, now), {'1', '3', '5'});
    expect(changedReports(null, now), isEmpty);
  });

  test(
    'a visit records what was shown and keeps the reports not shown',
    () async {
      const store = SeenReportStore();
      await store.save(phone, {'1': 'pending', '9': 'resolved'});

      final changed = await markReportsSeen(store, phone, [report('1', 'new')]);

      expect(changed, {'1'});
      expect(await store.load(phone), {'1': 'new', '9': 'resolved'});
      expect(
        await markReportsSeen(store, phone, [report('1', 'new')]),
        isEmpty,
      );
      expect(await store.load('+218911111111'), isNull);
    },
  );

  test('the badge starts from a baseline, then counts changes', () async {
    var stage = 'pending';
    final server = serverWith(() => [json('1', stage), json('2', 'new')]);

    expect(await countReportUpdates(session: session, repository: server), 0);
    stage = 'in_progress';
    expect(await countReportUpdates(session: session, repository: server), 1);
    server.dispose();
  });

  testWidgets('My Reports marks the report that changed since the last visit', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({
      'citizen_session': jsonEncode(session.toJson()),
    });
    SharedPreferences.setMockInitialValues({
      'seen_report_stages_$phone': jsonEncode({'1': 'pending', '2': 'new'}),
    });
    final directory = await tester.runAsync(
      () => Directory.systemTemp.createTemp('report_updates_test'),
    );
    final server = serverWith(() => [json('1', 'new'), json('2', 'new')]);

    await tester.pumpWidget(
      MaterialApp(
        home: MyReportsScreen(
          previewMode: false,
          repository: server,
          pendingStore: PendingReportStore(directory: () async => directory!),
        ),
      ),
    );
    for (var i = 0; i < 30 && find.text('تحدّث').evaluate().isEmpty; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }

    expect(find.text('تحدّث'), findsOneWidget);
    expect((await tester.runAsync(() => const SeenReportStore().load(phone))), {
      '1': 'new',
      '2': 'new',
    });
    await tester.pumpWidget(const SizedBox());
    server.dispose();
    try {
      await tester.runAsync(() => directory!.delete(recursive: true));
    } on FileSystemException {
      // Windows may still hold the folder; the OS cleans temp files.
    }
  });
}
