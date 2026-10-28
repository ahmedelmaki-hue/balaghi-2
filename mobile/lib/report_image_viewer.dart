import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'report_ui.dart';

Future<void> openReportImageViewer(
  BuildContext context, {
  String? imageUrl,
  String? assetPath,
}) async {
  if (imageUrl == null && assetPath == null) return;
  await Navigator.of(context).push<void>(
    MaterialPageRoute(
      builder: (_) =>
          ReportImageViewer(imageUrl: imageUrl, assetPath: assetPath),
    ),
  );
}

class ReportImageViewer extends StatelessWidget {
  const ReportImageViewer({super.key, this.imageUrl, this.assetPath});

  final String? imageUrl;
  final String? assetPath;

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: TextDirection.rtl,
    child: Scaffold(
      backgroundColor: const Color(0xFF0B0F17),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 8),
              child: Row(
                children: [
                  BalaghiBackButton(
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                  Expanded(
                    child: Center(
                      child: Text(
                        'صورة البلاغ',
                        style: GoogleFonts.cairo(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 44),
                ],
              ),
            ),
            Expanded(
              child: InteractiveViewer(
                minScale: 1,
                maxScale: 5,
                child: Center(child: _image()),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
              child: Text(
                'استخدم إصبعين لتكبير الصورة',
                style: GoogleFonts.cairo(
                  color: const Color(0xFFB6BDC6),
                  fontSize: 12,
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _image() {
    if (imageUrl != null) {
      return Image.network(
        imageUrl!,
        key: const Key('full_report_image'),
        fit: BoxFit.contain,
        errorBuilder: (_, _, _) => _unavailable(),
      );
    }
    if (assetPath != null) {
      return Image.asset(
        assetPath!,
        key: const Key('full_report_image'),
        fit: BoxFit.contain,
        errorBuilder: (_, _, _) => _unavailable(),
      );
    }
    return _unavailable();
  }

  Widget _unavailable() =>
      const Text('تعذّر عرض الصورة.', style: TextStyle(color: Colors.white70));
}
