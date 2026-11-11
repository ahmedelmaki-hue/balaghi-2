import 'dart:typed_data';
import 'dart:ui' as ui;

/// Warns when a photo was taken in near darkness, so the citizen can take it
/// again with more light. It never stops a report from being sent.
///
/// The rule was set on 67 real street photos and darkened copies of them: a
/// photo is too dark when 75% of its pixels have a brightness below 40 (of
/// 255). No real photo, night shots included, came close (the darkest was 56);
/// copies darkened to a quarter of their light or less mostly fell below it.
const darkPhotoBrightness = 40;

/// Brightness of the pixel at the 75th percentile, 0 (black) to 255 (white),
/// from raw RGBA bytes: 0.299 R + 0.587 G + 0.114 B.
int brightnessP75(Uint8List rgba) {
  final histogram = List<int>.filled(256, 0);
  var pixels = 0;
  for (var i = 0; i + 3 < rgba.length; i += 4) {
    final value = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2])
        .round();
    histogram[value]++;
    pixels++;
  }
  if (pixels == 0) return 255;
  final target = (pixels * 0.75).floor();
  var seen = 0;
  for (var value = 0; value < 256; value++) {
    seen += histogram[value];
    if (seen > target) return value;
  }
  return 255;
}

bool isTooDark(Uint8List rgba) => brightnessP75(rgba) < darkPhotoBrightness;

/// Decodes a JPEG or PNG photo at about 256 px wide and checks its brightness.
/// A photo that cannot be read is never called dark: the warning only helps.
Future<bool> isPhotoTooDark(Uint8List photo) async {
  try {
    final codec = await ui.instantiateImageCodec(photo, targetWidth: 256);
    final frame = await codec.getNextFrame();
    final image = frame.image;
    final bytes = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    image.dispose();
    codec.dispose();
    if (bytes == null) return false;
    return isTooDark(bytes.buffer.asUint8List());
  } catch (_) {
    return false;
  }
}
