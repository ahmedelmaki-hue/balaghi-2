import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_maplibre/flutter_map_maplibre.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'public_reports.dart';
import 'report_image_viewer.dart';
import 'report_ui.dart';

const _ink = Color(0xFF12323F);
const _muted = Color(0xFF55676E);
const _border = Color(0xFFEAE4D8);

class ReportDetailsScreen extends StatelessWidget {
  const ReportDetailsScreen({
    super.key,
    required this.report,
    this.pendingReview = false,
    this.previewImageAsset,
    this.locationMapBuilder,
  });

  final PublicReport report;
  final bool pendingReview;
  final String? previewImageAsset;
  final Widget Function(PublicReport)? locationMapBuilder;

  Uri get _mapUrl => Uri.https('www.google.com', '/maps/search/', {
    'api': '1',
    'query': '${report.location.latitude},${report.location.longitude}',
  });

  Future<void> _share(BuildContext context) async {
    final message = [
      'بلاغي — ${report.title}',
      'الحالة: ${report.status.label}',
      if (report.description?.trim().isNotEmpty == true)
        'الوصف: ${report.description!.trim()}',
      if (report.addressText?.trim().isNotEmpty == true)
        'الموقع: ${report.addressText!.trim()}',
      'رقم البلاغ: ${report.id}',
      _mapUrl.toString(),
    ].join('\n');
    final box = context.findRenderObject() as RenderBox?;
    try {
      await SharePlus.instance.share(
        ShareParams(
          text: message,
          title: 'بلاغي — ${report.title}',
          sharePositionOrigin: box == null
              ? null
              : box.localToGlobal(Offset.zero) & box.size,
        ),
      );
    } catch (_) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذرت مشاركة البلاغ الآن.')),
      );
    }
  }

  Future<void> _openInMaps(BuildContext context) async {
    try {
      if (await launchUrl(_mapUrl, mode: LaunchMode.externalApplication)) {
        return;
      }
    } catch (_) {
      // Falls through to the message below.
    }
    if (!context.mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('تعذر فتح تطبيق الخرائط.')));
  }

  String get _address => report.addressText?.trim().isNotEmpty == true
      ? report.addressText!.trim()
      : 'الموقع محدد على الخريطة';

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: TextDirection.rtl,
    child: Scaffold(
      backgroundColor: civicWarmBackground,
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            stops: [0, 0.38, 1],
            colors: [
              civicWarmTopGlow,
              civicWarmBackground,
              civicWarmBackground,
            ],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                children: [
                  _header(context),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                      children: [
                        _reportImage(context),
                        const SizedBox(height: 14),
                        _summaryCard(),
                        const SizedBox(height: 12),
                        _descriptionCard(),
                        const SizedBox(height: 12),
                        _locationCard(context),
                      ],
                    ),
                  ),
                  if (!pendingReview) _actionBar(context),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  );

  /// The title in the middle with the report number beside it; back on the side.
  Widget _header(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
    child: SizedBox(
      height: 48,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 56),
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'تفاصيل البلاغ',
                    style: TextStyle(
                      color: _ink,
                      fontSize: 21,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Semantics(
                    label: 'رقم البلاغ ${report.id}',
                    excludeSemantics: true,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: _border),
                      ),
                      child: Text(
                        '#${report.id}',
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(
                          color: _muted,
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: BalaghiBackButton(
              onPressed: () => Navigator.of(context).maybePop(),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _reportImage(BuildContext context) {
    final hasImage = report.imageUrl != null || previewImageAsset != null;
    final image = report.imageUrl != null
        ? Image.network(
            report.imageUrl!,
            fit: BoxFit.contain,
            errorBuilder: (_, _, _) => _imagePlaceholder(),
          )
        : previewImageAsset != null
        ? Image.asset(
            previewImageAsset!,
            fit: BoxFit.contain,
            errorBuilder: (_, _, _) => _imagePlaceholder(),
          )
        : _imagePlaceholder();
    final card = Container(
      height: 260,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: _border),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1212323F),
            blurRadius: 20,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(21),
        child: Stack(
          fit: StackFit.expand,
          children: [
            const ColoredBox(color: Color(0xFFEEF2F3)),
            image,
            if (hasImage)
              Positioned(
                left: 12,
                bottom: 12,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xE612323F),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.zoom_in_rounded,
                        color: Colors.white,
                        size: 18,
                      ),
                      SizedBox(width: 5),
                      Text(
                        'عرض الصورة كاملة',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
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
    if (!hasImage) return card;
    return Tooltip(
      message: 'عرض الصورة كاملة',
      child: GestureDetector(
        onTap: () => openReportImageViewer(
          context,
          imageUrl: report.imageUrl,
          assetPath: previewImageAsset,
        ),
        child: card,
      ),
    );
  }

  Widget _imagePlaceholder() => const ColoredBox(
    color: Color(0xFFEEF2F3),
    child: Center(
      child: Icon(Icons.image_outlined, size: 48, color: Color(0xFF9AA8AD)),
    ),
  );

  /// The same card as the rest of the app: white, one border, a soft shadow.
  Widget _card(Widget child) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: _border),
      boxShadow: const [
        BoxShadow(
          color: Color(0x0F12323F),
          blurRadius: 16,
          offset: Offset(0, 5),
        ),
      ],
    ),
    child: child,
  );

  /// What, where, when and its state, in one card.
  Widget _summaryCard() => _card(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                report.category.singularLabel,
                style: const TextStyle(
                  color: _ink,
                  fontSize: 21,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            _statusBadge(),
          ],
        ),
        const SizedBox(height: 8),
        _metaLine(Icons.location_on_outlined, _address),
        const SizedBox(height: 4),
        _metaLine(
          Icons.schedule_rounded,
          'أُرسل ${reportDate(report.createdAt)}',
        ),
        if (pendingReview) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
            decoration: BoxDecoration(
              color: const Color(0xFFFFF7E6),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: EdgeInsets.only(top: 2),
                  child: Icon(
                    Icons.hourglass_top_rounded,
                    size: 16,
                    color: Color(0xFF8A5A00),
                  ),
                ),
                SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'استلمنا البلاغ. ستراجعه البلدية قبل ظهوره على الخريطة العامة، ويمكنك متابعة حالته من «بلاغاتي».',
                    style: TextStyle(
                      color: Color(0xFF8A5A00),
                      fontSize: 13,
                      height: 1.6,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    ),
  );

  Widget _metaLine(IconData icon, String text) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.only(top: 2),
        child: Icon(icon, size: 16, color: _muted),
      ),
      const SizedBox(width: 6),
      Expanded(
        child: Text(
          text,
          style: const TextStyle(color: _muted, fontSize: 13.5, height: 1.5),
        ),
      ),
    ],
  );

  Widget _statusBadge() {
    if (pendingReview) {
      return const _Chip(
        label: 'بانتظار المراجعة',
        color: Color(0xFF9A6700),
        background: Color(0xFFFFF3D6),
      );
    }
    final color = statusColor(report.status);
    return _Chip(
      label: report.status.label,
      color: color,
      background: color.withValues(alpha: 0.12),
      showDot: true,
    );
  }

  Widget _sectionHeading(String label, IconData icon) => Row(
    children: [
      Icon(icon, size: 19, color: _ink),
      const SizedBox(width: 7),
      Text(
        label,
        style: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w800,
          color: _ink,
        ),
      ),
    ],
  );

  Widget _descriptionCard() => _card(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionHeading('الوصف', Icons.notes_rounded),
        const SizedBox(height: 8),
        Text(
          report.description?.trim().isNotEmpty == true
              ? report.description!.trim()
              : 'لم يُضف وصف لهذا البلاغ.',
          style: TextStyle(
            fontSize: 14.5,
            color: report.description?.trim().isNotEmpty == true
                ? const Color(0xFF26393F)
                : _muted,
            height: 1.7,
          ),
        ),
      ],
    ),
  );

  Widget _locationCard(BuildContext context) => _card(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionHeading('الموقع', Icons.location_on_outlined),
        const SizedBox(height: 10),
        _LocationPreview(report: report, mapBuilder: locationMapBuilder),
        const SizedBox(height: 10),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: () => _openInMaps(context),
            style: OutlinedButton.styleFrom(
              foregroundColor: _ink,
              side: const BorderSide(color: _border),
              minimumSize: const Size(48, 46),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
            icon: const Icon(Icons.map_outlined, size: 19),
            label: const BalaghiButtonLabel(
              'فتح الموقع في الخرائط',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _actionBar(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
    decoration: const BoxDecoration(
      color: Color(0xF9FCF9F2),
      border: Border(top: BorderSide(color: _border)),
    ),
    child: BalaghiGoldButton(
      label: 'مشاركة تفاصيل البلاغ',
      icon: Icons.share_outlined,
      onPressed: () => _share(context),
      height: 56,
      fontSize: 16,
      textColor: _ink,
    ),
  );
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.color,
    required this.background,
    this.showDot = false,
  });

  final String label;
  final Color color;
  final Color background;
  final bool showDot;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
    decoration: BoxDecoration(
      color: background,
      borderRadius: BorderRadius.circular(999),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (showDot) ...[
          CircleAvatar(radius: 4, backgroundColor: color),
          const SizedBox(width: 6),
        ],
        Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w700,
            color: color,
          ),
        ),
      ],
    ),
  );
}

class _LocationPreview extends StatelessWidget {
  const _LocationPreview({required this.report, this.mapBuilder});
  final PublicReport report;
  final Widget Function(PublicReport)? mapBuilder;

  @override
  Widget build(BuildContext context) => Container(
    height: 160,
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: _border),
    ),
    child: ClipRRect(
      borderRadius: BorderRadius.circular(13),
      child: IgnorePointer(
        child:
            mapBuilder?.call(report) ??
            FlutterMap(
              options: MapOptions(
                initialCenter: report.location,
                initialZoom: 16,
                minZoom: 5,
                maxZoom: 18,
                backgroundColor: const Color(0xFFF3F1EA),
              ),
              children: [
                const MapLibreLayer(
                  initStyle: 'https://tiles.openfreemap.org/styles/bright',
                ),
                MarkerLayer(
                  markers: [
                    Marker(
                      point: report.location,
                      width: 42,
                      height: 42,
                      child: Container(
                        decoration: BoxDecoration(
                          color: statusColor(report.status),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 3),
                          boxShadow: const [
                            BoxShadow(color: Color(0x66000000), blurRadius: 9),
                          ],
                        ),
                        child: Icon(
                          categoryIcon(report.category),
                          color: Colors.white,
                          size: 21,
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
}
