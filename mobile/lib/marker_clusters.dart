import 'dart:math';

import 'package:latlong2/latlong.dart';

import 'public_reports.dart';

/// Reports that sit close together on screen at the current zoom, drawn as one
/// numbered marker so a busy street stays readable. Grouping changes only what
/// is drawn; every report is still on the map.
class MarkerCluster {
  const MarkerCluster(this.reports, this.center);

  final List<PublicReport> reports;
  final LatLng center;

  bool get isSingle => reports.length == 1;
}

/// From this zoom on, every report is drawn on its own.
const clusterUntilZoom = 17.0;

/// Groups [reports] into square cells of [cellPixels] in Web Mercator pixels at
/// [zoom], the same projection the map draws with, so the grouping matches
/// what is on screen. Reports in [keepApart] (the selected one) stay single.
List<MarkerCluster> clusterReports(
  List<PublicReport> reports,
  double zoom, {
  double cellPixels = 56,
  Set<String> keepApart = const {},
}) {
  if (zoom >= clusterUntilZoom) {
    return [
      for (final report in reports) MarkerCluster([report], report.location),
    ];
  }
  final scale = 256 * pow(2, zoom);
  final cells = <String, List<PublicReport>>{};
  final singles = <MarkerCluster>[];
  for (final report in reports) {
    if (keepApart.contains(report.id)) {
      singles.add(MarkerCluster([report], report.location));
      continue;
    }
    final point = _project(report.location, scale);
    final key =
        '${(point.x / cellPixels).floor()}:${(point.y / cellPixels).floor()}';
    cells.putIfAbsent(key, () => []).add(report);
  }
  return [
    for (final group in cells.values)
      MarkerCluster(
        group,
        group.length == 1
            ? group.single.location
            : LatLng(
                group.map((r) => r.location.latitude).reduce((a, b) => a + b) /
                    group.length,
                group.map((r) => r.location.longitude).reduce((a, b) => a + b) /
                    group.length,
              ),
      ),
    ...singles,
  ];
}

Point<double> _project(LatLng location, num scale) {
  final latitude = location.latitude.clamp(-85.05112878, 85.05112878);
  final radians = latitude * pi / 180;
  final x = (location.longitude + 180) / 360 * scale;
  final y = (1 - log(tan(radians) + 1 / cos(radians)) / pi) / 2 * scale;
  return Point(x, y.toDouble());
}
