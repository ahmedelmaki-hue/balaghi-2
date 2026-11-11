import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:balaghi/photo_brightness.dart';
import 'package:flutter_test/flutter_test.dart';

/// Raw RGBA pixels: [dark] pixels of one grey, the rest of another.
Uint8List pixels(int count, int grey, {int dark = 0, int darkGrey = 0}) {
  final bytes = Uint8List(count * 4);
  for (var p = 0; p < count; p++) {
    final value = p < dark ? darkGrey : grey;
    bytes
      ..[p * 4] = value
      ..[p * 4 + 1] = value
      ..[p * 4 + 2] = value
      ..[p * 4 + 3] = 255;
  }
  return bytes;
}

Future<Uint8List> png(int width, int height, Uint8List rgba) async {
  final buffer = await ui.ImmutableBuffer.fromUint8List(rgba);
  final descriptor = ui.ImageDescriptor.raw(
    buffer,
    width: width,
    height: height,
    pixelFormat: ui.PixelFormat.rgba8888,
  );
  final codec = await descriptor.instantiateCodec();
  final image = (await codec.getNextFrame()).image;
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  return data!.buffer.asUint8List();
}

void main() {
  test('brightness weighs green more than blue, as the eye does', () {
    expect(brightnessP75(Uint8List.fromList([0, 255, 0, 255])), 150);
    expect(brightnessP75(Uint8List.fromList([0, 0, 255, 255])), 29);
  });

  test('a black or near-black photo is too dark; a daylight one is not', () {
    expect(isTooDark(pixels(100, 0)), isTrue);
    expect(isTooDark(pixels(100, 39)), isTrue);
    expect(isTooDark(pixels(100, 40)), isFalse);
    expect(isTooDark(pixels(100, 150)), isFalse);
  });

  test(
    'a night photo is judged by most of its pixels, not one bright lamp',
    () {
      // 80% dark street, 20% a blazing street lamp: still too dark.
      expect(isTooDark(pixels(100, 255, dark: 80, darkGrey: 15)), isTrue);
      // Half dark and half lit: enough of the scene can be seen.
      expect(isTooDark(pixels(100, 120, dark: 50, darkGrey: 15)), isFalse);
    },
  );

  testWidgets('a real encoded photo is decoded and checked', (tester) async {
    await tester.runAsync(() async {
      expect(
        await isPhotoTooDark(await png(64, 48, pixels(64 * 48, 12))),
        isTrue,
      );
      expect(
        await isPhotoTooDark(await png(64, 48, pixels(64 * 48, 180))),
        isFalse,
      );
      expect(await isPhotoTooDark(Uint8List.fromList([1, 2, 3])), isFalse);
    });
  });
}
