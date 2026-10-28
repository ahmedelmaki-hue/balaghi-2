import 'package:balaghi/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';

void main() {
  testWidgets('Cairo is the app text theme beyond buttons', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildBalaghiTheme(),
        home: const Scaffold(
          body: Text('نص عادي', style: TextStyle(fontSize: 17)),
        ),
      ),
    );

    final title = find.text('نص عادي');
    final context = tester.element(title);
    final cairo = GoogleFonts.cairo().fontFamily;
    expect(Theme.of(context).textTheme.bodyMedium?.fontFamily, cairo);
    expect(Theme.of(context).textTheme.titleLarge?.fontFamily, cairo);
    expect(Theme.of(context).primaryTextTheme.bodyMedium?.fontFamily, cairo);

    final rendered = tester.widget<RichText>(
      find.descendant(of: title, matching: find.byType(RichText)).first,
    );
    expect(rendered.text.style?.fontFamily, cairo);
  });
}
