import 'dart:convert';

import 'package:balaghi/marker_clusters.dart';
import 'package:balaghi/public_reports.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:latlong2/latlong.dart';

PublicReport report(String id, double latitude, double longitude) =>
    PublicReport(
      id: id,
      category: ReportCategory.pothole,
      status: ReportStatus.newReport,
      location: LatLng(latitude, longitude),
      createdAt: DateTime.utc(2026, 11, 2),
    );

void main() {
  // Two reports on the same street (about 20 m apart) and one across town.
  final street = [
    report('1', 32.88800, 13.19000),
    report('2', 32.88815, 13.19010),
    report('3', 32.87500, 13.21500),
  ];

  test(
    'nearby reports share a marker at city zoom, with every report kept',
    () {
      final clusters = clusterReports(street, 13);
      expect(clusters, hasLength(2));
      final group = clusters.firstWhere((cluster) => !cluster.isSingle);
      expect(group.reports.map((r) => r.id), unorderedEquals(['1', '2']));
      expect(group.center.latitude, closeTo(32.888075, 1e-6));
      expect(
        clusters.expand((cluster) => cluster.reports).map((r) => r.id),
        unorderedEquals(['1', '2', '3']),
      );
    },
  );

  test('close zoom draws every report on its own', () {
    expect(
      clusterReports(street, clusterUntilZoom).every((c) => c.isSingle),
      isTrue,
    );
  });

  test('the selected report is never hidden inside a group', () {
    final clusters = clusterReports(street, 13, keepApart: {'2'});
    expect(clusters.where((cluster) => cluster.isSingle), hasLength(3));
  });

  test('the map follows next_cursor across batches', () async {
    final cursors = <String?>[];
    final client = MockClient((request) async {
      final cursor = request.url.queryParameters['cursor'];
      cursors.add(cursor);
      final page = cursor == null ? 0 : int.parse(cursor);
      return http.Response(
        jsonEncode({
          'items': [
            {
              'id': '${page + 1}',
              'category': 'pothole',
              'status': 'new',
              'latitude': 32.88,
              'longitude': 13.19,
              'created_at': '2026-11-02T10:00:00Z',
            },
          ],
          'next_cursor': page < 5 ? '${page + 1}' : null,
        }),
        200,
      );
    });
    final repository = PublicReportsRepository(
      baseUrl: 'https://example.test/api',
      client: client,
    );
    final bounds = LatLngBounds(
      const LatLng(32.85, 13.15),
      const LatLng(32.91, 13.24),
    );

    final reports = await repository.fetchMarkers(bounds);
    expect(reports.map((r) => r.id), ['1', '2', '3', '4']);
    expect(cursors, [null, '1', '2', '3'], reason: 'stops after four batches');

    cursors.clear();
    expect(await repository.fetchMarkers(bounds, maxBatches: 10), hasLength(6));
    expect(cursors.last, '5', reason: 'stops when there is no next cursor');
    repository.dispose();
  });
}
