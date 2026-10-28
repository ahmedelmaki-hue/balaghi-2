import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'public_reports.dart';

/// Keeps action labels in the same Cairo face used by the report share button.
class BalaghiButtonLabel extends StatelessWidget {
  const BalaghiButtonLabel(
    this.label, {
    super.key,
    this.style,
    this.textAlign,
    this.maxLines,
    this.overflow,
  });

  final String label;
  final TextStyle? style;
  final TextAlign? textAlign;
  final int? maxLines;
  final TextOverflow? overflow;

  @override
  Widget build(BuildContext context) => Text(
    label,
    textAlign: textAlign,
    maxLines: maxLines,
    overflow: overflow,
    style: GoogleFonts.cairo(
      textStyle: DefaultTextStyle.of(context).style.merge(style),
    ),
  );
}

const civicTeal = Color(0xFF126477);
const civicGold = Color(0xFFF2C94C);
const civicBackground = Color(0xFFF4FAFD);
const civicText = Color(0xFF161D1F);
const civicWarmBackground = Color(0xFFFCF9F2);
const civicWarmTopGlow = Color(0xFFFEF3C7);
const civicWarmGold = Color(0xFFE5A93C);
const civicWarmInk = Color(0xFF12323F);

class BalaghiWarmBackdrop extends StatelessWidget {
  const BalaghiWarmBackdrop({super.key});

  @override
  Widget build(BuildContext context) => const IgnorePointer(
    child: DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [civicWarmTopGlow, civicWarmBackground, civicWarmBackground],
          stops: [0, 0.38, 1],
        ),
      ),
    ),
  );
}

class BalaghiBackButton extends StatelessWidget {
  const BalaghiBackButton({super.key, required this.onPressed});

  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: 'رجوع',
    child: Material(
      color: Colors.white.withValues(alpha: 0.92),
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFFDCE4E8)),
          ),
          child: const Icon(
            Icons.chevron_right_rounded,
            textDirection: TextDirection.ltr,
            size: 25,
            color: civicWarmInk,
          ),
        ),
      ),
    ),
  );
}

class BalaghiGoldButton extends StatelessWidget {
  const BalaghiGoldButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.loading = false,
    this.fontSize = 17,
    this.textColor = civicWarmInk,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final double fontSize;
  final Color textColor;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    height: 58,
    decoration: BoxDecoration(
      gradient: const LinearGradient(
        colors: [Color(0xFFFBBF24), civicWarmGold, Color(0xFFF59E0B)],
      ),
      borderRadius: BorderRadius.circular(17),
      boxShadow: const [
        BoxShadow(
          color: Color(0x55E5A93C),
          blurRadius: 21,
          offset: Offset(0, 8),
        ),
      ],
    ),
    child: Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(17),
        child: Center(
          child: loading
              ? SizedBox.square(
                  dimension: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: textColor,
                  ),
                )
              : BalaghiButtonLabel(
                  label,
                  style: TextStyle(
                    color: textColor,
                    fontSize: fontSize,
                    fontWeight: FontWeight.w800,
                  ),
                ),
        ),
      ),
    ),
  );
}

Color statusColor(ReportStatus status) => switch (status) {
  ReportStatus.newReport => const Color(0xFFC93636),
  ReportStatus.inProgress => const Color(0xFF2D8BC4),
  ReportStatus.resolved => const Color(0xFF4B9A67),
};

IconData categoryIcon(ReportCategory category) => switch (category) {
  ReportCategory.pothole => Icons.construction_rounded,
  ReportCategory.waterLeak => Icons.water_drop_rounded,
  ReportCategory.garbage => Icons.delete_outline_rounded,
};

String reportDate(DateTime date) {
  final local = date.toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return '${two(local.day)}/${two(local.month)}/${local.year}  '
      '${two(local.hour)}:${two(local.minute)}';
}

class ReportStatusPill extends StatelessWidget {
  const ReportStatusPill({super.key, required this.status});

  final ReportStatus status;

  @override
  Widget build(BuildContext context) {
    final color = statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircleAvatar(radius: 4, backgroundColor: color),
          const SizedBox(width: 6),
          Text(
            status.label,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
