import 'dart:convert';

import 'package:balaghi/citizen_auth.dart';
import 'package:balaghi/my_reports_repository.dart';
import 'package:balaghi/my_reports_screen.dart';
import 'package:balaghi/public_reports.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';

void main() {
  test('owner report distinguishes pending review from public status', () {
    final pending = MyReport.fromJson({
      'id': '19',
      'category': 'pothole',
      'status': 'new',
      'latitude': 32.89,
      'longitude': 13.19,
      'created_at': '2026-10-14T10:00:00Z',
      'approved_at': null,
    });
    expect(pending.isPendingReview, isTrue);
    expect(pending.status, ReportStatus.newReport);

    final approved = MyReport.fromJson({
      'id': '19',
      'category': 'pothole',
      'status': 'new',
      'latitude': 32.89,
      'longitude': 13.19,
      'created_at': '2026-10-14T10:00:00Z',
      'approved_at': '2026-10-14T11:00:00Z',
    });
    expect(approved.isPendingReview, isFalse);
  });

  test(
    'My Reports sends owner token and status filter, parses rejected outcome',
    () async {
      final requests = <http.Request>[];
      final client = MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode({
            'items': [
              {
                'id': '18',
                'category': 'pothole',
                'status': 'rejected',
                'latitude': 32.89,
                'longitude': 13.19,
                'created_at': '2026-10-04T10:00:00Z',
                'rejection_reason': 'بلاغ مكرر',
                'image_url': '/api/images?target=photo-token',
              },
            ],
            'page': 2,
            'total_pages': 3,
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      final repository = MyReportsRepository(
        baseUrl: 'https://example.test/api',
        client: client,
      );
      final session = CitizenSession(
        accessToken: 'citizen-access',
        refreshToken: 'refresh',
        phone: '+218912345678',
        expiresAt: DateTime.now().add(const Duration(hours: 1)),
      );
      final page = await repository.fetch(
        session: session,
        status: ReportStatus.inProgress,
        page: 2,
      );
      expect(requests.single.headers['authorization'], 'Bearer citizen-access');
      expect(requests.single.url.queryParameters, {
        'page': '2',
        'limit': '25',
        'status': 'in_progress',
      });
      expect(page.totalPages, 3);
      expect(page.items.single.isRejected, isTrue);
      expect(page.items.single.rejectionReason, 'بلاغ مكرر');
      expect(
        page.items.single.imageUrl,
        'https://example.test/api/images?target=photo-token',
      );
      repository.dispose();
      client.close();
    },
  );

  testWidgets('preview filters the three statuses and shows empty result', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    final report = MyReport(
      id: '1',
      category: ReportCategory.pothole,
      status: ReportStatus.newReport,
      location: const LatLng(32.89, 13.19),
      createdAt: DateTime(2026, 10, 4),
      addressText: 'وسط المدينة',
    );
    await tester.pumpWidget(
      MaterialApp(
        home: MyReportsScreen(previewMode: true, previewReports: [report]),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('بلاغاتي'), findsOneWidget);
    // The preview shows its sample reports without a note about them.
    expect(find.textContaining('بلاغات تجريبية'), findsNothing);
    expect(find.text('حفرة'), findsOneWidget);
    await tester.tap(find.text('قيد المعالجة'));
    await tester.pumpAndSettle();
    expect(find.text('لا توجد بلاغات بهذه الحالة'), findsOneWidget);
    expect(find.text('حفرة'), findsNothing);
    await tester.tap(find.text('الكل'));
    await tester.pumpAndSettle();
    expect(find.text('حفرة'), findsOneWidget);
    await tester.tap(find.byTooltip('عرض الصورة كاملة'));
    await tester.pumpAndSettle();
    expect(find.text('صورة البلاغ'), findsOneWidget);
    await tester.tap(find.byTooltip('رجوع'));
    await tester.pumpAndSettle();
    expect(find.text('بلاغاتي'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
