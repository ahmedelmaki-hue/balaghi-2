import 'dart:math' as math;

import 'package:flutter/material.dart';

enum AuthIllustrationScene { welcome, phone, profile }

const _teal = Color(0xFF4D93A8);
const _navy = Color(0xFF30454F);
const _gold = Color(0xFFF2C94C);
const _green = Color(0xFF70AD83);
const _pale = Color(0xFFEAF2F6);
const _line = Color(0xFFD2E1E5);

/// Small illustrations that animate once when an authentication step opens.
class AuthIllustration extends StatefulWidget {
  const AuthIllustration({super.key, required this.scene, this.dark = false});

  final AuthIllustrationScene scene;
  final bool dark;

  @override
  State<AuthIllustration> createState() => _AuthIllustrationState();
}

class _AuthIllustrationState extends State<AuthIllustration>
    with SingleTickerProviderStateMixin {
  late final AnimationController _animation = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1150),
  )..forward();

  @override
  void didUpdateWidget(covariant AuthIllustration oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.scene != widget.scene) _animation.forward(from: 0);
  }

  @override
  void dispose() {
    _animation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dimensions = switch (widget.scene) {
      AuthIllustrationScene.welcome => const Size(220, 170),
      AuthIllustrationScene.phone => const Size(230, 195),
      AuthIllustrationScene.profile => const Size(220, 155),
    };
    return SizedBox.fromSize(
      size: dimensions,
      child: RepaintBoundary(
        child: AnimatedBuilder(
          animation: _animation,
          builder: (context, _) => CustomPaint(
            painter: _AuthScenePainter(
              widget.scene,
              _animation.value,
              widget.dark,
            ),
          ),
        ),
      ),
    );
  }
}

class _AuthScenePainter extends CustomPainter {
  const _AuthScenePainter(this.scene, this.progress, this.dark);

  final AuthIllustrationScene scene;
  final double progress;
  final bool dark;

  static final _shadow = Paint()
    ..color = const Color(0x1B254E5B)
    ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 11);

  @override
  void paint(Canvas canvas, Size size) {
    final scale = math.min(size.width / 300, size.height / 220);
    canvas.save();
    canvas.translate(
      (size.width - 300 * scale) / 2,
      (size.height - 220 * scale) / 2,
    );
    canvas.scale(scale);
    switch (scene) {
      case AuthIllustrationScene.welcome:
        _welcome(canvas);
      case AuthIllustrationScene.phone:
        _phone(canvas);
      case AuthIllustrationScene.profile:
        _profile(canvas);
    }
    canvas.restore();
  }

  void _welcome(Canvas canvas) {
    final tile = RRect.fromRectAndRadius(
      const Rect.fromLTWH(17, 23, 266, 173),
      const Radius.circular(28),
    );
    if (dark) {
      canvas.drawRRect(
        tile,
        Paint()
          ..color = const Color(0x332F9CAD)
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 21),
      );
      canvas.drawRRect(tile, Paint()..color = const Color(0x242C6B7B));
      canvas.drawRRect(
        tile,
        Paint()
          ..color = const Color(0x6675C7D2)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.3,
      );
    } else {
      _card(canvas, const Rect.fromLTWH(17, 23, 266, 173), 28, _pale);
    }

    // A street and neighbourhood appear behind a freshly submitted report.
    final city = Curves.easeOutCubic.transform(_step(0, 0.55));
    canvas.save();
    canvas.translate(0, 24 * (1 - city));
    for (final (x, y, width, height, colour) in [
      (
        130.0,
        78.0,
        30.0,
        79.0,
        dark ? const Color(0xFF326676) : const Color(0xFFB8D8D4),
      ),
      (
        164.0,
        62.0,
        37.0,
        95.0,
        dark ? const Color(0xFF3A7B88) : const Color(0xFFA9CFD3),
      ),
      (
        205.0,
        91.0,
        33.0,
        66.0,
        dark ? const Color(0xFF2B5968) : const Color(0xFFC9DDD7),
      ),
      (
        242.0,
        105.0,
        23.0,
        52.0,
        dark ? const Color(0xFF326676) : const Color(0xFFB8D8D4),
      ),
    ]) {
      _round(canvas, Rect.fromLTWH(x, y, width, height), 4, colour);
      for (var row = 0; row < 2; row++) {
        _round(
          canvas,
          Rect.fromLTWH(x + 7, y + 14 + row * 20, 5, 8),
          2,
          Colors.white.withValues(alpha: dark ? 0.38 : 0.76),
        );
      }
    }
    _round(
      canvas,
      const Rect.fromLTWH(113, 157, 154, 14),
      7,
      dark ? const Color(0xFF182B3A) : _navy,
    );
    _lineTo(
      canvas,
      const Offset(145, 164),
      const Offset(157, 164),
      dark ? const Color(0xFFDCEEF1) : Colors.white,
      2,
    );
    _lineTo(
      canvas,
      const Offset(196, 164),
      const Offset(208, 164),
      dark ? const Color(0xFFDCEEF1) : Colors.white,
      2,
    );
    canvas.restore();

    final cardIn = Curves.easeOutBack.transform(_step(0.13, 0.75));
    canvas.save();
    canvas.translate(-25 * (1 - cardIn), 9 * (1 - cardIn));
    _card(
      canvas,
      const Rect.fromLTWH(39, 55, 113, 117),
      17,
      dark ? const Color(0xFF193340) : Colors.white,
      shadow: !dark,
    );
    _round(
      canvas,
      const Rect.fromLTWH(52, 67, 87, 68),
      9,
      dark ? const Color(0xFF284C56) : const Color(0xFFFFF2CD),
    );
    _round(
      canvas,
      const Rect.fromLTWH(68, 86, 54, 33),
      6,
      dark ? const Color(0xFF52A9BB) : _teal,
    );
    _round(
      canvas,
      const Rect.fromLTWH(75, 81, 18, 8),
      3,
      dark ? const Color(0xFF52A9BB) : _teal,
    );
    _circle(
      canvas,
      const Offset(96, 103),
      11,
      dark ? const Color(0xFFFFCD57) : Colors.white,
    );
    _circle(
      canvas,
      const Offset(96, 103),
      6,
      dark ? const Color(0xFF193340) : _navy,
    );
    _round(
      canvas,
      const Rect.fromLTWH(57, 146, 48, 5),
      3,
      dark ? const Color(0xFF638995) : _line,
    );
    _round(
      canvas,
      const Rect.fromLTWH(110, 146, 28, 5),
      3,
      dark ? const Color(0xFF638995) : _line,
    );
    canvas.restore();

    final pinIn = Curves.easeOutBack.transform(_step(0.45, 1));
    canvas.save();
    canvas.translate(219, 60 + 20 * (1 - pinIn));
    canvas.scale(pinIn);
    _pin(canvas, Offset.zero, _gold, 1);
    canvas.restore();
    _circle(canvas, const Offset(267, 49), 4, _gold);
    _circle(
      canvas,
      const Offset(29, 91),
      3,
      dark ? const Color(0xFF6CC2CF) : _teal,
    );
  }

  void _phone(Canvas canvas) {
    _card(canvas, const Rect.fromLTWH(17, 19, 266, 183), 28, _pale);

    final phoneIn = Curves.easeOutBack.transform(_step(0, 0.65));
    canvas.save();
    canvas.translate(0, 24 * (1 - phoneIn));
    _card(
      canvas,
      const Rect.fromLTWH(92, 31, 116, 176),
      22,
      _navy,
      shadow: true,
    );
    _round(canvas, const Rect.fromLTWH(98, 38, 104, 161), 16, Colors.white);
    _round(canvas, const Rect.fromLTWH(129, 44, 42, 5), 3, _line);
    _round(
      canvas,
      const Rect.fromLTWH(107, 59, 86, 117),
      9,
      const Color(0xFFF3F8F9),
    );
    _circle(canvas, const Offset(150, 187), 6, _line);
    canvas.restore();

    // The verification message slides into the phone, then a secure badge pops.
    final message = Curves.easeOutBack.transform(_step(0.22, 0.8));
    canvas.save();
    canvas.translate(-37 * (1 - message), 0);
    _card(
      canvas,
      const Rect.fromLTWH(40, 82, 174, 78),
      16,
      Colors.white,
      shadow: true,
    );
    _round(canvas, const Rect.fromLTWH(53, 96, 40, 42), 11, _gold);
    _lineTo(canvas, const Offset(65, 107), const Offset(78, 107), _navy, 2.4);
    _lineTo(canvas, const Offset(65, 114), const Offset(79, 114), _navy, 2.4);
    _lineTo(canvas, const Offset(65, 121), const Offset(75, 121), _navy, 2.4);
    for (var i = 0; i < 4; i++) {
      _circle(canvas, Offset(113 + 20.0 * i, 116), 4, _teal);
    }
    _round(canvas, const Rect.fromLTWH(108, 133, 87, 5), 3, _line);
    canvas.restore();

    final secure = Curves.elasticOut.transform(_step(0.58, 1));
    canvas.save();
    canvas.translate(229, 151);
    canvas.scale(secure);
    _circle(canvas, Offset.zero, 26, _green);
    _lineTo(canvas, const Offset(-11, 0), const Offset(-3, 8), Colors.white, 4);
    _lineTo(
      canvas,
      const Offset(-3, 8),
      const Offset(12, -10),
      Colors.white,
      4,
    );
    canvas.restore();
    _circle(canvas, const Offset(247, 53), 4, _gold);
    _circle(canvas, const Offset(57, 55), 3, _teal);
  }

  void _profile(Canvas canvas) {
    _card(canvas, const Rect.fromLTWH(18, 23, 264, 174), 28, _pale);

    final cardIn = Curves.easeOutBack.transform(_step(0, 0.72));
    canvas.save();
    canvas.translate(0, 28 * (1 - cardIn));
    _card(
      canvas,
      const Rect.fromLTWH(42, 56, 215, 115),
      18,
      Colors.white,
      shadow: true,
    );
    _round(canvas, const Rect.fromLTWH(42, 56, 215, 17), 15, _teal);
    _circle(canvas, const Offset(92, 119), 29, const Color(0xFFE5F1F2));
    _circle(canvas, const Offset(92, 110), 11, _teal);
    final shoulders = Path()
      ..moveTo(73, 137)
      ..quadraticBezierTo(92, 117, 111, 137)
      ..close();
    canvas.drawPath(shoulders, Paint()..color = _teal);
    _round(canvas, const Rect.fromLTWH(137, 94, 84, 7), 4, _navy);
    _round(canvas, const Rect.fromLTWH(137, 111, 64, 6), 3, _line);
    _round(canvas, const Rect.fromLTWH(137, 127, 78, 6), 3, _line);
    _round(
      canvas,
      const Rect.fromLTWH(137, 145, 42, 5),
      3,
      const Color(0xFFE5ECEE),
    );
    canvas.restore();

    final sealIn = Curves.elasticOut.transform(_step(0.5, 1));
    canvas.save();
    canvas.translate(237, 163);
    canvas.scale(sealIn);
    _circle(canvas, Offset.zero, 27, _gold);
    _circle(canvas, Offset.zero, 18, Colors.white);
    _lineTo(canvas, const Offset(-10, 0), const Offset(-3, 7), _navy, 4);
    _lineTo(canvas, const Offset(-3, 7), const Offset(12, -10), _navy, 4);
    canvas.restore();
    _circle(canvas, const Offset(260, 45), 4, _gold);
    _circle(canvas, const Offset(30, 160), 3, _teal);
  }

  double _step(double start, double end) =>
      ((progress - start) / (end - start)).clamp(0.0, 1.0);

  void _card(
    Canvas canvas,
    Rect rect,
    double radius,
    Color colour, {
    bool shadow = false,
  }) {
    final shape = RRect.fromRectAndRadius(rect, Radius.circular(radius));
    if (shadow) canvas.drawRRect(shape.shift(const Offset(0, 5)), _shadow);
    canvas.drawRRect(shape, Paint()..color = colour);
  }

  void _round(Canvas canvas, Rect rect, double radius, Color colour) {
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

  void _pin(Canvas canvas, Offset center, Color colour, double scale) {
    canvas.save();
    canvas.translate(center.dx, center.dy);
    canvas.scale(scale);
    final tail = Path()
      ..moveTo(-13, 5)
      ..lineTo(0, 30)
      ..lineTo(13, 5)
      ..close();
    canvas.drawPath(tail, Paint()..color = colour);
    _circle(canvas, Offset.zero, 18, colour);
    _circle(canvas, Offset.zero, 7, Colors.white);
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _AuthScenePainter oldDelegate) =>
      oldDelegate.scene != scene ||
      oldDelegate.progress != progress ||
      oldDelegate.dark != dark;
}
