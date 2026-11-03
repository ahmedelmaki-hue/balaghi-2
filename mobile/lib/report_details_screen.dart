import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_maplibre/flutter_map_maplibre.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:share_plus/share_plus.dart';

import 'public_reports.dart';
import 'report_image_viewer.dart';
import 'report_ui.dart';

const _ink = Color(0xFF292524);
const _muted = Color(0xFF78716C);
const _amber = Color(0xFFF59E0B);
const _cardBorder = Color(0x1AB45309);

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

  Future<void> _share(BuildContext context) async {
    final mapUrl = Uri.https('www.google.com', '/maps/search/', {
      'api': '1',
      'query': '${report.location.latitude},${report.location.longitude}',
    });
    final message = [
      'بلاغي — ${report.title}',
      'الحالة: ${report.status.label}',
      if (report.description?.trim().isNotEmpty == true)
        'الوصف: ${report.description!.trim()}',
      if (report.addressText?.trim().isNotEmpty == true)
        'الموقع: ${report.addressText!.trim()}',
      'رقم البلاغ: ${report.id}',
      mapUrl.toString(),
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
                  _topBar(context),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                      children: [
                        _reportImage(context),
                        const SizedBox(height: 15),
                        _titleCard(),
                        if (pendingReview) ...[
                          const SizedBox(height: 12),
                          _pendingNotice(),
                        ],
                        const SizedBox(height: 15),
                        _descriptionCard(),
                        const SizedBox(height: 15),
                        _locationCard(),
                        const SizedBox(height: 15),
                        _timingCard(),
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

  Widget _topBar(BuildContext context) => Container(
    height: 61,
    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.78),
      border: const Border(bottom: BorderSide(color: _cardBorder)),
    ),
    child: Row(
      children: [
        BalaghiBackButton(onPressed: () => Navigator.of(context).maybePop()),
        Expanded(
          child: Center(
            child: Text(
              'تفاصيل البلاغ',
              style: GoogleFonts.cairo(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: _ink,
              ),
            ),
          ),
        ),
        const SizedBox(width: 44),
      ],
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
      height: 280,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(25),
        border: Border.all(color: _cardBorder),
        boxShadow: const [
          BoxShadow(
            color: Color(0x12B45309),
            blurRadius: 26,
            offset: Offset(0, 8),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Stack(
          fit: StackFit.expand,
          children: [
            const ColoredBox(color: Color(0xFFF1EEE8)),
            image,
            if (hasImage)
              Positioned(
                left: 12,
                bottom: 12,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 11,
                    vertical: 7,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xDD12323F),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.zoom_in_rounded,
                        color: Colors.white,
                        size: 17,
                      ),
                      const SizedBox(width: 5),
                      Text(
                        'عرض الصورة كاملة',
                        style: GoogleFonts.cairo(
                          color: Colors.white,
                          fontSize: 11,
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
    color: Color(0xFFF1EEE8),
    child: Center(
      child: Icon(Icons.image_outlined, size: 48, color: Color(0xFFA8A29E)),
    ),
  );

  Widget _card(Widget child) => Container(
    padding: const EdgeInsets.all(17),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.91),
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: _cardBorder),
      boxShadow: const [
        BoxShadow(
          color: Color(0x10B45309),
          blurRadius: 24,
          offset: Offset(0, 7),
        ),
        BoxShadow(
          color: Color(0x09000000),
          blurRadius: 5,
          offset: Offset(0, 2),
        ),
      ],
    ),
    child: child,
  );

  Widget _titleCard() => _card(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: const Color(0xFFFFFBEB),
            borderRadius: BorderRadius.circular(9),
            border: Border.all(color: const Color(0x55FDE68A)),
          ),
          child: Text(
            'رقم البلاغ: ${report.id}',
            style: GoogleFonts.cairo(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: const Color(0xFFB45309),
            ),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          report.title,
          style: GoogleFonts.cairo(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            color: _ink,
            height: 1.5,
          ),
        ),
        const SizedBox(height: 11),
        const Divider(height: 1, color: Color(0xFFF0EEEA)),
        const SizedBox(height: 11),
        _statusBadge(),
      ],
    ),
  );

  Widget _statusBadge() {
    if (pendingReview) {
      return const _Chip(
        label: 'بانتظار المراجعة',
        color: Color(0xFF9A6700),
        background: Color(0xFFFFF3D6),
        border: Color(0xFFF7D78B),
        showDot: true,
      );
    }
    final color = statusColor(report.status);
    return _Chip(
      label: report.status.label,
      color: color,
      background: color.withValues(alpha: 0.1),
      border: color.withValues(alpha: 0.26),
      showDot: true,
    );
  }

  Widget _pendingNotice() => _card(
    const Text(
      'استلمنا البلاغ. ستراجعه الجهة المختصة قبل ظهوره على الخريطة العامة، ويمكنك متابعة حالته من «بلاغاتي».',
      style: TextStyle(color: _muted, fontSize: 13, height: 1.6),
    ),
  );

  Widget _sectionHeading(String label, IconData icon) => Row(
    children: [
      Icon(icon, size: 18, color: const Color(0xFFD97706)),
      const SizedBox(width: 7),
      Text(
        label,
        style: GoogleFonts.cairo(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: _muted,
        ),
      ),
    ],
  );

  Widget _descriptionCard() => _card(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionHeading('الوصف', Icons.description_outlined),
        const SizedBox(height: 10),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(13),
          decoration: BoxDecoration(
            color: const Color(0xFFFAFAF9),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFE7E5E4)),
          ),
          child: Text(
            report.description?.trim().isNotEmpty == true
                ? report.description!.trim()
                : 'لم يُضف وصف لهذا البلاغ.',
            style: GoogleFonts.cairo(fontSize: 13, color: _ink, height: 1.7),
          ),
        ),
      ],
    ),
  );

  Widget _locationCard() => _card(
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionHeading('الموقع الجغرافي', Icons.location_on_outlined),
        const SizedBox(height: 9),
        Text(
          report.addressText?.trim().isNotEmpty == true
              ? report.addressText!.trim()
              : 'الموقع محدد بالإحداثيات.',
          style: GoogleFonts.cairo(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: _ink,
          ),
        ),
        const SizedBox(height: 11),
        _LocationPreview(report: report, mapBuilder: locationMapBuilder),
      ],
    ),
  );

  Widget _timingCard() {
    final local = report.createdAt.toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    return _card(
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionHeading('توقيت البلاغ', Icons.schedule_outlined),
          const SizedBox(height: 11),
          Row(
            children: [
              Expanded(
                child: _TimeTile(
                  label: 'تاريخ الإرسال',
                  value: '${two(local.day)}/${two(local.month)}/${local.year}',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _TimeTile(
                  label: 'وقت الإرسال',
                  value: '${two(local.hour)}:${two(local.minute)}',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _actionBar(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.fromLTRB(20, 12, 20, 15),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.88),
      border: const Border(top: BorderSide(color: _cardBorder)),
      boxShadow: const [
        BoxShadow(
          color: Color(0x10000000),
          blurRadius: 22,
          offset: Offset(0, -7),
        ),
      ],
    ),
    child: Container(
      height: 54,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [_amber, Color(0xFFFBBF24), _amber],
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFCD34D)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x59F59E0B),
            blurRadius: 22,
            offset: Offset(0, 9),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => _share(context),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.share_outlined, size: 20, color: _ink),
              const SizedBox(width: 9),
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    'مشاركة تفاصيل البلاغ',
                    maxLines: 1,
                    style: GoogleFonts.cairo(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: _ink,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _Chip extends StatelessWidget {
  const _Chip({
    required this.label,
    required this.color,
    required this.background,
    required this.border,
    this.showDot = false,
  });

  final String label;
  final Color color;
  final Color background;
  final Color border;
  final bool showDot;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
    decoration: BoxDecoration(
      color: background,
      borderRadius: BorderRadius.circular(999),
      border: Border.all(color: border),
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
          style: GoogleFonts.cairo(
            fontSize: 11,
            fontWeight: FontWeight.w700,
            color: color,
          ),
        ),
      ],
    ),
  );
}

class _TimeTile extends StatelessWidget {
  const _TimeTile({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(11),
    decoration: BoxDecoration(
      color: const Color(0xFFFAFAF9),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: const Color(0xFFE7E5E4)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: GoogleFonts.cairo(fontSize: 11, color: _muted)),
        const SizedBox(height: 2),
        Text(
          value,
          textDirection: TextDirection.ltr,
          style: GoogleFonts.cairo(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: _ink,
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
    height: 145,
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(13),
      border: Border.all(color: const Color(0xFFD6D3D1)),
    ),
    child: ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Stack(
        fit: StackFit.expand,
        children: [
          IgnorePointer(
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
                                BoxShadow(
                                  color: Color(0x66000000),
                                  blurRadius: 9,
                                ),
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
          Positioned(
            bottom: 7,
            right: 7,
            child: Container(
              constraints: const BoxConstraints(maxWidth: 230),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: _ink.withValues(alpha: 0.82),
                borderRadius: BorderRadius.circular(20),
              ),
              // The street name when the server found one, else the coordinates.
              child: Text(
                report.addressText?.trim().isNotEmpty == true
                    ? report.addressText!.trim()
                    : '${report.location.latitude.toStringAsFixed(4)}, '
                          '${report.location.longitude.toStringAsFixed(4)}',
                textDirection: report.addressText?.trim().isNotEmpty == true
                    ? TextDirection.rtl
                    : TextDirection.ltr,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: GoogleFonts.cairo(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
