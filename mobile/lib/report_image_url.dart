String? resolveReportImageUrl(Object? value, String apiBaseUrl) {
  final imageUrl = value?.toString().trim();
  if (imageUrl == null || imageUrl.isEmpty) return null;
  final uri = Uri.tryParse(imageUrl);
  if (uri == null) return null;
  if (uri.hasScheme) return imageUrl;
  return Uri.parse(apiBaseUrl).resolveUri(uri).toString();
}
