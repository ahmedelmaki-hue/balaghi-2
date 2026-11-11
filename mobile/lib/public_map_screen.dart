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
import 'my_reports_repository.dart';
import 'my_reports_screen.dart';
import 'pending_reports.dart';
import 'public_reports.dart';
import 'report_details_screen.dart';
import 'report_updates.dart';
import 'report_ui.dart';

const _tripoli = LatLng(32.8912, 13.1905);
// Demo markers only when requested with --dart-define=BALAGHI_DEMO_MAP=true;
// otherwise the map always shows real reports from the API.
const _demoMap = bool.fromEnvironment('BALAGHI_DEMO_MAP', defaultValue: false);
const _homeTeal = Color(0xFF12323F);
const _homeGold = Color(0xFFE5A93C);
const _homeBorder = Color(0xFFE8E4DA);

class PublicMapScreen extends StatefulWidget {
  const PublicMapScreen({super.key, this.previewReports, this.mapBackground});

  /// Sample reports shown instead of the server's, for design previews and
  /// tests; with them the screen makes no network request.
  @visibleForTesting
  final List<PublicReport>? previewReports;

  /// Drawn instead of the live map tiles, which need the phone's map engine.
  @visibleForTesting
  final Widget? mapBackground;

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
  final _myReports = MyReportsRepository(baseUrl: apiBaseUrl);
  late final _demoReports = widget.previewReports ?? demoPublicReports();
  bool get _demo => _demoMap || widget.previewReports != null;
  AppLifecycleListener? _lifecycle;
  Timer? _refreshTimer;
  bool _mapReady = false;
  bool _userMovedMap = false;
  // Zoom in half steps: clusters are rebuilt only when this changes.
  double _clusterZoom = 13.5;
  bool _loading = false;
  // True once a load has taken long enough to explain the wait.
  bool _slowLoad = false;
  Timer? _slowTimer;
  int _requestSerial = 0;
  int _selectionSerial = 0;
  int _locationSerial = 0;
  ReportCategory? _category;
  List<PublicReport> _markers = const [];
  PublicReport? _selectedReport;
  LatLng? _userLocation;
  String? _loadError;
  // Own reports whose status changed since «بلاغاتي» was last opened.
  int _reportUpdates = 0;
  int _updatesSerial = 0;

  @override
  void initState() {
    super.initState();
    if (_demo) {
      _markers = _demoReports;
      _selectedReport = _demoReports.first;
    }
    if (!authPreviewMode && widget.previewReports == null) {
      _sendSavedReports();
      _checkReportUpdates();
      _lifecycle = AppLifecycleListener(
        onResume: () {
          _sendSavedReports();
          _checkReportUpdates();
        },
      );
    }
  }

  @override
  void dispose() {
    _lifecycle?.dispose();
    _refreshTimer?.cancel();
    _slowTimer?.cancel();
    _reportSender.dispose();
    _myReports.dispose();
    _repository.dispose();
    _authApi.dispose();
    _mapController.dispose();
    super.dispose();
  }

  List<PublicReport> get _visibleReports => _demo
      ? (_category == null
            ? _demoReports
            : _demoReports
                  .where((report) => report.category == _category)
                  .toList())
      : _markers;

  Future<void> _refresh() async {
    if (!_mapReady || !mounted) return;
    _refreshTimer?.cancel();
    if (_demo) {
      setState(() => _loadError = null);
      return;
    }
    final serial = ++_requestSerial;
    setState(() {
      _loading = true;
      _loadError = null;
    });
    _slowTimer?.cancel();
    _slowTimer = Timer(slowServerHint, () {
      if (mounted && serial == _requestSerial && _loading) {
        setState(() => _slowLoad = true);
      }
    });
    try {
      final reports = await _repository.fetchMarkers(
        _mapController.camera.visibleBounds,
        category: _category,
      );
      if (!mounted || serial != _requestSerial) return;
      _slowTimer?.cancel();
      setState(() {
        _markers = reports;
        _loading = false;
        _slowLoad = false;
        if (_selectedReport != null &&
            !reports.any((report) => report.id == _selectedReport!.id)) {
          _selectedReport = null;
        }
      });
    } catch (_) {
      if (!mounted || serial != _requestSerial) return;
      _slowTimer?.cancel();
      setState(() {
        _loading = false;
        _slowLoad = false;
        _loadError =
            'تعذّر تحميل البلاغات. تحقق من اتصالك بالإنترنت ثم حاول مجددًا.';
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
    if (_demo) return;
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
    if (!_demo && report.imageUrl == null) {
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
          previewImageAsset: _demo ? _demoImageFor(fullReport.category) : null,
        ),
      ),
    );
  }

  /// Sends reports saved while offline when the app opens or comes back to
  /// the foreground. Checks the device first so it costs nothing when empty.
  /// Quietly asks the server how many of the citizen's reports changed since
  /// «بلاغاتي» was last opened. Signed-out visitors and failures show no mark.
  Future<void> _checkReportUpdates() async {
    if (authPreviewMode) return;
    final serial = ++_updatesSerial;
    var count = 0;
    try {
      final saved = await _authStore.load();
      if (saved != null && !saved.needsProfile) {
        final session = await _authApi.restore(_authStore);
        if (session != null && !session.needsProfile) {
          count = await countReportUpdates(
            session: session,
            repository: _myReports,
          );
        }
      }
    } catch (_) {
      return;
    }
    if (mounted && serial == _updatesSerial) {
      setState(() => _reportUpdates = count);
    }
  }

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
    _checkReportUpdates();
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
    padding: const EdgeInsets.fromLTRB(14, 8, 14, 20),
    decoration: const BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [Color(0xF2FCF9F2), Color(0xCCFCF9F2), Color(0x00FCF9F2)],
        stops: [0, 0.7, 1],
      ),
    ),
    child: Column(
      children: [_header(), const SizedBox(height: 10), _filters()],
    ),
  );

  /// How many reports the visible part of the map holds, in words.
  String get _areaSummary {
    if (_demo) return 'بيانات تجريبية';
    if (_loadError != null) return 'تعذّر التحديث';
    if (_loading) return 'جارٍ التحديث…';
    final count = _visibleReports.length;
    return switch (count) {
      0 => 'لا بلاغات في هذه المنطقة',
      1 => 'بلاغ واحد في هذه المنطقة',
      2 => 'بلاغان في هذه المنطقة',
      <= 10 => '$count بلاغات في هذه المنطقة',
      _ => '$count بلاغًا في هذه المنطقة',
    };
  }

  Widget _header() => Container(
    height: 58,
    padding: const EdgeInsetsDirectional.fromSTEB(16, 0, 7, 0),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: _homeBorder),
      boxShadow: const [
        BoxShadow(
          color: Color(0x1712323F),
          blurRadius: 20,
          offset: Offset(0, 6),
        ),
      ],
    ),
    child: Row(
      children: [
        const Text(
          'بلاغي',
          style: TextStyle(
            color: _homeTeal,
            fontSize: 22,
            fontWeight: FontWeight.w800,
            height: 1.2,
          ),
        ),
        const SizedBox(width: 12),
        Container(width: 1, height: 26, color: _homeBorder),
        const SizedBox(width: 12),
        Expanded(
          child: Semantics(
            liveRegion: true,
            child: Text(
              _areaSummary,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: _loadError != null
                    ? const Color(0xFFB3261E)
                    : const Color(0xFF55676E),
                fontSize: 13,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ),
        _headerAction(
          icon: Icons.refresh_rounded,
          tooltip: 'تحديث الخريطة',
          onTap: _refresh,
        ),
        _headerAction(
          icon: Icons.person_outline_rounded,
          tooltip: 'حسابي',
          onTap: _openAccount,
        ),
      ],
    ),
  );

  Widget _headerAction({
    required IconData icon,
    required String tooltip,
    required VoidCallback onTap,
  }) => IconButton(
    tooltip: tooltip,
    onPressed: onTap,
    icon: Icon(icon, color: _homeTeal, size: 23),
    style: IconButton.styleFrom(
      fixedSize: const Size(44, 44),
      padding: EdgeInsets.zero,
    ),
  );

  /// The four categories side by side, so none is cut off on a narrow phone.
  Widget _filters() => Container(
    height: 48,
    padding: const EdgeInsets.all(4),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: _homeBorder),
      boxShadow: const [
        BoxShadow(
          color: Color(0x1012323F),
          blurRadius: 14,
          offset: Offset(0, 4),
        ),
      ],
    ),
    child: Row(
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
    return Expanded(
      flex: category == ReportCategory.waterLeak ? 13 : 10,
      child: Semantics(
        selected: selected,
        button: true,
        child: Material(
          color: selected ? _homeTeal : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
          child: InkWell(
            onTap: () => _selectCategory(category),
            borderRadius: BorderRadius.circular(12),
            child: Center(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      icon,
                      size: 16,
                      color: selected ? Colors.white : _homeTeal,
                    ),
                    const SizedBox(width: 5),
                    BalaghiButtonLabel(
                      label,
                      style: TextStyle(
                        color: selected ? Colors.white : _homeTeal,
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
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
            if (_demo) return;
            _refreshTimer?.cancel();
            _refreshTimer = Timer(const Duration(milliseconds: 550), _refresh);
          },
        ),
        children: [
          widget.mapBackground ??
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
      // Zoom and "my location" in one column, on the side away from the text.
      Positioned(
        top: 140,
        left: 14,
        child: Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: _homeBorder),
            boxShadow: const [
              BoxShadow(
                color: Color(0x1712323F),
                blurRadius: 16,
                offset: Offset(0, 5),
              ),
            ],
          ),
          child: Column(
            children: [
              _zoomControl(
                icon: Icons.add_rounded,
                tooltip: 'تكبير',
                onTap: () => _zoom(1),
              ),
              const SizedBox(
                width: 30,
                child: Divider(height: 1, color: _homeBorder),
              ),
              _zoomControl(
                icon: Icons.remove_rounded,
                tooltip: 'تصغير',
                onTap: () => _zoom(-1),
              ),
              const SizedBox(
                width: 30,
                child: Divider(height: 1, color: _homeBorder),
              ),
              _zoomControl(
                icon: Icons.my_location_rounded,
                tooltip: 'تحديد موقعي',
                onTap: () => _locate(),
              ),
            ],
          ),
        ),
      ),
      Positioned(
        top: 140,
        right: 14,
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(8),
          ),
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: 7, vertical: 3),
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
          top: 0,
          child: LinearProgressIndicator(
            color: _homeGold,
            backgroundColor: Color(0x33E5A93C),
            minHeight: 3,
          ),
        ),
      if (_slowLoad && _loading && _loadError == null)
        Positioned(
          top: 168,
          right: 14,
          left: 76,
          child: _mapNotice(
            icon: Icons.hourglass_top_rounded,
            text: slowServerMessage,
          ),
        ),
      if (_loadError != null)
        Positioned(
          top: 168,
          right: 14,
          left: 76,
          child: _mapNotice(
            icon: Icons.wifi_off_rounded,
            text: _loadError!,
            error: true,
            action: TextButton(
              onPressed: _refresh,
              style: TextButton.styleFrom(
                foregroundColor: _homeTeal,
                minimumSize: const Size(48, 44),
              ),
              child: const BalaghiButtonLabel(
                'إعادة المحاولة',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
              ),
            ),
          ),
        ),
      if (!_loading && _loadError == null && _visibleReports.isEmpty)
        Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 40),
            child: _mapNotice(
              icon: Icons.travel_explore_rounded,
              text:
                  'لا توجد بلاغات في هذه المنطقة. حرّك الخريطة أو اختر تصنيفًا آخر.',
            ),
          ),
        ),
      if (_selectedReport == null && _visibleReports.isNotEmpty)
        Positioned(right: 14, bottom: 14, child: _statusLegend()),
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

  /// A short message laid over the map: slow server, error or nothing found.
  Widget _mapNotice({
    required IconData icon,
    required String text,
    bool error = false,
    Widget? action,
  }) => Semantics(
    liveRegion: true,
    child: Container(
      padding: EdgeInsetsDirectional.fromSTEB(
        13,
        11,
        action == null ? 13 : 4,
        11,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: error ? const Color(0xFFF1C6C0) : _homeBorder,
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1712323F),
            blurRadius: 16,
            offset: Offset(0, 5),
          ),
        ],
      ),
      child: Row(
        children: [
          Icon(
            icon,
            size: 20,
            color: error ? const Color(0xFFB3261E) : _homeTeal,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                color: _homeTeal,
                fontSize: 13,
                height: 1.5,
              ),
            ),
          ),
          ?action,
        ],
      ),
    ),
  );

  /// What the pin colours mean, so a first-time visitor can read the map.
  Widget _statusLegend() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.95),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: _homeBorder),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final (index, status) in ReportStatus.values.indexed) ...[
          if (index > 0) const SizedBox(width: 12),
          Container(
            width: 10,
            height: 10,
            decoration: BoxDecoration(
              color: statusColor(status),
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 5),
          Text(
            status.label,
            style: const TextStyle(
              color: _homeTeal,
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ],
    ),
  );

  Widget _zoomControl({
    required IconData icon,
    required String tooltip,
    required VoidCallback onTap,
  }) => IconButton(
    tooltip: tooltip,
    onPressed: onTap,
    icon: Icon(icon, color: _homeTeal, size: 22),
    constraints: const BoxConstraints.tightFor(width: 46, height: 46),
    padding: EdgeInsets.zero,
  );

  Widget _preview(PublicReport report) => Container(
    padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(24),
      border: Border.all(color: _homeBorder),
      boxShadow: const [
        BoxShadow(
          color: Color(0x2412323F),
          blurRadius: 30,
          offset: Offset(0, 10),
        ),
      ],
    ),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _reportThumbnail(report),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          report.category.singularLabel,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: _homeTeal,
                            fontWeight: FontWeight.w800,
                            fontSize: 17,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      ReportStatusPill(status: report.status),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      const Icon(
                        Icons.location_on_outlined,
                        size: 15,
                        color: Color(0xFF55676E),
                      ),
                      const SizedBox(width: 3),
                      Expanded(
                        child: Text(
                          report.addressText?.trim().isNotEmpty == true
                              ? report.addressText!.trim()
                              : 'الموقع محدد على الخريطة',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Color(0xFF55676E),
                            fontSize: 13,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      const Icon(
                        Icons.schedule_rounded,
                        size: 14,
                        color: Color(0xFF6B7B80),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        reportDate(report.createdAt),
                        style: const TextStyle(
                          color: Color(0xFF6B7B80),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'إغلاق المعاينة',
              onPressed: _clearSelection,
              style: IconButton.styleFrom(
                backgroundColor: const Color(0xFFF2F4F4),
                fixedSize: const Size(36, 36),
                minimumSize: const Size(36, 36),
                padding: EdgeInsets.zero,
              ),
              icon: const Icon(Icons.close_rounded, color: _homeTeal, size: 19),
            ),
          ],
        ),
        if (report.description?.trim().isNotEmpty == true) ...[
          const SizedBox(height: 10),
          Text(
            report.description!.trim(),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Color(0xFF33464D),
              fontSize: 13,
              height: 1.6,
            ),
          ),
        ],
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: BalaghiGoldButton(
                label: 'عرض تفاصيل البلاغ',
                onPressed: () => _openReportDetails(report),
                height: 50,
                fontSize: 15,
                textColor: _homeTeal,
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              height: 50,
              child: OutlinedButton.icon(
                onPressed: () => _openDirections(report),
                style: OutlinedButton.styleFrom(
                  foregroundColor: _homeTeal,
                  side: const BorderSide(color: _homeBorder),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 14),
                ),
                icon: const Icon(Icons.location_on_outlined, size: 20),
                label: const BalaghiButtonLabel(
                  'الموقع',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
                ),
              ),
            ),
          ],
        ),
      ],
    ),
  );

  Widget _reportThumbnail(PublicReport report) {
    final imageUrl = report.imageUrl;
    final fallback = Container(
      color: const Color(0xFFE6EFF2),
      child: Icon(categoryIcon(report.category), color: _homeTeal, size: 28),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: SizedBox(
        width: 72,
        height: 72,
        child: imageUrl != null
            ? Image.network(
                imageUrl,
                fit: BoxFit.cover,
                cacheWidth: 216,
                loadingBuilder: (context, child, progress) =>
                    progress == null ? child : fallback,
                errorBuilder: (context, error, stackTrace) => fallback,
              )
            : _demo
            ? Image.asset(
                _demoImageFor(report.category),
                fit: BoxFit.cover,
                cacheWidth: 216,
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
    decoration: const BoxDecoration(
      color: Colors.white,
      border: Border(top: BorderSide(color: _homeBorder)),
      boxShadow: [
        BoxShadow(
          color: Color(0x1412323F),
          blurRadius: 20,
          offset: Offset(0, -6),
        ),
      ],
    ),
    child: SafeArea(
      top: false,
      child: SizedBox(
        height: 82,
        child: Row(
          children: [
            Expanded(
              child: _NavItem(
                icon: Icons.map_rounded,
                label: 'الخريطة',
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
              child: Semantics(
                button: true,
                label: 'إبلاغ عن مشكلة جديدة',
                excludeSemantics: true,
                child: InkWell(
                  onTap: _openCreateReport,
                  customBorder: const StadiumBorder(),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        width: 54,
                        height: 54,
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
                              blurRadius: 18,
                              offset: Offset(0, 6),
                            ),
                          ],
                        ),
                        child: const Icon(
                          Icons.add_rounded,
                          color: _homeTeal,
                          size: 30,
                        ),
                      ),
                      const SizedBox(height: 3),
                      const BalaghiButtonLabel(
                        'إبلاغ',
                        style: TextStyle(
                          color: _homeTeal,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            Expanded(
              child: _NavItem(
                icon: Icons.assignment_outlined,
                label: 'بلاغاتي',
                onTap: _openMyReports,
                badge: _reportUpdates,
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

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.selected = false,
    this.badge = 0,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool selected;

  /// A count of updates shown on the icon; zero shows nothing.
  final int badge;

  @override
  Widget build(BuildContext context) => Semantics(
    label: badge > 0 ? '$label، $badge بلاغات تغيّرت حالتها' : null,
    child: InkWell(
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Badge(
            isLabelVisible: badge > 0,
            label: Text(badge > 9 ? '9+' : '$badge'),
            backgroundColor: const Color(0xFFC93636),
            textColor: Colors.white,
            offset: const Offset(-6, -4),
            child: Icon(
              icon,
              color: selected ? _homeTeal : const Color(0xFF6B7B80),
              size: 25,
            ),
          ),
          const SizedBox(height: 3),
          BalaghiButtonLabel(
            label,
            style: TextStyle(
              color: selected ? _homeTeal : const Color(0xFF6B7B80),
              fontSize: 12.5,
              fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
            ),
          ),
          if (selected) ...[
            const SizedBox(height: 3),
            const CircleAvatar(radius: 3, backgroundColor: _homeTeal),
          ],
        ],
      ),
    ),
  );
}
