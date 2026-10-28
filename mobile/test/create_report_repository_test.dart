import 'dart:convert';
import 'dart:typed_data';

import 'package:balaghi/citizen_auth.dart';
import 'package:balaghi/create_report_repository.dart';
import 'package:balaghi/public_reports.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';

void main() {
  final session = CitizenSession(
    accessToken: 'test-token',
    refreshToken: 'refresh-token',
    phone: '+218912345678',
    expiresAt: DateTime.now().add(const Duration(hours: 1)),
  );
  final image = Uint8List.fromList([0xff, 0xd8, 0xff, 0xd9]);

  test(
    'submits the photo, coordinates and category with citizen auth',
    () async {
      String? method;
      String? url;
      String? authorization;
      String? contentType;
      String? body;
      final client = MockClient((request) async {
        method = request.method;
        url = request.url.toString();
        authorization = request.headers['authorization'];
        contentType = request.headers['content-type'];
        body = latin1.decode(request.bodyBytes);
        return http.Response('''{
        "id":"42", "category":"pothole", "status":"new",
        "latitude":32.89, "longitude":13.19,
        "created_at":"2026-09-30T12:00:00Z",
        "image_url":"/api/images?target=photo-token"
      }''', 201);
      });
      final repository = CreateReportRepository(
        baseUrl: 'https://example.test/api',
        client: client,
      );

      final report = await repository.submit(
        session: session,
        category: ReportCategory.pothole,
        location: const LatLng(32.89, 13.19),
        imageBytes: image,
        imageMimeType: 'image/jpeg',
        clientRequestId: '11111111-1111-4111-8111-111111111111',
      );

      expect(report.id, '42');
      expect(report.category, ReportCategory.pothole);
      expect(
        report.imageUrl,
        'https://example.test/api/images?target=photo-token',
      );
      expect(method, 'POST');
      expect(url, 'https://example.test/api/reports');
      expect(authorization, 'Bearer test-token');
      expect(contentType, contains('multipart/form-data'));
      expect(body, contains('name="category"'));
      expect(body, contains('pothole'));
      expect(body, contains('name="latitude"'));
      expect(body, contains('32.89'));
      expect(body, contains('name="longitude"'));
      expect(body, contains('13.19'));
      expect(body, contains('name="client_request_id"'));
      expect(body, contains('11111111-1111-4111-8111-111111111111'));
      expect(body, contains('content-type: image/jpeg'));
      repository.dispose();
    },
  );

  test('keeps a failed upload available for retry', () async {
    final client = MockClient((_) async => http.Response('unavailable', 503));
    final repository = CreateReportRepository(
      baseUrl: 'https://example.test/api',
      client: client,
    );

    await expectLater(
      repository.submit(
        session: session,
        category: ReportCategory.garbage,
        location: const LatLng(32.89, 13.19),
        imageBytes: image,
        imageMimeType: 'image/jpeg',
        clientRequestId: '11111111-1111-4111-8111-111111111111',
      ),
      throwsA(isA<CreateReportFailure>()),
    );
    repository.dispose();
  });
}
