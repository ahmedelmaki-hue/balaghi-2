import 'dart:convert';

import 'package:balaghi/public_reports.dart';
import 'package:balaghi/report_ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';

void main() {
  final markerJson = {
    'id': '14',
    'category': 'pothole',
    'status': 'in_progress',
    'latitude': 32.89,
    'longitude': 13.19,
    'created_at': '2026-09-24T09:00:00Z',
  };

  test('public report uses only supported category and status', () {
    final report = PublicReport.fromJson({
      ...markerJson,
      'address_text': 'شارع عمر المختار',
      'description': 'حفرة في الطريق',
    });
    expect(report.title, 'حفرة – شارع عمر المختار');
    expect(report.status, ReportStatus.inProgress);
    expect(report.category, ReportCategory.pothole);
    expect(report.location, const LatLng(32.89, 13.19));

    expect(
      () => PublicReport.fromJson({...markerJson, 'category': 'streetlight'}),
      throwsFormatException,
    );
    expect(
      () => PublicReport.fromJson({...markerJson, 'status': 'rejected'}),
      throwsFormatException,
    );
  });

  test(
    'the three public report statuses keep their agreed labels and colors',
    () {
      expect(ReportStatus.fromApi('new').label, 'جديد');
      expect(ReportStatus.fromApi('in_progress').label, 'قيد المعالجة');
      expect(ReportStatus.fromApi('resolved').label, 'تم الحل');
      expect(statusColor(ReportStatus.newReport), const Color(0xFFC93636));
      expect(statusColor(ReportStatus.inProgress), const Color(0xFF2D8BC4));
      expect(statusColor(ReportStatus.resolved), const Color(0xFF4B9A67));
      expect(() => ReportStatus.fromApi('under_review'), throwsFormatException);
    },
  );

  test('public map requests the visible bounds and chosen category', () async {
    final requests = <Uri>[];
    final client = MockClient((request) async {
      requests.add(request.url);
      if (request.url.path == '/api/reports/public') {
        return http.Response(
          jsonEncode({
            'items': [markerJson],
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }
      return http.Response(
        jsonEncode({
          ...markerJson,
          'image_url': 'https://example.org/report.jpg',
          'address_text': 'شارع عمر المختار',
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final repository = PublicReportsRepository(
      baseUrl: 'https://example.org/api/',
      client: client,
    );
    final bounds = LatLngBounds(
      const LatLng(32.8, 13.1),
      const LatLng(32.9, 13.2),
    );

    final reports = await repository.fetchMarkers(
      bounds,
      category: ReportCategory.pothole,
    );
    final detail = await repository.fetchDetail(reports.single.id);

    expect(requests.first.path, '/api/reports/public');
    expect(requests.first.queryParameters['bbox'], '13.1,32.8,13.2,32.9');
    expect(requests.first.queryParameters['category'], 'pothole');
    expect(detail.imageUrl, 'https://example.org/report.jpg');
    expect(detail.title, 'حفرة – شارع عمر المختار');
    repository.dispose();
    client.close();
  });

  test(
    'public detail resolves an API image path to the configured backend',
    () async {
      final client = MockClient(
        (_) async => http.Response(
          jsonEncode({
            ...markerJson,
            'image_url': '/api/images?target=photo-token',
          }),
          200,
        ),
      );
      final repository = PublicReportsRepository(
        baseUrl: 'http://10.0.2.2:5000/api',
        client: client,
      );
      final report = await repository.fetchDetail('14');
      expect(
        report.imageUrl,
        'http://10.0.2.2:5000/api/images?target=photo-token',
      );
      repository.dispose();
      client.close();
    },
  );
}
