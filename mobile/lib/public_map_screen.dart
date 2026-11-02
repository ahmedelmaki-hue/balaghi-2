import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_maplibre/flutter_map_maplibre.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import 'app_config.dart';
import 'account_screen.dart';
import 'citizen_auth.dart';
import 'citizen_auth_preview_store.dart';
import 'citizen_auth_screen.dart';
import 'create_report_repository.dart';
import 'create_report_screen.dart';
import 'marker_clusters.dart';
import 'my_reports_screen.dart';
import 'pending_reports.dart';
import 'public_reports.dart';
import 'report_details_screen.dart';
import 'report_ui.dart';

const _tripoli = LatLng(32.8912, 13.1905);
// Demo markers only when requested with --dart-define=BALAGHI_DEMO_MAP=true;
// otherwise the map always shows real reports from the API.
const _demoMap = bool.fromEnvironment('BALAGHI_DEMO_MAP', defaultValue: false);
const _homeTeal = Color(0xFF12323F);
const _homeGold = Color(0xFFE5A93C);
const _homeBorder = Color(0xFFE8E4DA);

class PublicMapScreen extends StatefulWidget {
  const PublicMapScreen({super.key});

  @override
  State<PublicMapScreen> createState() => _PublicMapScreenState();
}

class _PublicMapScreenState extends State<PublicMapScreen> {
  final _mapController = MapController();
  final _repository = PublicReportsRepository(baseUrl: apiBaseUrl);
  final _authApi = CitizenAuthApi(baseUrl: apiBaseUrl);
  final _authStore = const CitizenAuthStore();
  final _previewStore = const CitizenAuthPreviewStore();
  final _pendingStore = PendingReportStore();
  final _reportSender = CreateReportRepository(baseUrl: apiBaseUrl);
  final _demoReports = demoPublicReports();
  AppLifecycleListener? _lifecycle;
  Timer? _refreshTimer;
  bool _mapReady = false;
  bool _userMovedMap = false;
  // Zoom in half steps: clusters are rebuilt only when this changes.
  double _clusterZoom = 13.5;
  bool _loading = false;
  int _requestSerial = 0;
  int _selectionSerial = 0;
  int _locationSerial = 0;
  ReportCategory? _category;
  List<PublicReport> _markers = const [];
  PublicReport? _selectedReport;
  LatLng? _userLocation;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    if (_demoMap) {
      _markers = _demoReports;
      _selectedReport = _demoReports.first;
    }
    if (!authPreviewMode) {
      _sendSavedReports();
      _lifecycle = AppLifecycleListener(onResume: _sendSavedReports);
    }
  }

  @override
  void dispose() {
    _lifecycle?.dispose();
    _refreshTimer?.cancel();
    _reportSender.dispose();
    _repository.dispose();
    _authApi.dispose();
    _mapController.dispose();
    super.dispose();
  }

  List<PublicReport> get _visibleReports => _demoMap
      ? (_category == null
            ? _demoReports
            : _demoReports
                  .where((report) => report.category == _category)
                  .toList())
      : _markers;

  Future<void> _refresh() async {
    if (!_mapReady || !mounted) return;
    _refreshTimer?.cancel();
    if (_demoMap) {
      setState(() => _loadError = null);
      return;
    }
    final serial = ++_requestSerial;
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final reports = await _repository.fetchMarkers(
        _mapController.camera.visibleBounds,
        category: _category,
      );
      if (!mounted || serial != _requestSerial) return;
      setState(() {
        _markers = reports;
        _loading = false;
        if (_selectedReport != null &&
            !reports.any((report) => report.id == _selectedReport!.id)) {
          _selectedReport = null;
        }
      });
    } catch (_) {
      if (!mounted || serial != _requestSerial) return;
      setState(() {
        _loading = false;
        _loadError = 'تعذر تحميل البلاغات. تحقق من اتصال الخادم.';
      });
    }
  }

  void _selectCategory(ReportCategory? category) {
    if (_category == category) return;
    setState(() {
      _category = category;
      if (_selectedReport != null &&
          category != null &&
          _selectedReport!.category != category) {
        _selectionSerial++;
        _selectedReport = null;
      }
    });
    _refresh();
  }

  Future<void> _selectReport(PublicReport marker) async {
    final serial = ++_selectionSerial;
    setState(() => _selectedReport = marker);
    if (_demoMap) return;
    try {
      final detail = await _repository.fetchDetail(marker.id);
      if (mounted && serial == _selectionSerial) {
        setState(() => _selectedReport = detail);
      }
    } catch (_) {
      if (mounted && serial == _selectionSerial) {
        _showMessage('تعذر جلب صورة البلاغ ووصفه.');
      }
    }
  }

  void _clearSelection() {
    _selectionSerial++;
    setState(() => _selectedReport = null);
  }

  Future<void> _locate({bool initial = false}) async {
    final serial = ++_locationSerial;
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        if (!initial) {
          _showMessage('فعّل خدمة الموقع على الجهاز ثم حاول مجددًا.');
        }
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        if (!initial) {
          _showMessage('يلزم السماح بالموقع لعرض موقعك على الخريطة.');
        }
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 15),
        ),
      );
      if (!mounted || serial != _locationSerial) return;
      final location = LatLng(position.latitude, position.longitude);
      final shouldRecenter = !initial || !_userMovedMap;
      if (shouldRecenter) _selectionSerial++;
      setState(() {
        _userLocation = location;
        if (shouldRecenter) _selectedReport = null;
      });
      if (!shouldRecenter) return;
      _mapController.move(location, 15);
      _refresh();
    } catch (_) {
      if (!initial && mounted && serial == _locationSerial) {
        _showMessage('تعذر تحديد موقعك الآن.');
      }
    }
  }

  Future<void> _openDirections(PublicReport report) async {
    final destination =
        '${report.location.latitude},${report.location.longitude}';
    final uri = Uri.https('www.google.com', '/maps/dir/', {
      'api': '1',
      'destination': destination,
    });
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        _showMessage('تعذر فتح تطبيق الخرائط.');
      }
    } catch (_) {
      if (mounted) _showMessage('تعذر فتح تطبيق الخرائط.');
    }
  }

  Future<void> _openReportDetails(PublicReport report) async {
    var fullReport = report;
    if (!_demoMap && report.imageUrl == null) {
      try {
        fullReport = await _repository.fetchDetail(report.id);
      } catch (_) {
        if (mounted) _showMessage('تعذر تحميل تفاصيل البلاغ. حاول مجددًا.');
        return;
      }
    }
    if (!mounted) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => ReportDetailsScreen(
          report: fullReport,
          previewImageAsset: _demoMap
              ? _demoImageFor(fullReport.category)
              : null,
        ),
      ),
    );
  }

  /// Sends reports saved while offline when the app opens or comes back to
  /// the foreground. Checks the device first so it costs nothing when empty.
  Future<void> _sendSavedReports() async {
    try {
      final saved = await _authStore.load();
      if (saved == null || saved.needsProfile) return;
      if ((await _pendingStore.load(saved.phone)).isEmpty) return;
      final session = await _authApi.restore(_authStore);
      if (session == null || session.needsProfile) return;
      final result = await sendPendingReports(
        session: session,
        store: _pendingStore,
        repository: _reportSender,
      );
      if (result.sent > 0) {
        _showMessage(
          result.sent == 1
              ? 'أُرسل البلاغ المحفوظ على جهازك، وهو الآن بانتظار المراجعة.'
              : 'أُرسلت البلاغات المحفوظة على جهازك، وهي الآن بانتظار المراجعة.',
        );
      }
    } catch (_) {
      // Saved reports stay on the device and are retried later.
    }
  }

  void _showMessage(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), behavior: SnackBarBehavior.floating),
    );
  }

  Future<void> _openAccount() async {
    if (authPreviewMode) {
      if (!await _previewStore.isCompleted()) {
        if (!mounted) return;
        final result = await Navigator.of(context).push<CitizenAuthResult>(
          MaterialPageRoute(builder: (_) => const CitizenAuthScreen()),
        );
        if (!mounted || result == null) return;
      }
    } else {
      final session = await _authApi.restore(_authStore);
      if (!mounted) return;
      if (session == null || session.needsProfile) {
        final result = await Navigator.of(context).push<CitizenAuthResult>(
          MaterialPageRoute(builder: (_) => const CitizenAuthScreen()),
        );
        if (!mounted || result == null) return;
      }
    }
    if (!mounted) return;
    final signedOut = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => AccountScreen(previewMode: authPreviewMode),
      ),
    );
    if (signedOut == true && mounted) _showMessage('تم تسجيل الخروج.');
  }

  Future<void> _openCreateReport() async {
    if (authPreviewMode) {
      if (!await _previewStore.isCompleted()) {
        if (!mounted) return;
        final result = await Navigator.of(context).push<CitizenAuthResult>(
          MaterialPageRoute(builder: (_) => const CitizenAuthScreen()),
        );
        if (!mounted || result == null) return;
      }
    } else {
      final session = await _authApi.restore(_authStore);
      if (!mounted) return;
      if (session == null || session.needsProfile) {
        final result = await Navigator.of(context).push<CitizenAuthResult>(
          MaterialPageRoute(builder: (_) => const CitizenAuthScreen()),
        );
        if (!mounted || result == null) return;
      }
    }
    if (!mounted) return;
    final submitted = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => CreateReportScreen(previewMode: authPreviewMode),
      ),
    );
    if (submitted == true && mounted) _refresh();
  }

  Future<void> _openMyReports() async {
    if (authPreviewMode) {
      if (!await _previewStore.isCompleted()) {
        if (!mounted) return;
        final result = await Navigator.of(context).push<CitizenAuthResult>(
          MaterialPageRoute(builder: (_) => const CitizenAuthScreen()),
        );
        if (!mounted || result == null) return;
      }
    } else {
      final session = await _authApi.restore(_authStore);
      if (!mounted) return;
      if (session == null || session.needsProfile) {
        final result = await Navigator.of(context).push<CitizenAuthResult>(
          MaterialPageRoute(builder: (_) => const CitizenAuthScreen()),
        );
        if (!mounted || result == null) return;
      }
    }
    if (!mounted) return;
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => MyReportsScreen(previewMode: authPreviewMode),
      ),
    );
  }

  void _zoomInto(MarkerCluster cluster) {
    if (!_mapReady) return;
    _userMovedMap = true;
    final zoom = (_mapController.camera.zoom + 2).clamp(5, 18).toDouble();
    _mapController.move(cluster.center, zoom);
    _refresh();
  }

  void _zoom(double delta) {
    if (!_mapReady) return;
    _userMovedMap = true;
    final camera = _mapController.camera;
    _mapController.move(camera.center, (camera.zoom + delta).clamp(5, 18));
    _refresh();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFFCF9F2),
    body: SafeArea(
      bottom: false,
      child: Stack(
        children: [
          Positioned.fill(child: _map()),
          Positioned(top: 0, right: 0, left: 0, child: _floatingHeader()),
        ],
      ),
    ),
    bottomNavigationBar: _navigationBar(),
  );

  Widget _floatingHeader() => Container(
    padding: const EdgeInsets.only(top: 6, bottom: 13),
    decoration: const BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0xFFFEF3C7), Color(0xF5FFFBEB), Color(0x00FFFBEB)],
        stops: [0, 0.66, 1],
      ),
    ),
    child: Column(children: [_header(), _filters()]),
  );

  Widget _header() => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 16),
    child: SizedBox(
      height: 53,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.84),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: _homeBorder),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: _demoMap
                            ? _homeGold
                            : _loadError != null
                            ? const Color(0xFFD15A4A)
                            : const Color(0xFF45A76F),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 5),
                    Text(
                      _demoMap
                          ? 'بيانات تجريبية'
                          : _loadError != null
                          ? 'تعذر التحديث'
                          : _loading
                          ? 'جارٍ التحديث'
                          : 'بيانات حية',
                      style: const TextStyle(
                        color: _homeTeal,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              _headerAction(
                icon: Icons.refresh_rounded,
                tooltip: 'تحديث الخريطة',
                onTap: _refresh,
              ),
              const SizedBox(width: 7),
              _headerAction(
                icon: Icons.person_outline_rounded,
                tooltip: 'حسابي',
                onTap: _openAccount,
              ),
            ],
          ),
          Center(
            child: IgnorePointer(
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  const Text(
                    'بلاغي',
                    style: TextStyle(
                      color: _homeTeal,
                      fontSize: 23,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  PositionedDirectional(
                    end: -13,
                    top: 10,
                    child: Container(
                      width: 9,
                      height: 9,
                      decoration: const BoxDecoration(
                        color: _homeGold,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(color: Color(0x99E5A93C), blurRadius: 8),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _headerAction({
    required IconData icon,
    required String tooltip,
    required VoidCallback onTap,
  }) => Material(
    color: Colors.white.withValues(alpha: 0.92),
    shape: const CircleBorder(side: BorderSide(color: _homeBorder)),
    clipBehavior: Clip.antiAlias,
    child: IconButton(
      tooltip: tooltip,
      onPressed: onTap,
      icon: Icon(icon, color: _homeTeal, size: 21),
      style: IconButton.styleFrom(
        shape: const CircleBorder(),
        fixedSize: const Size(40, 40),
        padding: EdgeInsets.zero,
      ),
    ),
  );

  Widget _filters() => SizedBox(
    height: 50,
    child: ListView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 5),
      children: [
        _filterChip(null, 'الكل', Icons.layers_outlined),
        _filterChip(
          ReportCategory.pothole,
          'الحفر',
          Icons.construction_rounded,
        ),
        _filterChip(
          ReportCategory.waterLeak,
          'تسرب مياه',
          Icons.water_drop_outlined,
        ),
        _filterChip(
          ReportCategory.garbage,
          'القمامة',
          Icons.delete_outline_rounded,
        ),
      ],
    ),
  );

  Widget _filterChip(ReportCategory? category, String label, IconData icon) {
    final selected = _category == category;
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 8),
      child: Material(
        color: selected ? _homeTeal : Colors.white.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(24),
        elevation: selected ? 3 : 1,
        child: InkWell(
          onTap: () => _selectCategory(category),
          borderRadius: BorderRadius.circular(24),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(24),
              border: selected ? null : Border.all(color: _homeBorder),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  icon,
                  size: 16,
                  color: selected ? Colors.white : _homeTeal,
                ),
                const SizedBox(width: 6),
                BalaghiButtonLabel(
                  label,
                  style: TextStyle(
                    color: selected ? Colors.white : _homeTeal,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _map() => Stack(
    children: [
      FlutterMap(
        mapController: _mapController,
        options: MapOptions(
          initialCenter: _tripoli,
          initialZoom: 13.4,
          minZoom: 5,
          maxZoom: 18,
          cameraConstraint: CameraConstraint.contain(
            bounds: LatLngBounds(
              const LatLng(-85, -180),
              const LatLng(85, 180),
            ),
          ),
          backgroundColor: const Color(0xFFF3F1EA),
          onMapReady: () {
            _mapReady = true;
            _refresh();
            unawaited(_locate(initial: true));
          },
          onTap: (_, _) => _clearSelection(),
          onPositionChanged: (camera, hasGesture) {
            final zoom = (camera.zoom * 2).round() / 2;
            if (zoom != _clusterZoom) setState(() => _clusterZoom = zoom);
            if (!hasGesture) return;
            _userMovedMap = true;
            if (_demoMap) return;
            _refreshTimer?.cancel();
            _refreshTimer = Timer(const Duration(milliseconds: 550), _refresh);
          },
        ),
        children: [
          const MapLibreLayer(
            initStyle: 'https://tiles.openfreemap.org/styles/bright',
          ),
          MarkerLayer(
            markers: [
              for (final cluster in clusterReports(
                _visibleReports,
                _clusterZoom,
                keepApart: {?_selectedReport?.id},
              ))
                if (cluster.isSingle)
                  Marker(
                    point: cluster.center,
                    width: _selectedReport?.id == cluster.reports.single.id
                        ? 88
                        : 68,
                    height: _selectedReport?.id == cluster.reports.single.id
                        ? 104
                        : 80,
                    alignment: Alignment.bottomCenter,
                    child: _ReportPin(
                      key: ValueKey(cluster.reports.single.id),
                      report: cluster.reports.single,
                      selected:
                          _selectedReport?.id == cluster.reports.single.id,
                      onTap: () => _selectReport(cluster.reports.single),
                    ),
                  )
                else
                  Marker(
                    point: cluster.center,
                    width: 56,
                    height: 56,
                    child: _ClusterPin(
                      count: cluster.reports.length,
                      onTap: () => _zoomInto(cluster),
                    ),
                  ),
              if (_userLocation != null)
                Marker(
                  point: _userLocation!,
                  width: 28,
                  height: 28,
                  child: Container(
                    decoration: BoxDecoration(
                      color: civicTeal,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 4),
                      boxShadow: const [
                        BoxShadow(color: Colors.black26, blurRadius: 7),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
      Positioned(
        top: 142,
        left: 14,
        child: Column(
          children: [
            Material(
              color: Colors.white.withValues(alpha: 0.96),
              elevation: 2,
              borderRadius: BorderRadius.circular(14),
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: _homeBorder),
                ),
                child: Column(
                  children: [
                    _zoomControl(
                      icon: Icons.add_rounded,
                      tooltip: 'تكبير',
                      onTap: () => _zoom(1),
                    ),
                    const SizedBox(
                      width: 40,
                      child: Divider(height: 1, color: _homeBorder),
                    ),
                    _zoomControl(
                      icon: Icons.remove_rounded,
                      tooltip: 'تصغير',
                      onTap: () => _zoom(-1),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),
            _MapControl(
              icon: Icons.my_location_rounded,
              tooltip: 'تحديد موقعي',
              onTap: () => _locate(),
            ),
          ],
        ),
      ),
      Positioned(
        top: 137,
        right: 10,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.78),
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: 7, vertical: 4),
            child: Text(
              '© OpenMapTiles · OpenStreetMap',
              textDirection: TextDirection.ltr,
              style: TextStyle(fontSize: 9, color: _homeTeal),
            ),
          ),
        ),
      ),
      if (_loading)
        const Positioned(
          left: 0,
          right: 0,
          top: 127,
          child: LinearProgressIndicator(color: _homeGold, minHeight: 3),
        ),
      if (_loadError != null)
        Positioned(
          top: 188,
          right: 12,
          left: 75,
          child: Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14),
            elevation: 3,
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      _loadError!,
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
                  TextButton(
                    onPressed: _refresh,
                    child: const BalaghiButtonLabel('إعادة المحاولة'),
                  ),
                ],
              ),
            ),
          ),
        ),
      if (!_loading && _loadError == null && _visibleReports.isEmpty)
        const Center(
          child: Card(
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: 18, vertical: 12),
              child: Text('لا توجد بلاغات في هذا النطاق.'),
            ),
          ),
        ),
      if (_selectedReport != null)
        Positioned(
          left: 12,
          right: 12,
          bottom: 12,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 520),
              child: _preview(_selectedReport!),
            ),
          ),
        ),
    ],
  );

  Widget _zoomControl({
    required IconData icon,
    required String tooltip,
    required VoidCallback onTap,
  }) => IconButton(
    tooltip: tooltip,
    onPressed: onTap,
    icon: Icon(icon, color: _homeTeal, size: 21),
    constraints: const BoxConstraints.tightFor(width: 40, height: 40),
    padding: EdgeInsets.zero,
  );

  Widget _preview(PublicReport report) => Material(
    color: Colors.white.withValues(alpha: 0.96),
    elevation: 12,
    shadowColor: _homeTeal.withValues(alpha: 0.20),
    borderRadius: BorderRadius.circular(28),
    child: Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: _homeBorder),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 15),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFE2E8EC),
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
            const SizedBox(height: 11),
            Row(
              children: [
                ReportStatusPill(status: report.status),
                const Spacer(),
                IconButton(
                  tooltip: 'إغلاق المعاينة',
                  onPressed: _clearSelection,
                  style: IconButton.styleFrom(
                    backgroundColor: const Color(0xFFF1F3F4),
                    fixedSize: const Size(29, 29),
                    minimumSize: const Size(29, 29),
                    padding: EdgeInsets.zero,
                  ),
                  icon: const Icon(
                    Icons.close_rounded,
                    color: _homeTeal,
                    size: 17,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _reportThumbnail(report),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        report.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: _homeTeal,
                          fontWeight: FontWeight.w800,
                          fontSize: 16,
                        ),
                      ),
                      if (report.description?.isNotEmpty == true) ...[
                        const SizedBox(height: 3),
                        Text(
                          report.description!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color(0xFF64767D),
                            fontSize: 12,
                          ),
                        ),
                      ],
                      const SizedBox(height: 5),
                      Row(
                        children: [
                          const Icon(
                            Icons.schedule_rounded,
                            size: 14,
                            color: Color(0xFF8A999E),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            reportDate(report.createdAt),
                            style: const TextStyle(
                              color: Color(0xFF8A999E),
                              fontSize: 10,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            const Divider(height: 1, color: _homeBorder),
            const SizedBox(height: 11),
            Row(
              children: [
                SizedBox(
                  width: 48,
                  height: 48,
                  child: IconButton(
                    tooltip: 'الاتجاهات إلى البلاغ',
                    onPressed: () => _openDirections(report),
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.white,
                      side: const BorderSide(color: _homeBorder),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                    icon: const Icon(
                      Icons.near_me_outlined,
                      color: _homeTeal,
                      size: 22,
                    ),
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Container(
                    height: 48,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [
                          Color(0xFFFBBF24),
                          _homeGold,
                          Color(0xFFF59E0B),
                        ],
                      ),
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x55E5A93C),
                          blurRadius: 18,
                          offset: Offset(0, 6),
                        ),
                      ],
                    ),
                    child: Material(
                      color: Colors.transparent,
                      child: InkWell(
                        onTap: () => _openReportDetails(report),
                        borderRadius: BorderRadius.circular(16),
                        child: const Center(
                          child: BalaghiButtonLabel(
                            'عرض تفاصيل البلاغ',
                            style: TextStyle(
                              color: _homeTeal,
                              fontSize: 14,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );

  Widget _reportThumbnail(PublicReport report) {
    final imageUrl = report.imageUrl;
    final fallback = Container(
      color: const Color(0xFFE6EFF2),
      child: Icon(categoryIcon(report.category), color: _homeTeal, size: 26),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(14),
      child: SizedBox(
        width: 56,
        height: 56,
        child: imageUrl != null
            ? Image.network(
                imageUrl,
                fit: BoxFit.cover,
                cacheWidth: 168,
                loadingBuilder: (context, child, progress) =>
                    progress == null ? child : fallback,
                errorBuilder: (context, error, stackTrace) => fallback,
              )
            : _demoMap
            ? Image.asset(
                _demoImageFor(report.category),
                fit: BoxFit.cover,
                cacheWidth: 168,
                errorBuilder: (context, error, stackTrace) => fallback,
              )
            : fallback,
      ),
    );
  }

  String _demoImageFor(ReportCategory category) => switch (category) {
    ReportCategory.pothole => 'assets/demo_pothole.jpg',
    ReportCategory.waterLeak => 'assets/demo_water_leak.jpg',
    ReportCategory.garbage => 'assets/demo_garbage.jpg',
  };

  Widget _navigationBar() => Container(
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.94),
      border: const Border(top: BorderSide(color: _homeBorder)),
      boxShadow: const [
        BoxShadow(
          color: Color(0x1E12323F),
          blurRadius: 22,
          offset: Offset(0, -7),
        ),
      ],
    ),
    child: SafeArea(
      top: false,
      child: SizedBox(
        height: 76,
        child: Row(
          children: [
            Expanded(
              child: _NavItem(
                icon: Icons.home_rounded,
                label: 'الرئيسية',
                selected: true,
                onTap: () {
                  if (!_mapReady) return;
                  _userMovedMap = true;
                  _clearSelection();
                  _mapController.move(_userLocation ?? _tripoli, 13.4);
                  _refresh();
                },
              ),
            ),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 58,
                    height: 58,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(
                        colors: [Color(0xFFFBBF24), _homeGold],
                      ),
                      border: Border.fromBorderSide(
                        BorderSide(color: Colors.white, width: 3),
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Color(0x66E5A93C),
                          blurRadius: 22,
                          offset: Offset(0, 8),
                        ),
                      ],
                    ),
                    child: Material(
                      color: Colors.transparent,
                      shape: const CircleBorder(),
                      child: InkWell(
                        onTap: _openCreateReport,
                        customBorder: const CircleBorder(),
                        child: const Icon(
                          Icons.add_rounded,
                          color: _homeTeal,
                          size: 31,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 1),
                  const BalaghiButtonLabel(
                    'إبلاغ',
                    style: TextStyle(
                      color: _homeTeal,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: _NavItem(
                icon: Icons.assignment_outlined,
                label: 'بلاغاتي',
                onTap: _openMyReports,
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

class _ClusterPin extends StatelessWidget {
  const _ClusterPin({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: '$count بلاغات متقاربة، اضغط للتكبير',
    child: InkWell(
      onTap: onTap,
      customBorder: const CircleBorder(),
      child: Center(
        child: Container(
          width: count >= 100 ? 52 : 44,
          height: count >= 100 ? 52 : 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: _homeTeal,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 3),
            boxShadow: const [
              BoxShadow(color: Color(0x33000000), blurRadius: 8),
            ],
          ),
          child: Text(
            '$count',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 15,
              fontWeight: FontWeight.w800,
            ),
          ),
        ),
      ),
    ),
  );
}

class _ReportPin extends StatefulWidget {
  const _ReportPin({
    super.key,
    required this.report,
    required this.selected,
    required this.onTap,
  });

  final PublicReport report;
  final bool selected;
  final VoidCallback onTap;

  @override
  State<_ReportPin> createState() => _ReportPinState();
}

class _ReportPinState extends State<_ReportPin>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  )..repeat();

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = statusColor(widget.report.status);
    final diameter = widget.selected ? 54.0 : 44.0;
    return Semantics(
      button: true,
      label:
          '${widget.report.category.singularLabel}، ${widget.report.status.label}',
      child: InkWell(
        onTap: widget.onTap,
        customBorder: const CircleBorder(),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            SizedBox(
              width: widget.selected ? 88 : 68,
              height: widget.selected ? 80 : 48,
              child: AnimatedBuilder(
                animation: _pulse,
                builder: (context, child) => Stack(
                  alignment: Alignment.center,
                  children: [
                    if (widget.selected)
                      Container(
                        width: 70,
                        height: 70,
                        decoration: BoxDecoration(
                          color: color.withValues(alpha: 0.14),
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: color.withValues(alpha: 0.28),
                            width: 1.5,
                          ),
                        ),
                      ),
                    Opacity(
                      opacity:
                          (1 - _pulse.value) * (widget.selected ? 0.52 : 0.28),
                      child: Transform.scale(
                        scale:
                            1 + _pulse.value * (widget.selected ? 0.34 : 0.20),
                        child: Container(
                          width: diameter + (widget.selected ? 4 : 0),
                          height: diameter + (widget.selected ? 4 : 0),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: color,
                              width: widget.selected ? 2.5 : 2,
                            ),
                          ),
                        ),
                      ),
                    ),
                    child!,
                  ],
                ),
                child: Container(
                  width: diameter,
                  height: diameter,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: widget.selected ? _homeGold : Colors.white,
                      width: 3,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: color.withValues(
                          alpha: widget.selected ? 0.32 : 0.18,
                        ),
                        blurRadius: widget.selected ? 14 : 7,
                        spreadRadius: widget.selected ? 5 : 1,
                      ),
                    ],
                  ),
                  child: Icon(
                    categoryIcon(widget.report.category),
                    color: Colors.white,
                    size: 23,
                  ),
                ),
              ),
            ),
            Icon(Icons.arrow_drop_down_rounded, color: color, size: 20),
          ],
        ),
      ),
    );
  }
}

class _MapControl extends StatelessWidget {
  const _MapControl({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 2),
    child: Material(
      color: Colors.white.withValues(alpha: 0.96),
      elevation: 2,
      shape: const CircleBorder(side: BorderSide(color: _homeBorder)),
      clipBehavior: Clip.antiAlias,
      child: IconButton(
        tooltip: tooltip,
        onPressed: onTap,
        icon: Icon(icon, color: _homeTeal, size: 21),
        style: IconButton.styleFrom(
          shape: const CircleBorder(),
          fixedSize: const Size(42, 42),
          padding: EdgeInsets.zero,
        ),
      ),
    ),
  );
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.selected = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          icon,
          color: selected ? _homeTeal : const Color(0xFF87949A),
          size: 25,
        ),
        const SizedBox(height: 3),
        BalaghiButtonLabel(
          label,
          style: TextStyle(
            color: selected ? _homeTeal : const Color(0xFF87949A),
            fontSize: 11,
            fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
          ),
        ),
        if (selected) ...[
          const SizedBox(height: 3),
          const CircleAvatar(radius: 3, backgroundColor: _homeTeal),
        ],
      ],
    ),
  );
}
