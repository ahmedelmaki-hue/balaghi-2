import 'package:balaghi/public_reports.dart';
import 'package:balaghi/report_details_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

void main() {
  testWidgets(
    'report image stays uncropped and opens a zoomable full-screen view',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });
      final report = PublicReport(
        id: '42',
        category: ReportCategory.pothole,
        status: ReportStatus.newReport,
        location: const LatLng(32.89, 13.19),
        createdAt: DateTime(2026, 10, 15),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: ReportDetailsScreen(
            report: report,
            previewImageAsset: 'assets/demo_pothole.jpg',
            locationMapBuilder: (_) => const SizedBox(height: 160),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester.widget<Image>(find.byType(Image).first).fit,
        BoxFit.contain,
      );

      await tester.tap(find.byTooltip('عرض الصورة كاملة'));
      await tester.pumpAndSettle();
      expect(find.text('صورة البلاغ'), findsOneWidget);
      expect(find.byType(InteractiveViewer), findsOneWidget);
      expect(find.byKey(const Key('full_report_image')), findsOneWidget);

      await tester.tap(find.byTooltip('رجوع'));
      await tester.pumpAndSettle();
      expect(find.text('تفاصيل البلاغ'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'details follows the new layout and the right back button returns to map',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      final report = PublicReport(
        id: '99',
        category: ReportCategory.waterLeak,
        status: ReportStatus.resolved,
        location: LatLng(32.89, 13.19),
        createdAt: DateTime(2026, 9, 27, 14, 58),
        description: 'تسرب بالقرب من المدرسة.',
        addressText: 'شارع المدرسة',
      );
      var returnedToMap = false;
      PublicReport? renderedMapReport;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  await Navigator.of(context).push<void>(
                    MaterialPageRoute(
                      builder: (_) => ReportDetailsScreen(
                        report: report,
                        locationMapBuilder: (selectedReport) {
                          renderedMapReport = selectedReport;
                          return const ColoredBox(color: Color(0xFFF3F1EA));
                        },
                      ),
                    ),
                  );
                  returnedToMap = true;
                },
                child: const Text('فتح التفاصيل'),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('فتح التفاصيل'));
      await tester.pumpAndSettle();
      // One summary card: the type, its state, then where and when.
      expect(find.text('تسرب مياه'), findsOneWidget);
      expect(find.text('تم الحل'), findsOneWidget);
      expect(find.text('شارع المدرسة'), findsOneWidget);
      expect(find.textContaining('أُرسل '), findsOneWidget);
      expect(find.text('تسرب بالقرب من المدرسة.'), findsOneWidget);
      expect(find.text('#99'), findsOneWidget);
      expect(renderedMapReport?.location, report.location);
      expect(find.text('فتح الموقع في الخرائط'), findsOneWidget);
      expect(find.text('مشاركة تفاصيل البلاغ'), findsOneWidget);
      expect(
        tester.getTopLeft(find.text('#99')).dy,
        lessThan(tester.getTopLeft(find.text('تسرب مياه')).dy),
      );
      expect(
        tester.getTopLeft(find.text('تسرب مياه')).dy,
        lessThan(tester.getTopLeft(find.text('شارع المدرسة')).dy),
      );
      expect(tester.takeException(), isNull);
      expect(tester.getTopLeft(find.byTooltip('رجوع')).dx, greaterThan(250));
      final backIcon = tester.widget<Icon>(
        find.byIcon(Icons.chevron_right_rounded),
      );
      expect(backIcon.textDirection, TextDirection.ltr);

      tester.view.physicalSize = const Size(320, 640);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      await tester.tap(find.byTooltip('رجوع'));
      await tester.pumpAndSettle();
      expect(returnedToMap, isTrue);
      expect(find.text('فتح التفاصيل'), findsOneWidget);
    },
  );
}
