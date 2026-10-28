import 'dart:math' as math;

import 'package:flutter/material.dart';

const _navy = Color(0xFF30454F);
const _teal = Color(0xFF4D93A8);
const _gold = Color(0xFFF2C94C);
const _orange = Color(0xFFE7A35B);
const _green = Color(0xFF70AD83);
const _pale = Color(0xFFE8F1F2);
const _line = Color(0xFFCDDBDF);

/// Four code-drawn scenes. Each plays once when its page is first shown.
class OnboardingIllustration extends StatefulWidget {
  const OnboardingIllustration({super.key, required this.page});

  final int page;

  @override
  State<OnboardingIllustration> createState() => _OnboardingIllustrationState();
}

class _OnboardingIllustrationState extends State<OnboardingIllustration>
    with SingleTickerProviderStateMixin {
  late final AnimationController _animation = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1100),
  )..forward();

  @override
  void didUpdateWidget(covariant OnboardingIllustration oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.page != widget.page) _animation.forward(from: 0);
  }

  @override
  void dispose() {
    _animation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final size = math.min(
        constraints.maxWidth * 0.94,
        constraints.maxHeight * 0.88,
      );
      return Center(
        child: SizedBox.square(
          dimension: size,
          child: RepaintBoundary(
            child: AnimatedBuilder(
              animation: _animation,
              builder: (context, _) => CustomPaint(
                painter: _ScenePainter(widget.page, _animation.value),
              ),
            ),
          ),
        ),
      );
    },
  );
}

class _ScenePainter extends CustomPainter {
  const _ScenePainter(this.page, this.progress);

  final int page;
  final double progress;

  static final _softShadow = Paint()
    ..color = const Color(0x220B4150)
    ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 13);

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty) return;
    canvas.save();
    canvas.scale(size.width / 300, size.height / 300);
    _backdrop(canvas);
    switch (page) {
      case 0:
        _camera(canvas);
      case 1:
        _location(canvas);
      case 2:
        _publicMap(canvas);
      case 3:
        _municipality(canvas);
    }
    canvas.restore();
  }

  void _backdrop(Canvas canvas) {
    final card = RRect.fromRectAndRadius(
      const Rect.fromLTWH(20, 28, 260, 244),
      const Radius.circular(35),
    );
    canvas.drawRRect(card.shift(const Offset(0, 8)), _softShadow);
    canvas.drawRRect(card, Paint()..color = _pale);
    _circle(canvas, const Offset(43, 58), 5, _gold.withValues(alpha: 0.75));
    _circle(canvas, const Offset(260, 227), 4, _teal.withValues(alpha: 0.5));
    _rounded(canvas, const Rect.fromLTWH(43, 235, 25, 5), 3, _line);
    _rounded(canvas, const Rect.fromLTWH(232, 57, 22, 5), 3, _line);
  }

  void _camera(Canvas canvas) {
    final enter = Curves.easeOutBack.transform(progress);
    canvas.save();
    canvas.translate(0, 22 * (1 - enter));
    _rounded(canvas, const Rect.fromLTWH(83, 51, 134, 207), 24, _navy);
    _rounded(canvas, const Rect.fromLTWH(91, 59, 118, 191), 19, Colors.white);
    _rounded(
      canvas,
      const Rect.fromLTWH(98, 76, 104, 134),
      10,
      const Color(0xFFE0F2F1),
    );
    _rounded(canvas, const Rect.fromLTWH(132, 66, 36, 4), 2, _line);

    // A small city and a road defect inside the camera viewfinder.
    _rounded(
      canvas,
      const Rect.fromLTWH(107, 120, 16, 38),
      2,
      const Color(0xFFAAD1C3),
    );
    _rounded(
      canvas,
      const Rect.fromLTWH(127, 107, 19, 51),
      2,
      const Color(0xFFBEDDD1),
    );
    _rounded(
      canvas,
      const Rect.fromLTWH(150, 126, 19, 32),
      2,
      const Color(0xFF9FCABC),
    );
    _rounded(
      canvas,
      const Rect.fromLTWH(173, 115, 20, 43),
      2,
      const Color(0xFFBEDDD1),
    );
    final road = Path()
      ..moveTo(122, 156)
      ..lineTo(178, 156)
      ..lineTo(202, 210)
      ..lineTo(98, 210)
      ..close();
    canvas.drawPath(road, Paint()..color = const Color(0xFF577887));
    _lineTo(
      canvas,
      const Offset(150, 163),
      const Offset(150, 177),
      Colors.white,
      2,
    );
    _lineTo(
      canvas,
      const Offset(150, 188),
      const Offset(150, 200),
      Colors.white,
      2,
    );
    final pothole = Path()
      ..moveTo(121, 189)
      ..quadraticBezierTo(132, 180, 142, 188)
      ..quadraticBezierTo(154, 182, 169, 190)
      ..quadraticBezierTo(161, 201, 137, 199)
      ..quadraticBezierTo(119, 200, 121, 189);
    canvas.drawPath(pothole, Paint()..color = const Color(0xFF283E49));

    // Gold capture brackets and shutter.
    for (final x in [107.0, 185.0]) {
      for (final y in [84.0, 188.0]) {
        final dx = x < 150 ? 9.0 : -9.0;
        final dy = y < 150 ? 9.0 : -9.0;
        _lineTo(canvas, Offset(x, y), Offset(x + dx, y), _gold, 2.6);
        _lineTo(canvas, Offset(x, y), Offset(x, y + dy), _gold, 2.6);
      }
    }
    _circle(canvas, const Offset(150, 231), 12, _teal);
    _circle(canvas, const Offset(150, 231), 6, Colors.white);
    canvas.restore();

    final ring = 18 + 17 * progress;
    canvas.drawCircle(
      const Offset(150, 231),
      ring,
      Paint()
        ..color = _gold.withValues(alpha: 0.5 * (1 - progress))
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3,
    );
    _cameraBadge(canvas, progress);
  }

  void _cameraBadge(Canvas canvas, double progress) {
    final pop = Curves.elasticOut.transform(progress.clamp(0, 1));
    canvas.save();
    canvas.translate(233, 86);
    canvas.scale(0.4 + 0.6 * pop);
    _rounded(canvas, const Rect.fromLTWH(-24, -20, 48, 39), 11, _gold);
    _rounded(canvas, const Rect.fromLTWH(-14, -10, 28, 21), 4, _navy);
    _circle(canvas, const Offset(0, 0), 7, Colors.white);
    _circle(canvas, const Offset(0, 0), 4, _teal);
    canvas.restore();
  }

  void _location(Canvas canvas) {
    _rounded(canvas, const Rect.fromLTWH(43, 62, 214, 179), 19, Colors.white);
    canvas.save();
    canvas.clipRRect(
      RRect.fromRectAndRadius(
        const Rect.fromLTWH(48, 67, 204, 169),
        const Radius.circular(15),
      ),
    );
    _rounded(
      canvas,
      const Rect.fromLTWH(60, 80, 52, 46),
      6,
      const Color(0xFFFFF0CD),
    );
    _rounded(
      canvas,
      const Rect.fromLTWH(181, 159, 55, 54),
      6,
      const Color(0xFFDDEDDC),
    );
    for (final x in [83.0, 130.0, 184.0, 223.0]) {
      _lineTo(canvas, Offset(x, 65), Offset(x, 241), _line, 7);
    }
    for (final y in [105.0, 148.0, 197.0]) {
      _lineTo(canvas, Offset(46, y), Offset(254, y), _line, 7);
    }
    canvas.restore();

    // Position is revealed by a pulse, then the pin settles into place.
    canvas.drawCircle(
      const Offset(158, 148),
      17 + 37 * progress,
      Paint()
        ..color = _teal.withValues(alpha: 0.3 * (1 - progress))
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3,
    );
    final drop = Curves.bounceOut.transform(progress);
    _pin(canvas, Offset(158, 142 - 35 * (1 - drop)), _teal, 1.5);
    _pin(canvas, const Offset(76, 182), _orange, 0.55);
    _pin(canvas, const Offset(218, 105), _green, 0.55);
    _rounded(
      canvas,
      const Rect.fromLTWH(105, 251, 90, 6),
      3,
      const Color(0xFFC6D9DD),
    );
  }

  void _publicMap(Canvas canvas) {
    _rounded(canvas, const Rect.fromLTWH(80, 43, 140, 222), 23, _teal);
    _rounded(canvas, const Rect.fromLTWH(87, 51, 126, 205), 18, Colors.white);
    _rounded(
      canvas,
      const Rect.fromLTWH(94, 70, 112, 161),
      8,
      const Color(0xFFF2F6F5),
    );
    _rounded(canvas, const Rect.fromLTWH(127, 59, 46, 4), 2, _line);
    canvas.save();
    canvas.clipRRect(
      RRect.fromRectAndRadius(
        const Rect.fromLTWH(94, 70, 112, 161),
        const Radius.circular(8),
      ),
    );
    for (final x in [115.0, 151.0, 189.0]) {
      _lineTo(canvas, Offset(x, 70), Offset(x, 231), _line, 5);
    }
    for (final y in [97.0, 135.0, 179.0, 217.0]) {
      _lineTo(canvas, Offset(94, y), Offset(206, y), _line, 5);
    }
    _rounded(
      canvas,
      const Rect.fromLTWH(100, 103, 23, 25),
      3,
      const Color(0xFFFFF0CD),
    );
    _rounded(
      canvas,
      const Rect.fromLTWH(155, 181, 27, 29),
      3,
      const Color(0xFFDDEDDC),
    );
    canvas.restore();

    final pins = [
      (const Offset(121, 118), const Color(0xFFD96860), 0.0),
      (const Offset(177, 154), _orange, 0.20),
      (const Offset(137, 204), _green, 0.40),
    ];
    for (final (center, color, delay) in pins) {
      final local = ((progress - delay) / (1 - delay)).clamp(0.0, 1.0);
      final pop = Curves.elasticOut.transform(local);
      if (local > 0) _pin(canvas, center, color, 0.75 * pop);
    }
    _rounded(
      canvas,
      const Rect.fromLTWH(105, 238, 38, 6),
      3,
      const Color(0xFF89B1D3),
    );
    _rounded(
      canvas,
      const Rect.fromLTWH(149, 238, 43, 6),
      3,
      const Color(0xFFF0C178),
    );
    _circle(canvas, const Offset(230, 111), 8, _gold);
    _circle(canvas, const Offset(66, 211), 5, _teal.withValues(alpha: 0.65));
  }

  void _municipality(Canvas canvas) {
    final enter = Curves.easeOutCubic.transform(progress);
    canvas.save();
    canvas.translate(-16 * (1 - enter), 0);
    _rounded(canvas, const Rect.fromLTWH(38, 79, 126, 149), 15, Colors.white);
    _rounded(canvas, const Rect.fromLTWH(38, 79, 126, 30), 14, _teal);
    _rounded(canvas, const Rect.fromLTWH(52, 92, 44, 5), 2, Colors.white);
    for (final (y, colour, width) in [
      (126.0, _green, 76.0),
      (155.0, _green, 68.0),
      (184.0, _orange, 73.0),
    ]) {
      _circle(canvas, Offset(57, y), 6, colour);
      _lineTo(canvas, Offset(54, y), Offset(56, y + 2), Colors.white, 1.4);
      _lineTo(canvas, Offset(56, y + 2), Offset(60, y - 3), Colors.white, 1.4);
      _rounded(canvas, Rect.fromLTWH(72, y - 3, width, 6), 3, _line);
    }
    _rounded(
      canvas,
      const Rect.fromLTWH(52, 207, 94, 6),
      3,
      const Color(0xFFE2E8EA),
    );
    canvas.restore();

    canvas.save();
    canvas.translate(16 * (1 - enter), 0);
    final roof = Path()
      ..moveTo(183, 107)
      ..lineTo(275, 107)
      ..lineTo(265, 84)
      ..lineTo(193, 84)
      ..close();
    canvas.drawPath(roof, Paint()..color = _teal);
    _rounded(canvas, const Rect.fromLTWH(190, 108, 78, 111), 8, Colors.white);
    _lineTo(canvas, const Offset(201, 115), const Offset(201, 211), _line, 5);
    _lineTo(canvas, const Offset(229, 115), const Offset(229, 211), _line, 5);
    _lineTo(canvas, const Offset(257, 115), const Offset(257, 211), _line, 5);
    _rounded(canvas, const Rect.fromLTWH(182, 215, 93, 8), 3, _teal);
    _lineTo(canvas, const Offset(229, 83), const Offset(229, 67), _teal, 2);
    final flag = Path()
      ..moveTo(230, 67)
      ..lineTo(247, 73)
      ..lineTo(230, 78)
      ..close();
    canvas.drawPath(flag, Paint()..color = _gold);
    canvas.restore();

    for (var i = 0; i < 3; i++) {
      final local = ((progress - i * 0.13) / 0.5).clamp(0.0, 1.0);
      if (local > 0) {
        _circle(
          canvas,
          Offset(170 + 10.0 * i, 157),
          2.4,
          _teal.withValues(alpha: local),
        );
      }
    }
    final check = ((progress - 0.56) / 0.44).clamp(0.0, 1.0);
    if (check > 0) {
      canvas.save();
      canvas.translate(229, 178);
      canvas.scale(Curves.elasticOut.transform(check));
      _circle(canvas, Offset.zero, 19, _green);
      _lineTo(
        canvas,
        const Offset(-9, 0),
        const Offset(-2, 7),
        Colors.white,
        4,
      );
      _lineTo(
        canvas,
        const Offset(-2, 7),
        const Offset(11, -8),
        Colors.white,
        4,
      );
      canvas.restore();
    }
  }

  void _pin(Canvas canvas, Offset center, Color colour, double scale) {
    canvas.save();
    canvas.translate(center.dx, center.dy);
    canvas.scale(scale);
    final tail = Path()
      ..moveTo(-9, 5)
      ..lineTo(0, 21)
      ..lineTo(9, 5)
      ..close();
    canvas.drawPath(tail, Paint()..color = colour);
    _circle(canvas, Offset.zero, 12, colour);
    _circle(canvas, Offset.zero, 4.5, Colors.white);
    canvas.restore();
  }

  void _rounded(Canvas canvas, Rect rect, double radius, Color colour) {
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect, Radius.circular(radius)),
      Paint()..color = colour,
    );
  }

  void _circle(Canvas canvas, Offset center, double radius, Color colour) {
    canvas.drawCircle(center, radius, Paint()..color = colour);
  }

  void _lineTo(
    Canvas canvas,
    Offset from,
    Offset to,
    Color colour,
    double width,
  ) {
    canvas.drawLine(
      from,
      to,
      Paint()
        ..color = colour
        ..strokeWidth = width
        ..strokeCap = StrokeCap.round,
    );
  }

  @override
  bool shouldRepaint(covariant _ScenePainter oldDelegate) =>
      oldDelegate.page != page || oldDelegate.progress != progress;
}
